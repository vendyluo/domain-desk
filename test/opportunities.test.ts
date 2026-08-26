import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ingestRaw } from '../src/ingest';
import { listToday, transitionNextAction } from '../src/lib/server/actions';
import {
  createOpportunity,
  getOpportunity,
  listOpportunities,
  transitionOpportunity
} from '../src/lib/server/opportunities';
import type { Env } from '../src/types';

const message = (from: string, id: string) =>
  new TextEncoder().encode(
    `From: ${from}\r\nTo: hello@example.com\r\nMessage-ID: <${id}>\r\nSubject: Evidence ${id}\r\n\r\nPlease quote this purchase.`
  ).buffer;

async function evidence(id = 'sale') {
  await ingestRaw(
    env as Env,
    'hello@example.com',
    message('Buyer <buyer@test.example>', id),
    new Date('2026-07-20T10:00:00Z')
  );
  return (await env.DB.prepare('SELECT id,contact_id FROM conversations').first<{
    id: string;
    contact_id: string;
  }>())!;
}

async function created() {
  const conversation = await evidence();
  const id = await createOpportunity(
    env.DB,
    {
      title: 'Annual plan',
      desiredOutcome: 'Signed annual contract',
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      productId: 'product-1',
      valueMinor: 12500,
      currency: 'USD'
    },
    new Date('2026-07-20T11:00:00Z')
  );
  return { id, conversation };
}

const events = async () =>
  (await env.DB.prepare('SELECT event_type,subject_type,reason FROM activity_events ORDER BY occurred_at,id').all())
    .results;

