import { deploymentHealth } from '$lib/server/health';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
  const health = await deploymentHealth(platform!.env);
  const mailboxes = await platform!.env.DB.prepare(
    'SELECT mi.id,mi.address,d.name domain FROM mailbox_identities mi JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id ORDER BY mi.address'
  ).all<{ id: string; address: string; domain: string }>();
  return {
    ...health,
    intakeEmbed: {
      origin: url.origin,
      siteKey: platform!.env.TURNSTILE_SITE_KEY ?? null,
      mailboxes: mailboxes.results
    }
  };
};
