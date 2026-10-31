import { authorizeRequest } from './auth';
import type { Handle, HandleServerError } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  if (!event.platform?.env || !(await authorizeRequest(event.request, event.platform.env))) {
    return new Response('Cloudflare Access required', { status: 403 });
  }
  const response = await resolve(event);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
};

export const handleError: HandleServerError = ({ error }) => {
  const requestId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      event: 'web_request_failed',
      request_id: requestId,
      error: error instanceof Error ? error.message : 'unknown'
    })
  );
  return { message: 'The request could not be completed.', requestId };
};
