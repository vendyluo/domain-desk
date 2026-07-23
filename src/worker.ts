import web from '../.svelte-kit/cloudflare/_worker.js';
import { handleEmail } from './email';

export default { fetch: web.fetch, email: handleEmail };
