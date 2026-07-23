import { fail } from "@sveltejs/kit";
import { listToday, transitionNextAction } from "$lib/server/actions";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = ({ platform }) =>
  listToday(platform!.env.DB);
export const actions: Actions = {
  action: async ({ request, platform }) => {
    const f = await request.formData();
    try {
      await transitionNextAction(
        platform!.env.DB,
        String(f.get("id")),
        f.get("command"),
        { reason: f.get("reason"), due: f.get("due") },
      );
      return { success: true };
    } catch (e) {
      return fail(400, {
        message: e instanceof Error ? e.message : "Action failed.",
      });
    }
  },
};
