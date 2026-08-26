import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';
import migration from '../migrations/0001_initial.sql?raw';
import slice3a from '../migrations/0002_slice_3a.sql?raw';
import slice3b from '../migrations/0003_opportunities.sql?raw';

beforeEach(async () => {
  for (const table of [
    'contact_merges',
    'opportunity_conversations',
    'opportunity_contacts',
    'activity_events',
    'next_actions',
    'opportunities',
    'attachments',
    'message_recipients',
    'messages',
    'conversations',
    'contact_email_addresses',
    'contacts',
    'mailbox_identities',
    'products',
    'domains'
  ])
    await env.DB.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  for (const sql of [migration, slice3a, slice3b])
    for (const statement of sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await env.DB.prepare(statement).run();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO domains(id,name) VALUES('domain-1','example.com')"),
    env.DB.prepare("INSERT INTO products(id,domain_id,name) VALUES('product-1','domain-1','Example Product')"),
    env.DB.prepare(
      "INSERT INTO mailbox_identities(id,product_id,address,display_name) VALUES('mailbox-1','product-1','hello@example.com','Hello')"
    )
  ]);
  const listed = await env.ATTACHMENTS.list();
  await Promise.all(listed.objects.map((o) => env.ATTACHMENTS.delete(o.key)));
});