describe('Slice 3B opportunities', () => {
  it('creates from matching evidence and returns filters, detail snapshots, and attribution', async () => {
    const { id, conversation } = await created();
    const listed: any[] = (await listOpportunities(env.DB, 'new')) as any[];
    expect(listed[0]).toMatchObject({
      id,
      state: 'new',
      product: 'Example Product',
      domain: 'example.com',
      value_minor: 12500,
      currency: 'USD'
    });
    expect(await listOpportunities(env.DB, 'won')).toHaveLength(0);
    await expect(listOpportunities(env.DB, 'bogus')).rejects.toThrow('Invalid opportunity filter');
    const detail: any = await getOpportunity(env.DB, id);
    expect(detail.evidence[0]).toMatchObject({
      conversation_id: conversation.id,
      product: 'Example Product',
      domain: 'example.com',
      mailbox: 'hello@example.com'
    });
    expect(detail.history.map((event: any) => event.event_type)).toEqual(['opportunity.created']);
  });

  it('validates evidence identity and money without partial creation', async () => {
    const conversation = await evidence();
    const base = { title: 'Sale', desiredOutcome: 'Contract', conversationId: conversation.id };
    await expect(createOpportunity(env.DB, { ...base, contactId: 'wrong' })).rejects.toThrow('contact');
    await expect(createOpportunity(env.DB, { ...base, productId: 'wrong' })).rejects.toThrow('product');
    await expect(createOpportunity(env.DB, { ...base, valueMinor: -1, currency: 'USD' })).rejects.toThrow(
      'non-negative'
    );
    await expect(createOpportunity(env.DB, { ...base, valueMinor: 1.2, currency: 'USD' })).rejects.toThrow('integer');
    await expect(createOpportunity(env.DB, { ...base, valueMinor: 10, currency: 'usd' })).rejects.toThrow('uppercase');
    await expect(createOpportunity(env.DB, { ...base, currency: 'USD' })).rejects.toThrow('requires a value');
    expect((await env.DB.prepare('SELECT count(*) count FROM opportunities').first<{ count: number }>())!.count).toBe(
      0
    );
  });

  it('enforces the exact lifecycle, actor, command, reason, and archive constraints', async () => {
    const { id } = await created();
    await expect(transitionOpportunity(env.DB, id, 'activate', { nextAction: 'Call' })).rejects.toThrow('new');
    await expect(transitionOpportunity(env.DB, id, 'teleport')).rejects.toThrow('Unknown');
    await expect(transitionOpportunity(env.DB, id, 'qualify', {}, 'system')).rejects.toThrow('personal owner');
    await expect(transitionOpportunity(env.DB, 'missing', 'qualify')).rejects.toThrow('not found');
    await transitionOpportunity(env.DB, id, 'qualify');
    await expect(transitionOpportunity(env.DB, id, 'activate', {})).rejects.toThrow('Next action');
    await transitionOpportunity(env.DB, id, 'activate', { nextAction: 'Book call' });
    await expect(transitionOpportunity(env.DB, id, 'archive')).rejects.toThrow('active');
    await expect(transitionOpportunity(env.DB, id, 'win', {})).rejects.toThrow('Outcome reason');
    await transitionOpportunity(env.DB, id, 'win', { reason: 'Signed' });
    expect(
      await env.DB.prepare('SELECT status,is_designated,cancel_reason FROM next_actions WHERE opportunity_id=?')
        .bind(id)
        .first()
    ).toMatchObject({
      status: 'cancelled',
      is_designated: 0,
      cancel_reason: 'Opportunity marked won: Signed'
    });
    await transitionOpportunity(env.DB, id, 'archive');
    expect(
      (await env.DB.prepare('SELECT state,outcome_reason FROM opportunities WHERE id=?').bind(id).first())!
    ).toMatchObject({ state: 'archived', outcome_reason: 'Signed' });
    const auditTypes = (await events()).map((event: any) => event.event_type);
    expect(auditTypes.filter((type) => type.startsWith('opportunity.'))).toEqual([
      'opportunity.created',
      'opportunity.qualified',
      'opportunity.activated',
      'opportunity.won',
      'opportunity.archived'
    ]);
    expect(auditTypes.filter((type) => type === 'next_action.created')).toHaveLength(1);
    expect(auditTypes.filter((type) => type === 'next_action.cancelled')).toHaveLength(1);
  });

  it('maintains exactly one designated open action through activation and reopen', async () => {
    const { id } = await created();
    await transitionOpportunity(env.DB, id, 'qualify');
    await transitionOpportunity(env.DB, id, 'activate', { nextAction: 'First' });
    expect((await listToday(env.DB, new Date('2026-07-23T12:00:00Z'))).due).toHaveLength(1);
    await transitionOpportunity(env.DB, id, 'lose', { reason: 'Paused' });
    expect(
      (await env.DB.prepare("SELECT count(*) count FROM next_actions WHERE opportunity_id=? AND status='open'")
        .bind(id)
        .first<{ count: number }>())!.count
    ).toBe(0);
    await expect(transitionOpportunity(env.DB, id, 'reopen', {})).rejects.toThrow('Next action');
    await transitionOpportunity(env.DB, id, 'reopen', { nextAction: 'Try later' });
    expect(
      (await env.DB.prepare(
        "SELECT count(*) count FROM next_actions WHERE opportunity_id=? AND status='open' AND is_designated=1"
      )
        .bind(id)
        .first<{ count: number }>())!.count
    ).toBe(1);
    expect((await events()).filter((event: any) => event.event_type === 'next_action.created')).toHaveLength(2);
  });

  it('rejects designated completion atomically when no replacement or exit is supplied', async () => {
    const { id } = await created();
    await transitionOpportunity(env.DB, id, 'qualify');
    await transitionOpportunity(env.DB, id, 'activate', { nextAction: 'Call' });
    const action = (await env.DB.prepare('SELECT id FROM next_actions WHERE opportunity_id=?')
      .bind(id)
      .first<{ id: string }>())!;
    const before = await events();
    await expect(transitionNextAction(env.DB, action.id, 'complete')).rejects.toThrow(
      'replacement or a won/lost outcome'
    );
    await expect(transitionNextAction(env.DB, action.id, 'cancel', { reason: 'No longer useful' })).rejects.toThrow(
      'replacement or a won/lost outcome'
    );
    expect(
      await env.DB.prepare('SELECT status,is_designated FROM next_actions WHERE id=?').bind(action.id).first()
    ).toMatchObject({ status: 'open', is_designated: 1 });
    expect(await events()).toEqual(before);
  });

  it('atomically replaces designated actions or exits active with precise action and opportunity events', async () => {
    const { id } = await created();
    await transitionOpportunity(env.DB, id, 'qualify');
    await transitionOpportunity(env.DB, id, 'activate', { nextAction: 'Call' });
    let action = (await env.DB.prepare('SELECT id FROM next_actions WHERE opportunity_id=? AND is_designated=1')
      .bind(id)
      .first<{ id: string }>())!;
    await transitionNextAction(
      env.DB,
      action.id,
      'complete',
      { replacement: 'Send terms' },
      new Date('2026-07-21T10:00:00Z')
    );
    expect(
      await env.DB.prepare('SELECT status,is_designated FROM next_actions WHERE id=?').bind(action.id).first()
    ).toMatchObject({ status: 'completed', is_designated: 0 });
    action = (await env.DB.prepare(
      "SELECT id FROM next_actions WHERE opportunity_id=? AND status='open' AND is_designated=1"
    )
      .bind(id)
      .first<{ id: string }>())!;
    await transitionNextAction(
      env.DB,
      action.id,
      'cancel',
      { reason: 'Customer decided', exit: 'lost', outcomeReason: 'Budget removed' },
      new Date('2026-07-22T10:00:00Z')
    );
    expect(
      await env.DB.prepare('SELECT state,outcome_reason FROM opportunities WHERE id=?').bind(id).first()
    ).toMatchObject({ state: 'lost', outcome_reason: 'Budget removed' });
    const audit: any[] = (await events()) as any[];
    expect(audit.filter((event) => event.event_type === 'next_action.created')).toHaveLength(2);
    expect(audit.find((event) => event.event_type === 'next_action.completed')?.subject_type).toBe('next_action');
    expect(audit.find((event) => event.event_type === 'next_action.cancelled')?.reason).toBe('Customer decided');
    expect(audit.find((event) => event.event_type === 'opportunity.lost')?.reason).toBe('Budget removed');
  });
});
