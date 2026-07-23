import { listContacts } from "$lib/server/contacts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, platform }) => {
  const q = url.searchParams.get("q") ?? "";
  return { q, rows: await listContacts(platform!.env.DB, q) };
};
