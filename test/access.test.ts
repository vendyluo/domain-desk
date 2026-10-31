import { env } from 'cloudflare:workers';
import { generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { authorizeRequest } from '../src/auth';
import type { Env } from '../src/types';

it('cryptographically rejects wrong audience, issuer, expiry, missing lifetime and signature', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const production = {
    ...(env as Env),
    LOCAL_DEV: 'false',
    ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
    ACCESS_AUD: 'desk-only'
  };
  const now = Math.floor(Date.now() / 1000);
  for (const [overrides, key, expected] of [
    [{}, privateKey, true],
    [{ aud: 'another-app' }, privateKey, false],
    [{ iss: 'https://attacker.test' }, privateKey, false],
    [{ exp: now - 1 }, privateKey, false],
    [{ exp: undefined }, privateKey, false],
    [{}, other.privateKey, false]
  ] as const) {
    const token = await new SignJWT({
      iss: production.ACCESS_TEAM_DOMAIN,
      aud: production.ACCESS_AUD,
      iat: now,
      exp: now + 60,
      ...overrides
    })
      .setProtectedHeader({ alg: 'RS256' })
      .sign(key);
    const request = new Request('https://desk.example/inbox', { headers: { 'Cf-Access-Jwt-Assertion': token } });
    // Substitute only the test public key; signature and all production options
    // still pass through the real jose verifier, without a live JWKS request.
    expect(
      await authorizeRequest(request, production, (jwt, _keys, options) =>
        jwtVerify(jwt, async () => publicKey, options)
      )
    ).toBe(expected);
  }
});
