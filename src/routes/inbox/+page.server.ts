import { listInbox } from '$lib/server/inbox';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ url, platform }) => {
  const filters = Object.fromEntries(['q','state','product','domain','mailbox'].map(k => [k, url.searchParams.get(k) || undefined]));
  return { ...(await listInbox(platform!.env.DB, filters)), filters };
};
