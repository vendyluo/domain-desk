import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ingestRaw } from '../src/ingest';
import { createNextAction } from '../src/lib/server/actions';
import {
  choosePrimaryEmail,
  getContact,
  listContacts,
  mergeContacts,
  previewContactMerge,
  updateDisplayName
} from '../src/lib/server/contacts';
import type { Env } from '../src/types';

const mail = (from: string, id: string) =>
  new TextEncoder().encode(
    `From: ${from}\r\nTo: hello@example.com\r\nMessage-ID: <${id}>\r\nSubject: ${id}\r\n\r\nBody`
  ).buffer;

async function ingest(from: string, id: string, at: string) {
  await ingestRaw(env as Env, 'hello@example.com', mail(from, id), new Date(at));
  return (await env.DB.prepare('SELECT contact_id FROM messages WHERE subject=?')
    .bind(id)
    .first<{ contact_id: string }>())!.contact_id;
}

describe('contact identity commands', () => {
  it('owns canonical primary state and audits display name edits', async () => {
    const contactId = await ingest('First <first@example.test>', 'first', '2026-01-01Z');
    await env.DB.prepare(
      "INSERT INTO contact_email_addresses(id,contact_id,address,first_seen_at) VALUES('email:second',?,'second@example.test','2026-02-01Z')"
    )
      .bind(contactId)
      .run();
    expect(((await getContact(env.DB, contactId)) as any).contact.primary_email).toBe('first@example.test');
    await choosePrimaryEmail(env.DB, contactId, 'email:second', new Date('2026-03-01Z'));
    expect(((await getContact(env.DB, contactId)) as any).contact.primary_email).toBe('second@example.test');
    await expect(choosePrimaryEmail(env.DB, contactId, 'missing')).rejects.toThrow('belong');
    await updateDisplayName(env.DB, contactId, '  Preferred Name  ', new Date('2026-03-02Z'));
    const event = await env.DB.prepare(
      "SELECT prior_state_json,new_state_json FROM activity_events WHERE event_type='contact.display_name_changed'"
    ).first<any>();
    expect(JSON.parse(event.new_state_json)).toEqual({
      display_name: 'Preferred Name'
    });
    expect(JSON.parse(event.prior_state_json)).toHaveProperty('display_name');
  });

  it('previews and atomically merges relations while preserving attribution and alias history', async () => {
    const survivor = await ingest('Survivor <survivor@example.test>', 'survivor', '2026-01-01Z');
    const duplicate = await ingest('Duplicate <duplicate@example.test>', 'duplicate', '2026-01-02Z');
    await createNextAction(env.DB, {
      description: 'Duplicate work',
      due: '',
      sourceType: 'contact',
      sourceId: duplicate
    });
    const preview = await previewContactMerge(env.DB, survivor, duplicate);
    expect(preview.addresses).toHaveLength(1);
    expect(preview.counts).toMatchObject({
      conversations: 1,
      messages: 1,
      next_actions: 1
    });
    await expect(mergeContacts(env.DB, survivor, duplicate, 'wrong')).rejects.toThrow('confirmation');
    expect(
      (await env.DB.prepare('SELECT contact_id FROM messages WHERE subject=?').bind('duplicate').first<any>())
        .contact_id
    ).toBe(duplicate);
    await mergeContacts(env.DB, survivor, duplicate, duplicate, new Date('2026-02-01Z'));
    expect(await listContacts(env.DB)).toHaveLength(1);
    expect(await getContact(env.DB, duplicate)).toEqual({ aliasOf: survivor });
    const moved = await env.DB.prepare(
      `SELECT m.contact_id,mi.address mailbox,p.name product,d.name domain
      FROM messages m JOIN mailbox_identities mi ON mi.id=m.mailbox_identity_id
      JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id WHERE m.subject=?`
    )
      .bind('duplicate')
      .first<any>();
    expect(moved).toMatchObject({
      contact_id: survivor,
      mailbox: 'hello@example.com',
      product: 'Example Product',
      domain: 'example.com'
    });
    expect(
      (await env.DB.prepare('SELECT count(*) n FROM conversations WHERE contact_id=?').bind(survivor).first<any>()).n
    ).toBe(2);
    const history = await env.DB.prepare(
      'SELECT prior_state_json,provenance_json FROM contact_merges WHERE duplicate_id=?'
    )
      .bind(duplicate)
      .first<any>();
    expect(JSON.parse(history.prior_state_json).relations.messages).toHaveLength(1);
    expect(JSON.parse(history.provenance_json).confirmation).toBe(duplicate);
  });
});
