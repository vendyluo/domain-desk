import { error, fail } from '@sveltejs/kit';
import { getOpportunity, transitionOpportunity } from '$lib/server/opportunities';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
  const result = await getOpportunity(platform!.env.DB, params.id);
  if (!result) error(404, 'Opportunity not found');
  return result;
};

export const actions: Actions = {
  transition: async ({ request, params, platform }) => {
    const form = await request.formData();
    try {
      await transitionOpportunity(platform!.env.DB, params.id, form.get('command'), {
        reason: form.get('reason'),
        nextAction: form.get('nextAction')
      });
      return { success: true };
    } catch (cause) {
      return fail(400, {
        message: cause instanceof Error ? cause.message : 'Invalid transition.'
      });
    }
  }
};
