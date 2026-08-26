import { listOpportunities } from '$lib/server/opportunities';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, platform }) => {
  const state = url.searchParams.get('state') || undefined;
  try {
    return {
      opportunities: await listOpportunities(platform!.env.DB, state),
      state: state || ''
    };
  } catch (cause) {
    return {
      opportunities: [],
      state: state || '',
      error: cause instanceof Error ? cause.message : 'Unable to list opportunities.'
    };
  }
};
