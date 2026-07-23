import { Hono } from 'hono';
import { html } from 'hono/html';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ingestRaw, readBounded } from './ingest';
import type { Env } from './types';
import { IngestError } from './types';

export const app = new Hono<{ Bindings: Env }>();
const accessKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

app.use('*', async (c, next) => {
  if (c.env.LOCAL_DEV !== 'true') {
    const assertion = c.req.header('Cf-Access-Jwt-Assertion');
    const teamDomain = c.env.ACCESS_TEAM_DOMAIN.replace(/\/$/, '');
    if (!assertion || !teamDomain.startsWith('https://') || !c.env.ACCESS_AUD || c.env.ACCESS_AUD === 'replace-with-access-application-aud') return c.text('Cloudflare Access required', 403);
    try {
      let jwks = accessKeys.get(teamDomain);
      if (!jwks) {
        jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
        accessKeys.set(teamDomain, jwks);
      }
      await jwtVerify(assertion, jwks, { issuer: teamDomain, audience: c.env.ACCESS_AUD });
    } catch {
      return c.text('Cloudflare Access required', 403);
    }
  }
  await next();
});
const layout = (title: string, body: unknown) => html`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:16px system-ui;max-width:960px;margin:2rem auto;padding:0 1rem;color:#18202a}a{color:#075985}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.7rem;border-bottom:1px solid #ddd}.badge{background:#fff1c2;padding:.2rem .5rem;border-radius:.4rem}.body{white-space:pre-wrap;background:#f6f7f8;padding:1rem}</style></head><body><h1><a href="/">Domain CRM</a></h1>${body}</body></html>`;

app.get('/', async c => {
  const rows = await c.env.DB.prepare(`SELECT c.id,c.subject,c.needs_attention,c.updated_at,m.sender_address,mi.address mailbox,p.name product,d.name domain FROM conversations c JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id JOIN messages m ON m.id=(SELECT id FROM messages WHERE conversation_id=c.id ORDER BY received_at DESC LIMIT 1) ORDER BY c.updated_at DESC`).all<Record<string, string|number>>();
  return c.html(layout('Inbox', html`<h2>Inbox</h2>${rows.results.length === 0 ? html`<p>No conversations yet.</p><p>Configure a domain, product, and mailbox identity, route that exact address to this Email Worker, then send an external test message. See the README setup and ingestion troubleshooting steps.</p>` : html`<table><thead><tr><th>Domain / product</th><th>Sender / subject</th><th>Mailbox</th><th>Last</th><th>State</th></tr></thead><tbody>${rows.results.map(r => html`<tr><td>${r.domain}<br><small>${r.product}</small></td><td>${r.sender_address}<br><a href=${`/conversations/${r.id}`}>${r.subject || '(no subject)'}</a></td><td>${r.mailbox}</td><td>${r.updated_at}</td><td>${r.needs_attention ? html`<span class="badge">needs attention</span>` : 'reviewed'}</td></tr>`)}</tbody></table>`}`));
});
app.get('/conversations/:id', async c => {
  const conversation = await c.env.DB.prepare(`SELECT c.*,mi.address mailbox,p.name product,d.name domain,ce.address contact_email,ct.display_name FROM conversations c JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id JOIN contacts ct ON ct.id=c.contact_id JOIN contact_email_addresses ce ON ce.contact_id=ct.id WHERE c.id=?`).bind(c.req.param('id')).first<Record<string,string|number>>();
  if (!conversation) return c.html(layout('Not found', html`<h2>Conversation not found</h2><p>The conversation does not exist. <a href="/">Return to the inbox.</a></p>`), 404);
  const messages = await c.env.DB.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY received_at').bind(c.req.param('id')).all<Record<string,string>>();
  const attachments = await c.env.DB.prepare('SELECT a.* FROM attachments a JOIN messages m ON m.id=a.message_id WHERE m.conversation_id=? ORDER BY a.id').bind(c.req.param('id')).all<Record<string,string|number>>();
  return c.html(layout(String(conversation.subject || 'Conversation'), html`<p><b>${conversation.domain} / ${conversation.product}</b> · ${conversation.mailbox}</p><p>Contact: ${conversation.display_name || '(no name)'} &lt;${conversation.contact_email}&gt;</p><p>State: ${conversation.needs_attention ? 'needs attention' : 'reviewed'}</p>${messages.results.map(m => html`<article><h2>${m.subject || '(no subject)'}</h2><dl><dt>From</dt><dd>${m.sender_name || ''} &lt;${m.sender_address}&gt;</dd><dt>Sent</dt><dd>${m.sent_at || 'unknown'}</dd><dt>Received</dt><dd>${m.received_at}</dd><dt>Ingested</dt><dd>${m.ingested_at}</dd><dt>Message-ID</dt><dd>${m.message_id || 'absent (content fingerprint used)'}</dd></dl><div class="body">${m.text_body || '(no text body)'}</div></article>`)}<h2>Attachments</h2>${attachments.results.length ? html`<ul>${attachments.results.map(a => html`<li>${a.filename || '(unnamed)'} — ${a.media_type}, ${a.size} bytes, ${a.disposition || 'unspecified disposition'}${a.content_id ? `, Content-ID ${a.content_id}` : ''} (stored)</li>`)}</ul>` : html`<p>None</p>`}`));
});

app.notFound(c => c.html(layout('Not found', html`<h2>Page not found</h2><p><a href="/">Return to the inbox.</a></p>`), 404));
app.onError((error, c) => {
  console.error(JSON.stringify({ event: 'web_request_failed', error: error.message }));
  return c.html(layout('Application error', html`<h2>Application error</h2><p>The request could not be completed. Check the Worker logs and verify the D1 migration and bindings described in the README.</p>`), 500);
});

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const receivedAt = new Date();
    try { const result = await ingestRaw(env, message.to, await readBounded(message.raw), receivedAt); console.log(JSON.stringify({ event: 'email_delivery_complete', duplicate: result.duplicate, message_id: result.id })); }
    catch (error) {
      const code = error instanceof IngestError ? error.code : 'unexpected';
      console.error(JSON.stringify({ event: 'email_ingestion_failed', code }));
      if (error instanceof IngestError && ['unknown_mailbox', 'malformed_mime', 'message_too_large'].includes(code)) {
        message.setReject(`Domain CRM rejected this message: ${code}`);
        return;
      }
      throw error;
    }
  }
};
