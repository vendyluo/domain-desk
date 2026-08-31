import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { deploymentHealth } from '../src/lib/server/health';
import type { Env } from '../src/types';

describe('deployment health', () => {
  it('reports all applied migrations and explicit local Access mode without exposing configuration values', async () => {
    const health = await deploymentHealth({ ...(env as unknown as Env), LOCAL_DEV: 'true' });
    expect(health).toEqual({
      database: {
        ready: true,
        migrations: [
          { name: '0001 · inbound CRM graph', ready: true, missing: [] },
          { name: '0002 · follow-up and contact history', ready: true, missing: [] },
          { name: '0003 · opportunities', ready: true, missing: [] },
          { name: '0004 · outbound replies', ready: true, missing: [] }
        ]
      },
      attachments: { ready: true },
      outbound: { configured: Boolean((env as unknown as Env).EMAIL) },
      access: { mode: 'local bypass', configured: true }
    });
  });

  it('identifies a missing migration table', async () => {
    await env.DB.prepare('DROP TABLE opportunities').run();
    const health = await deploymentHealth(env as unknown as Env);
    expect(health.database.ready).toBe(false);
    expect(health.database.migrations[2]).toMatchObject({ ready: false, missing: ['opportunities'] });
  });
});
