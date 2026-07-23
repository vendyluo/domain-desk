import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';
import migration from '../migrations/0001_initial.sql?raw';

beforeEach(async () => {
  for (const table of ['attachments','message_recipients','messages','conversations','contact_email_addresses','contacts','mailbox_identities','products','domains']) await env.DB.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  for (const statement of migration.split(';').map(s => s.trim()).filter(Boolean)) await env.DB.prepare(statement).run();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO domains(id,name) VALUES('domain-1','example.com')"),
    env.DB.prepare("INSERT INTO products(id,domain_id,name) VALUES('product-1','domain-1','Example Product')"),
    env.DB.prepare("INSERT INTO mailbox_identities(id,product_id,address,display_name) VALUES('mailbox-1','product-1','hello@example.com','Hello')")
  ]);
  const listed = await env.ATTACHMENTS.list(); await Promise.all(listed.objects.map(o => env.ATTACHMENTS.delete(o.key)));
});
