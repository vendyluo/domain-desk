import { deploymentHealth, intakeMailboxes } from '$lib/server/health';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
  const health = await deploymentHealth(platform!.env);
  return {
    ...health,
    intakeEmbed: {
      origin: url.origin,
      siteKey: platform!.env.TURNSTILE_SITE_KEY ?? null,
      mailboxes: await intakeMailboxes(platform!.env.DB)
    }
  };
};
