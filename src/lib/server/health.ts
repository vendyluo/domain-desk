import type { Env } from '../../types';

const migrationTables = {
  '0001 · inbound CRM graph': [
    'domains',
    'products',
    'mailbox_identities',
    'contacts',
    'contact_email_addresses',
    'conversations',
    'messages',
    'message_recipients',
    'attachments'
  ],
  '0002 · follow-up and contact history': ['next_actions', 'activity_events', 'contact_merges'],
  '0003 · opportunities': ['opportunities', 'opportunity_contacts', 'opportunity_conversations']
} as const;

export type DeploymentHealth = {
  database: { ready: boolean; migrations: { name: string; ready: boolean; missing: string[] }[] };
  attachments: { ready: boolean };
  outbound: { configured: boolean };
  intake: { configured: boolean };
  access: { mode: 'local bypass' | 'Cloudflare Access'; configured: boolean };
};

export async function deploymentHealth(env: Env): Promise<DeploymentHealth> {
  const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
  const present = new Set(tables.results.map((row) => row.name));
  const migrations: { name: string; ready: boolean; missing: string[] }[] = Object.entries(migrationTables).map(
    ([name, required]) => {
      const missing: string[] = required.filter((table) => !present.has(table));
      return { name, ready: missing.length === 0, missing };
    }
  );
  const outboundColumns = await env.DB.prepare(
    "SELECT count(*) n FROM pragma_table_info('messages') WHERE name IN ('direction','delivery_status','delivery_error')"
  ).first<{ n: number }>();
  const outboundReady = outboundColumns?.n === 3;
  migrations.push({
    name: '0004 · outbound replies',
    ready: outboundReady,
    missing: outboundReady ? [] : ['messages outbound columns']
  });
  const channelColumn = await env.DB.prepare(
    "SELECT count(*) n FROM pragma_table_info('messages') WHERE name='channel'"
  ).first<{ n: number }>();
  const intakeReady = channelColumn?.n === 1;
  migrations.push({
    name: '0005 · form intake',
    ready: intakeReady,
    missing: intakeReady ? [] : ['messages.channel']
  });

  let attachmentsReady: boolean;
  try {
    await env.ATTACHMENTS.head('__domain_crm_health_probe_that_must_not_exist__');
    attachmentsReady = true;
  } catch {
    attachmentsReady = false;
  }

  const local = env.LOCAL_DEV === 'true';
  const accessConfigured =
    !local &&
    env.ACCESS_TEAM_DOMAIN?.startsWith('https://') &&
    Boolean(env.ACCESS_AUD) &&
    env.ACCESS_AUD !== 'replace-with-access-application-aud';

  return {
    database: { ready: migrations.every((migration) => migration.ready), migrations },
    attachments: { ready: attachmentsReady },
    outbound: { configured: Boolean(env.EMAIL) },
    intake: { configured: Boolean(env.TURNSTILE_SECRET_KEY) },
    access: { mode: local ? 'local bypass' : 'Cloudflare Access', configured: local || accessConfigured }
  };
}
