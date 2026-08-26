import { error, fail } from '@sveltejs/kit';
import { getConversation, setHandled } from '$lib/server/inbox';
import { createNextAction } from '$lib/server/actions';
import { createOpportunity } from '$lib/server/opportunities';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ params, platform }) => {
  const detail = await getConversation(platform!.env.DB, params.id);
  if (!detail) error(404, 'Conversation not found');
  return detail;
};
export const actions: Actions = {
  opportunity: async ({ request, params, platform }) => {
    const f = await request.formData();
    try {
      const id = await createOpportunity(platform!.env.DB, {
        title: f.get('title'),
        desiredOutcome: f.get('desiredOutcome'),
        conversationId: params.id,
        valueMinor: f.get('valueMinor'),
        currency: f.get('currency')
      });
      redirect(303, `/opportunities/${id}`);
    } catch (e) {
      return fail(400, { message: e instanceof Error ? e.message : 'Invalid opportunity.' });
    }
  },
  state: async ({ request, params, platform }) => {
    const value = (await request.formData()).get('state');
    if (value !== 'handled' && value !== 'attention') return fail(400, { message: 'Invalid conversation state.' });
    if (!(await setHandled(platform!.env.DB, params.id, value === 'attention')))
      return fail(404, { message: 'Conversation not found.' });
    return { success: true };
  },
  action: async ({ request, params, platform }) => {
    const f = await request.formData();
    try {
      await createNextAction(platform!.env.DB, {
        description: f.get('description'),
        due: f.get('due'),
        sourceType: 'conversation',
        sourceId: params.id
      });
      return { success: true };
    } catch (e) {
      return fail(400, {
        message: e instanceof Error ? e.message : 'Invalid action.'
      });
    }
  }
};
