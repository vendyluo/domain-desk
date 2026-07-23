import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './types';

const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
type Verify = typeof jwtVerify;

export async function authorizeRequest(request: Request, env: Env, verify: Verify = jwtVerify): Promise<boolean> {
  if (env.LOCAL_DEV === 'true') return true;
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  const issuer = env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  if (!assertion || !issuer?.startsWith('https://') || !env.ACCESS_AUD || env.ACCESS_AUD === 'replace-with-access-application-aud') return false;
  try {
    let keys = keysets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      keysets.set(issuer, keys);
    }
    await verify(assertion, keys, { issuer, audience: env.ACCESS_AUD });
    return true;
  } catch {
    return false;
  }
}
