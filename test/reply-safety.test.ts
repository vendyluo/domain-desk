import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { ingestRaw } from '../src/ingest';
import {
  approveReply,
  cancelReply,
  listReplies,
  reconcileReply,
  saveReplyDraft,
  sendReply
} from '../src/lib/server/outbound';
import { createNextAction } from '../src/lib/server/actions';
import type { Env } from '../src/types';
import migration from '../migrations/0007_reply_approval.sql?raw';

async function setup() {
  const result = await ingestRaw(
    env as Env,
    'hello@example.com',
    new TextEncoder().encode(
      'From: Buyer <buyer@customer.test>\r\nTo: hello@example.com\r\nMessage-ID: <Root-AbC@Customer.test>\r\nSubject: Quote\r\n\r\n25 seats please'
    ).buffer
  );
  const conv = (await env.DB.prepare('SELECT conversation_id FROM messages WHERE id=?')
    .bind(result.id)
    .first<{ conversation_id: string }>())!.conversation_id;
  const draft = await saveReplyDraft(env.DB, conv, '25 seats: $250.');
  const send = vi.fn(async () => ({ messageId: '<Provider-AbC@example.com>' }));
  const binding = { DB: env.DB, EMAIL: { send } as SendEmail };
  return { conv, draft, send, binding };
}

