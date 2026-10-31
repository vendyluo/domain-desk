import { approveReply, saveReplyDraft, sendReply as sendApproved } from '../src/lib/server/outbound';
import type { Env } from '../src/types';

// Integration fixtures explicitly perform the owner review flow. Safety tests
// call each real command separately to exercise rejected/stale approvals.
export async function sendReply(
  env: Pick<Env, 'DB' | 'EMAIL'>,
  conversationId: string,
  body: unknown,
  now = new Date()
) {
  const draft = await saveReplyDraft(env.DB, conversationId, body);
  await approveReply(env.DB, conversationId, draft.id, draft.content_hash);
  return sendApproved(env, conversationId, draft.id, draft.content_hash, now);
}
