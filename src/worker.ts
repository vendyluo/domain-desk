import web from '../.svelte-kit/cloudflare/_worker.js';
import { handleEmail } from './email';
import { handleIntakeRequest, isIntakeRequest } from './intake-http';
import type { Env } from './types';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (isIntakeRequest(new URL(request.url), request.method)) return handleIntakeRequest(request, env);
    return web.fetch!(request as Parameters<NonNullable<typeof web.fetch>>[0], env, ctx);
  },
  email: handleEmail
};
