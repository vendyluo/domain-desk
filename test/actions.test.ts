import { env } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';
import { ingestRaw } from '../src/ingest';
import { createNextAction, listToday, parseDue, transitionNextAction } from '../src/lib/server/actions';
import { getContact } from '../src/lib/server/contacts';
import { setHandled } from '../src/lib/server/inbox';
import type { Env } from '../src/types';
const mail = (from: string, id: string) =>
  new TextEncoder().encode(
    `From: ${from}\r\nTo: hello@example.com\r\nMessage-ID: <${id}>\r\nSubject: ${id}\r\n\r\nBody`
  ).buffer;
describe('Slice 3A services', () => {
  it('queues, transitions and audits source-linked actions', async () => {
    await ingestRaw(env as Env, 'hello@example.com', mail('A <a@x.test>', 'one'), new Date('2026-07-22T10:00:00Z'));
    const c = await env.DB.prepare('SELECT id,contact_id FROM conversations').first<{
      id: string;
      contact_id: string;
    }>();
    const id = await createNextAction(
      env.DB,
      {
        description: ' Follow up ',
        due: '2026-07-23T09:00',
        sourceType: 'conversation',
        sourceId: c!.id
      },
      new Date('2026-07-22T11:00:00Z')
    );
    expect((await listToday(env.DB, new Date('2026-07-23T12:00:00Z'))).due).toHaveLength(1);
    await transitionNextAction(env.DB, id, 'reschedule', { due: '2026-07-22T09:00' }, new Date('2026-07-22T12:00:00Z'));
    expect((await listToday(env.DB, new Date('2026-07-23T12:00:00Z'))).overdue).toHaveLength(1);
    await transitionNextAction(env.DB, id, 'complete', {}, new Date('2026-07-23T13:00:00Z'));
    const row = await env.DB.prepare('SELECT * FROM next_actions WHERE id=?').bind(id).first<any>();
    expect(row).toMatchObject({
      status: 'completed',
      completion_source: 'manual',
      source_type: 'conversation',
      source_id: c!.id
    });
    expect(
      (
        await env.DB.prepare('SELECT * FROM activity_events WHERE subject_id=? ORDER BY occurred_at').bind(id).all()
      ).results.map((x: any) => x.event_type)
    ).toEqual(['next_action.created', 'next_action.rescheduled', 'next_action.completed']);
    await expect(transitionNextAction(env.DB, id, 'cancel', { reason: 'no' })).rejects.toThrow('completed');
    await transitionNextAction(env.DB, id, 'reopen', {
      reason: 'Needed again'
    });
    expect((await env.DB.prepare('SELECT status FROM next_actions WHERE id=?').bind(id).first<any>()).status).toBe(
      'open'
    );
  });
  it('validates input and records inbox handling history', async () => {
    expect(() => parseDue('2026-02-30T10:00')).toThrow();
    await expect(
      createNextAction(env.DB, {
        description: '',
        due: '',
        sourceType: 'contact',
        sourceId: 'missing'
      })
    ).rejects.toThrow();
    await ingestRaw(env as Env, 'hello@example.com', mail('A <a@x.test>', 'two'));
    const c = await env.DB.prepare('SELECT id FROM conversations').first<{
      id: string;
    }>();
    await setHandled(env.DB, c!.id, false, new Date('2026-01-01Z'));
    await setHandled(env.DB, c!.id, true, new Date('2026-01-02Z'));
    expect(
      (await env.DB.prepare('SELECT count(*) n FROM activity_events WHERE subject_id=?')
        .bind(c!.id)
        .first<{ n: number }>())!.n
    ).toBe(2);
  });
  it('rejects an unknown transition command without mutation or event', async () => {
    await ingestRaw(env as Env, 'hello@example.com', mail('A <a@x.test>', 'unknown'));
    const contact = await env.DB.prepare('SELECT id FROM contacts').first<{
      id: string;
    }>();
    const id = await createNextAction(env.DB, {
      description: 'Keep real',
      due: '',
      sourceType: 'contact',
      sourceId: contact!.id
    });
    const before = (await env.DB.prepare('SELECT count(*) n FROM activity_events WHERE subject_id=?')
      .bind(id)
      .first<{ n: number }>())!.n;
    await expect(transitionNextAction(env.DB, id, 'teleport', { due: '2027-01-01T10:00' })).rejects.toThrow('Unknown');
    expect(await env.DB.prepare('SELECT status,due_at FROM next_actions WHERE id=?').bind(id).first()).toMatchObject({
      status: 'open',
      due_at: null
    });
    expect(
      (await env.DB.prepare('SELECT count(*) n FROM activity_events WHERE subject_id=?')
        .bind(id)
        .first<{ n: number }>())!.n
    ).toBe(before);
  });
  it('builds one canonical timeline across products and domains', async () => {
    await ingestRaw(env as Env, 'hello@example.com', mail('Same <same@x.test>', 'a'), new Date('2026-01-01Z'));
    await env.DB.batch([
      env.DB.prepare("INSERT INTO domains VALUES('d2','other.test',CURRENT_TIMESTAMP)"),
      env.DB.prepare("INSERT INTO products VALUES('p2','d2','Other',CURRENT_TIMESTAMP)"),
      env.DB.prepare("INSERT INTO mailbox_identities VALUES('m2','p2','hi@other.test',NULL,CURRENT_TIMESTAMP)")
    ]);
    await ingestRaw(env as Env, 'hi@other.test', mail('Same <same@x.test>', 'b'), new Date('2026-01-02Z'));
    expect(
      (await env.DB.prepare('SELECT count(*) n FROM contacts').first<{
        n: number;
      }>())!.n
    ).toBe(1);
    const id = (await env.DB.prepare('SELECT id FROM contacts').first<{
      id: string;
    }>())!.id;
    const detail: any = await getContact(env.DB, id);
    expect(detail.messages.map((x: any) => x.product)).toEqual(['Other', 'Example Product']);
  });
});

describe('Today queue completeness', () => {
  it('keeps undated open actions visible in the due group on any day', async () => {
    await ingestRaw(env as Env, 'hello@example.com', mail('A <a@x.test>', 'undated'), new Date('2026-05-01Z'));
    const contact = (await env.DB.prepare('SELECT id FROM contacts').first<{ id: string }>())!;
    const id = await createNextAction(
      env.DB,
      { description: 'Call them back', due: '', sourceType: 'contact', sourceId: contact.id },
      new Date('2026-05-01T10:00:00Z')
    );
    const today = await listToday(env.DB, new Date('2026-06-15T12:00:00Z'));
    expect(today.due.map((x: any) => x.id)).toContain(id);
    expect(today.overdue).toHaveLength(0);
  });
});
