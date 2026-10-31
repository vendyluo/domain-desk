// The public form-intake endpoint lives beside the email handler in the worker
// entrypoint, outside the SvelteKit app: it is an ingestion channel, not a page.
// The Access-protected app therefore stays fully fail-closed, and SvelteKit's
// cross-site form protection keeps applying to every real page.
import { submitIntake, type TurnstileVerifier } from './lib/server/intake';
import { readBounded } from './ingest';
import type { Env } from './types';
import { IngestError } from './types';

const STATUS: Record<string, number> = {
  unknown_mailbox: 404,
  invalid_origin: 403,
  turnstile_failed: 403,
  invalid_submission: 400,
  not_configured: 503
};

const cors = (origin: string | null): Record<string, string> =>
  origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};

export function isIntakeRequest(url: URL, method: string): boolean {
  return url.pathname.startsWith('/intake/') && ['POST', 'OPTIONS'].includes(method);
}

export async function handleIntakeRequest(request: Request, env: Env, verify?: TurnstileVerifier): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') {
    // Preflight for pages that submit with fetch() instead of a form navigation.
    return new Response(null, {
      status: 204,
      headers: {
        ...cors(origin),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
  const encoded = new URL(request.url).pathname.slice('/intake/'.length);
  let mailboxId: string;
  try {
    mailboxId = decodeURIComponent(encoded);
  } catch {
    // Malformed percent-encoding is attacker-controllable: answer with the same
    // bare code this surface uses everywhere else, never an unhandled throw.
    return new Response('unknown_mailbox', { status: 404, headers: cors(origin) });
  }
  let form: FormData;
  try {
    if (!request.body) throw new Error('Missing form body');
    // Bound the raw request before multipart parsing, including chunked requests.
    const bytes = await readBounded(request.body, 128 * 1024);
    form = await new Response(bytes, {
      headers: { 'Content-Type': request.headers.get('Content-Type') || '' }
    }).formData();
    form.forEach((value) => {
      if (typeof value !== 'string') throw new Error('Form attachments are not supported');
    });
  } catch {
    return new Response('invalid_submission', { status: 400, headers: cors(origin) });
  }
  try {
    await submitIntake(
      env,
      mailboxId,
      {
        email: form.get('email'),
        name: form.get('name'),
        subject: form.get('subject'),
        message: form.get('message'),
        website: form.get('website'),
        turnstileToken: form.get('cf-turnstile-response')
      },
      origin,
      { remoteIp: request.headers.get('CF-Connecting-IP') ?? undefined, verify }
    );
  } catch (error) {
    const code = error instanceof IngestError ? error.code : 'unexpected';
    console.error(JSON.stringify({ event: 'form_intake_rejected', code }));
    // The body is a bare machine code: never echo submitted content on this
    // unauthenticated surface.
    return new Response(code, { status: STATUS[code] ?? 500, headers: cors(origin) });
  }
  const redirect = String(form.get('redirect') ?? '');
  if (redirect && origin) {
    try {
      const target = new URL(redirect);
      // Only redirect back to the page's own validated origin family.
      if (target.protocol === 'https:' && new URL(origin).hostname === target.hostname) {
        return new Response(null, { status: 303, headers: { Location: target.toString(), ...cors(origin) } });
      }
    } catch {
      // fall through to the plain confirmation
    }
  }
  return new Response('Thanks — your message was received.', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors(origin) }
  });
}