describe('single-attempt owner-approved replies', () => {
  it('rejects unapproved and stale content, cancels only unsent drafts', async () => {
    const { conv, draft, send, binding } = await setup();
    await expect(sendReply(binding, conv, draft.id, draft.content_hash)).rejects.toThrow('not approved');
    await approveReply(env.DB, conv, draft.id, draft.content_hash);
    const edited = await saveReplyDraft(env.DB, conv, '25 seats: $275.', draft.id);
    expect(edited.approved_hash).toBe(null);
    await expect(approveReply(env.DB, conv, draft.id, draft.content_hash)).rejects.toThrow('changed');
    await expect(sendReply(binding, conv, draft.id, draft.content_hash)).rejects.toThrow('not approved');
    await cancelReply(env.DB, conv, draft.id);
    await expect(approveReply(env.DB, conv, draft.id, edited.content_hash)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a changed recipient context without calling the provider', async () => {
    const { conv, draft, send, binding } = await setup();
    await approveReply(env.DB, conv, draft.id, draft.content_hash);
    await env.DB.prepare("UPDATE messages SET sender_address='changed@customer.test' WHERE conversation_id=?")
      .bind(conv)
      .run();
    await expect(sendReply(binding, conv, draft.id, draft.content_hash)).rejects.toThrow('context changed');
    expect(send).not.toHaveBeenCalled();
  });

  it('claims concurrent and repeated submissions once and leaves next actions open', async () => {
    const { conv, draft, send, binding } = await setup();
    await createNextAction(env.DB, {
      description: 'Follow up tomorrow',
      due: null,
      sourceType: 'conversation',
      sourceId: conv
    });
    await approveReply(env.DB, conv, draft.id, draft.content_hash);
    const results = await Promise.allSettled([
      sendReply(binding, conv, draft.id, draft.content_hash),
      sendReply(binding, conv, draft.id, draft.content_hash)
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(sendReply(binding, conv, draft.id, draft.content_hash)).rejects.toThrow();
    await expect(cancelReply(env.DB, conv, draft.id)).rejects.toThrow();
    const replies = await listReplies(env.DB, conv);
    expect(replies[0]).toMatchObject({ state: 'accepted', provider_id: '<Provider-AbC@example.com>' });
    expect(
      (await env.DB.prepare("SELECT count(*) n FROM messages WHERE direction='outbound'").first<{ n: number }>())?.n
    ).toBe(1);
    expect((await env.DB.prepare('SELECT status FROM next_actions').first<{ status: string }>())?.status).toBe('open');
  });

  it.each(['E_INTERNAL_SERVER_ERROR', 'E_DELIVERY_FAILED', undefined])(
    'blocks uncertain %s outcomes and records no provider payload',
    async (code) => {
      const { conv, draft, send, binding } = await setup();
      send.mockRejectedValue(Object.assign(new Error('private body and internal diagnostic'), { code }));
      await approveReply(env.DB, conv, draft.id, draft.content_hash);
      await expect(sendReply(binding, conv, draft.id, draft.content_hash)).rejects.toThrow('outcome unknown');
      expect((await listReplies(env.DB, conv))[0].state).toBe('indeterminate');
      await expect(saveReplyDraft(env.DB, conv, 'Resend')).rejects.toThrow('unresolved');
      await expect(sendReply(binding, conv, draft.id, draft.content_hash)).rejects.toThrow();
      expect(JSON.stringify(await listReplies(env.DB, conv))).not.toContain('private body');
      expect(send).toHaveBeenCalledTimes(1);
    }
  );

  it('does not classify an accepted send with failed D1 commit as failed or resend it', async () => {
    const { conv, draft, send, binding } = await setup();
    await approveReply(env.DB, conv, draft.id, draft.content_hash);
    const batch = env.DB.batch.bind(env.DB);
    let calls = 0;
    const spy = vi.spyOn(env.DB, 'batch').mockImplementation(async (statements) => {
      if (++calls === 2) throw new Error('D1 temporarily unavailable');
      return batch(statements);
    });
    try {
      await expect(sendReply(binding, conv, draft.id, draft.content_hash)).rejects.toThrow('recording failed');
    } finally {
      spy.mockRestore();
    }
    expect((await listReplies(env.DB, conv))[0].state).toBe('sending');
    await expect(sendReply(binding, conv, draft.id, draft.content_hash)).rejects.toThrow();
    await expect(saveReplyDraft(env.DB, conv, 'Resend')).rejects.toThrow();
    await expect(
      reconcileReply(env.DB, conv, draft.id, 'failed', 'Support confirms no acceptance', '')
    ).rejects.toThrow('15 minutes');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('requires evidence to reconcile, restores threading by provider ID, never sends on reconciliation', async () => {
    const { conv, draft, send, binding } = await setup();
    send.mockRejectedValue(new Error('timeout'));
    await approveReply(env.DB, conv, draft.id, draft.content_hash);
    await expect(sendReply(binding, conv, draft.id, draft.content_hash)).rejects.toThrow();
    await expect(reconcileReply(env.DB, conv, draft.id, 'accepted', '', '<Recovered@example.com>')).rejects.toThrow(
      'evidence'
    );
    await expect(
      reconcileReply(env.DB, conv, draft.id, 'accepted', 'Provider log record 123 confirms accepted', '')
    ).rejects.toThrow('Message-ID');
    await reconcileReply(
      env.DB,
      conv,
      draft.id,
      'accepted',
      'Provider log record 123 confirms accepted',
      '<Recovered@example.com>'
    );
    const answer = await ingestRaw(
      env as Env,
      'hello@example.com',
      new TextEncoder().encode(
        'From: Buyer <buyer@customer.test>\r\nTo: hello@example.com\r\nMessage-ID: <answer@customer.test>\r\nIn-Reply-To: <Recovered@example.com>\r\nSubject: Thanks\r\n\r\nGo ahead'
      ).buffer
    );
    expect(
      (await env.DB.prepare('SELECT conversation_id FROM messages WHERE id=?')
        .bind(answer.id)
        .first<{ conversation_id: string }>())!.conversation_id
    ).toBe(conv);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await listReplies(env.DB, conv))[0].evidence).toContain('record 123');
  });

  it('a documented rejection permits a new approval, never replay of the old attempt', async () => {
    const { conv, draft, send, binding } = await setup();
    send.mockRejectedValueOnce(Object.assign(new Error('not enabled'), { code: 'E_SENDER_NOT_VERIFIED' }));
    await approveReply(env.DB, conv, draft.id, draft.content_hash);
    await expect(sendReply(binding, conv, draft.id, draft.content_hash)).rejects.toThrow('rejected');
    expect((await listReplies(env.DB, conv))[0].state).toBe('failed');
    const replacement = await saveReplyDraft(env.DB, conv, draft.body);
    expect(replacement.id).not.toBe(draft.id);
    await expect(sendReply(binding, conv, replacement.id, replacement.content_hash)).rejects.toThrow('not approved');
    await approveReply(env.DB, conv, replacement.id, replacement.content_hash);
    await sendReply(binding, conv, replacement.id, replacement.content_hash);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('migration quarantines legacy failures instead of authorizing resends', async () => {
    const { conv, draft, binding } = await setup();
    await approveReply(env.DB, conv, draft.id, draft.content_hash);
    await sendReply(binding, conv, draft.id, draft.content_hash);
    await env.DB.prepare('DROP TABLE reply_drafts').run();
    await env.DB.prepare(
      "UPDATE messages SET delivery_status='failed',delivery_error='lost response' WHERE direction='outbound'"
    ).run();
    for (const sql of migration
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await env.DB.prepare(sql).run();
    expect((await listReplies(env.DB, conv))[0].state).toBe('indeterminate');
    await expect(saveReplyDraft(env.DB, conv, 'Again')).rejects.toThrow('unresolved');
  });
});
