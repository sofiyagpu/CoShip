import { it, expect } from 'vitest';
import Fastify from 'fastify';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.js';
import { actorId, newSession } from '../apps/server/src/auth.js';

it('verifies OIDC state, nonce, signature, audience and company membership against an actual test IdP', async () => {
  const idp = Fastify();
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  let issuer = '',
    nonce = '',
    domain = 'company.example',
    audience = 'client';
  idp.get('/.well-known/openid-configuration', async () => ({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
  }));
  idp.get('/jwks', async () => ({ keys: [jwk] }));
  idp.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, new URLSearchParams(String(body))),
  );
  idp.post('/token', async () => ({
    id_token: await new SignJWT({
      nonce,
      hd: domain,
      email: 'user@company.example',
      email_verified: true,
      name: 'OIDC User',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('oidc-user')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey),
  }));
  issuer = await idp.listen({ host: '127.0.0.1', port: 0 });
  const { server, db } = await createApp({
    mode: 'test',
    port: 0,
    host: '127.0.0.1',
    publicUrl: 'http://localhost',
    dataDir: ':memory:',
    orgName: 'OIDC Test',
    region: 'KZ',
    oidcIssuer: issuer,
    oidcClientId: 'client',
    oidcClientSecret: 'test-secret',
    oidcDomain: 'company.example',
  });
  const id = actorId(issuer, 'oidc-user');
  await db.query(
    'INSERT INTO users(id,org_id,name,email,issuer,subject) VALUES($1,$2,$3,$4,$5,$6)',
    [id, 'org_coship', 'OIDC User', 'user@company.example', issuer, 'oidc-user'],
  );
  async function start() {
    const r = await server.inject('/api/auth/oidc');
    expect(r.statusCode).toBe(302);
    const url = new URL(r.headers.location!);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    nonce = url.searchParams.get('nonce')!;
    return {
      state: url.searchParams.get('state')!,
      cookie: String(r.headers['set-cookie']).split(';')[0],
    };
  }
  const callback = (s: { state: string; cookie: string }) =>
    server.inject({
      url: `/api/auth/callback?state=${s.state}&code=authorization-code`,
      headers: { cookie: s.cookie },
    });
  try {
    const first = await start();
    const valid = await callback(first);
    expect(valid.statusCode).toBe(302);
    expect(valid.headers['set-cookie']).toBeTruthy();
    expect((await callback(first)).statusCode).toBe(400);
    const wrongState = await start();
    expect((await callback({ ...wrongState, cookie: 'coship_oidc=other' })).statusCode).toBe(400);
    const wrongNonce = await start();
    nonce = 'wrong';
    expect((await callback(wrongNonce)).statusCode).toBe(401);
    const wrongDomain = await start();
    domain = 'attacker.example';
    expect((await callback(wrongDomain)).statusCode).toBe(403);
    domain = 'company.example';
    const wrongAudience = await start();
    audience = 'other-client';
    expect((await callback(wrongAudience)).statusCode).toBe(401);
  } finally {
    await server.close();
    await idp.close();
  }
});

it('applies a full directory snapshot atomically and revokes omitted accounts', async () => {
  const issuer = 'https://identity.example',
    directoryToken = randomUUID();
  const { server, db } = await createApp({
    mode: 'test',
    port: 0,
    host: '127.0.0.1',
    publicUrl: 'http://localhost',
    dataDir: ':memory:',
    orgName: 'Directory Test',
    region: 'KZ',
    oidcIssuer: issuer,
    directoryToken,
  });
  const admin = actorId(issuer, 'admin'),
    employee = actorId(issuer, 'employee');
  try {
    await db.query("UPDATE users SET admin=false WHERE id='demo-sofia'");
    await db.query(
      'INSERT INTO users(id,org_id,name,email,admin,issuer,subject) VALUES($1,$2,$3,$4,true,$5,$6)',
      [admin, 'org_coship', 'Admin', 'admin@example.test', issuer, 'admin'],
    );
    const snapshot = {
      complete: true,
      users: [
        { subject: 'admin', name: 'Admin', email: 'admin@example.test', active: true, groups: [] },
        {
          subject: 'employee',
          name: 'Employee',
          email: 'employee@example.test',
          active: true,
          groups: [{ id: 'sales-stable-id', name: 'Sales' }],
        },
      ],
    };
    const sync = (body: unknown) =>
      server.inject({
        method: 'POST',
        url: '/api/admin/directory/sync',
        headers: { authorization: `Bearer ${directoryToken}` },
        payload: body as any,
      });
    expect((await sync(snapshot)).statusCode).toBe(200);
    const token = await newSession(db, employee, 'browser');
    expect(
      (await server.inject({ url: '/api/me', headers: { cookie: `coship_session=${token}` } }))
        .statusCode,
    ).toBe(200);
    expect((await sync({ complete: true, users: [snapshot.users[0]] })).statusCode).toBe(200);
    expect(
      (await server.inject({ url: '/api/me', headers: { cookie: `coship_session=${token}` } }))
        .statusCode,
    ).toBe(401);
    const previous = (
      await db.query("SELECT directory_synced_at FROM organizations WHERE id='org_coship'")
    ).rows[0].directory_synced_at;
    expect((await sync({ complete: true, users: [] })).statusCode).toBe(409);
    expect((await db.query('SELECT active FROM users WHERE id=$1', [admin])).rows[0].active).toBe(
      true,
    );
    expect(
      (await db.query("SELECT directory_synced_at FROM organizations WHERE id='org_coship'"))
        .rows[0].directory_synced_at,
    ).toEqual(previous);
  } finally {
    await server.close();
  }
});
