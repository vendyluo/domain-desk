import { error, fail, redirect } from "@sveltejs/kit";
import { createNextAction, transitionNextAction } from "$lib/server/actions";
import { createOpportunity } from "$lib/server/opportunities";
import {
  choosePrimaryEmail,
  getContact,
  mergeContacts,
  previewContactMerge,
  updateDisplayName,
} from "$lib/server/contacts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url, platform }) => {
  const detail = await getContact(platform!.env.DB, params.id);
  if (!detail) error(404, "Contact not found");
  if ("aliasOf" in detail)
    redirect(
      303,
      `/contacts/${detail.aliasOf}?merged=${encodeURIComponent(params.id)}`,
    );
  const duplicateId = url.searchParams.get("duplicate");
  let mergePreview = null;
  if (duplicateId) {
    try {
      mergePreview = await previewContactMerge(
        platform!.env.DB,
        params.id,
        duplicateId,
      );
    } catch (cause) {
      mergePreview = {
        error:
          cause instanceof Error ? cause.message : "Unable to preview merge.",
      };
    }
  }
  return {
    ...detail,
    mergePreview,
    mergedAlias: url.searchParams.get("merged"),
  };
};

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export const actions: Actions = {
  opportunity: async ({ request, params, platform }) => {
    const form = await request.formData();
    try {
      const id = await createOpportunity(platform!.env.DB, {
        contactId: params.id,
        conversationId: form.get("conversationId"),
        title: form.get("title"),
        desiredOutcome: form.get("desiredOutcome"),
        valueMinor: form.get("valueMinor"),
        currency: form.get("currency"),
      });
      redirect(303, `/opportunities/${id}`);
    } catch (cause) {
      return fail(400, { message: message(cause, "Invalid opportunity.") });
    }
  },
  create: async ({ request, params, platform }) => {
    const form = await request.formData();
    try {
      await createNextAction(platform!.env.DB, {
        description: form.get("description"),
        due: form.get("due"),
        sourceType: "contact",
        sourceId: params.id,
      });
      return { success: true };
    } catch (cause) {
      return fail(400, { message: message(cause, "Invalid action.") });
    }
  },
  transition: async ({ request, platform }) => {
    const form = await request.formData();
    try {
      await transitionNextAction(
        platform!.env.DB,
        String(form.get("id")),
        form.get("command"),
        { reason: form.get("reason") },
      );
      return { success: true };
    } catch (cause) {
      return fail(400, { message: message(cause, "Invalid transition.") });
    }
  },
  rename: async ({ request, params, platform }) => {
    const form = await request.formData();
    try {
      await updateDisplayName(
        platform!.env.DB,
        params.id,
        form.get("displayName"),
      );
      return { success: true };
    } catch (cause) {
      return fail(400, { message: message(cause, "Invalid display name.") });
    }
  },
  primary: async ({ request, params, platform }) => {
    const form = await request.formData();
    try {
      await choosePrimaryEmail(
        platform!.env.DB,
        params.id,
        form.get("emailId"),
      );
      return { success: true };
    } catch (cause) {
      return fail(400, { message: message(cause, "Invalid primary email.") });
    }
  },
  merge: async ({ request, params, platform }) => {
    const form = await request.formData();
    const duplicateId = String(form.get("duplicateId") ?? "");
    try {
      await mergeContacts(
        platform!.env.DB,
        params.id,
        duplicateId,
        form.get("confirmation"),
      );
      redirect(
        303,
        `/contacts/${params.id}?merged=${encodeURIComponent(duplicateId)}`,
      );
    } catch (cause) {
      return fail(400, { message: message(cause, "Merge failed.") });
    }
  },
};
