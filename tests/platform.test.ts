import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.js';
import { templatePacket } from '../packages/shared/src/templates.js';
import { newSession } from '../apps/server/src/auth.js';
import { sweepLifecycle } from '../apps/server/src/lifecycle.js';
import type { Config } from '../apps/server/src/config.js';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../apps/server/src/db.js';

export const testConfig: Config = {
  mode: 'test',
  port: 0,
  host: '127.0.0.1',
  publicUrl: 'http://localhost',
  dataDir: ':memory:',
  databaseUrl: process.env.COSHIP_TEST_DATABASE_URL,
  orgName: 'Test Company',
  region: 'KZ',
  museApiKey: 'test-key',
  museBaseUrl: 'https://muse.test/v1',
  museModel: 'muse-spark-1.3',
};
describe('CoShip platform security and lifecycle', () => {
  let server: FastifyInstance, db: Database, owner: string, anna: string, daniel: string;
  const request = (
    method: any,
    url: string,
    token?: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    server.inject({
      method,
      url,
      headers: { 'x-coship-request': '1', ...(token ? { cookie: token } : {}), ...headers },
      ...(body !== undefined
        ? {
            payload: JSON.stringify(body),
            headers: {
              'content-type': 'application/json',
              'x-coship-request': '1',
              ...(token ? { cookie: token } : {}),
              ...headers,
            },
          }
        : {}),
    });
  async function login(id: string) {
    const response = await request('POST', '/api/auth/demo', undefined, { user_id: id });
    expect(response.statusCode).toBe(200);
    return String(response.headers['set-cookie']).split(';')[0];
  }
  async function create(name = 'Test app') {
    const packet = templatePacket('tracker', name);
    const r = await request('POST', '/api/deployments', owner, {
      packet,
      idempotency_key: randomUUID(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('active');
    return { packet, appId: r.json().app_id, release: r.json().release_id };
  }
  const grant = (
    appId: string,
    user: string,
    role: string | null = 'viewer',
    management: string | null = null,
  ) =>
    request('PUT', `/api/apps/${appId}/grants`, owner, {
      subject_type: 'user',
      subject_id: user,
      data_role: role,
      management_role: management,
    });
  const data = (appId: string, release: string, token: string, input: unknown) =>
    request('POST', `/api/apps/${appId}/data`, token, {
      release_id: release,
      ...(input as object),
    });
  beforeAll(async () => {
    ({ server, db } = await createApp(testConfig));
    owner = await login('demo-sofia');
    anna = await login('demo-anna');
    daniel = await login('demo-daniel');
  });
  afterAll(async () => {
    await server.close();
  });
  it('requires authentication and rejects foreign origins / missing CSRF headers', async () => {
    expect((await request('GET', '/api/apps')).statusCode).toBe(401);
    expect(
      (
        await request(
          'POST',
          '/api/auth/demo',
          undefined,
          { user_id: 'demo-sofia' },
          { origin: 'https://attacker.example' },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/auth/demo',
          payload: { user_id: 'demo-sofia' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('publishes privately, enforces sharing for HTML and data, and rejects viewer writes', async () => {
    const a = await create();
    expect((await request('GET', `/api/apps/${a.appId}/launch`, anna)).statusCode).toBe(403);
    expect(
      (await data(a.appId, a.release, anna, { collection: 'items', operation: 'list' })).statusCode,
    ).toBe(403);
    expect((await grant(a.appId, 'demo-anna')).statusCode).toBe(200);
    expect((await request('GET', `/api/apps/${a.appId}/launch`, anna)).statusCode).toBe(200);
    expect(
      (
        await data(a.appId, a.release, anna, {
          collection: 'items',
          operation: 'insert',
          payload: { title: 'No', done: false },
          idempotency_key: randomUUID(),
        })
      ).statusCode,
    ).toBe(403);
    await request('DELETE', `/api/apps/${a.appId}/grants/user/demo-anna`, owner);
    expect((await request('GET', `/api/apps/${a.appId}/launch`, anna)).statusCode).toBe(403);
  });
  it('allows writes only with a valid schema, scoped collection and revision', async () => {
    const a = await create();
    await grant(a.appId, 'demo-anna', 'user');
    const key = randomUUID();
    const input = {
      operation: 'insert',
      collection: 'items',
      payload: { title: 'Task', done: false },
      idempotency_key: key,
    };
    const inserted = await data(a.appId, a.release, anna, input);
    expect(inserted.statusCode).toBe(200);
    const record = inserted.json();
    const retry = await data(a.appId, a.release, anna, input);
    expect(retry.json().id).toBe(record.id);
    expect(
      (
        await data(a.appId, a.release, anna, {
          ...input,
          payload: { title: 'changed', done: false },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await data(a.appId, a.release, anna, {
          ...input,
          idempotency_key: randomUUID(),
          payload: { title: 1, done: false },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await data(a.appId, a.release, anna, { operation: 'list', collection: 'secrets' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await data(a.appId, a.release, anna, {
          operation: 'list',
          collection: 'items',
          user_id: 'demo-sofia',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await data(a.appId, a.release, anna, {
          operation: 'update',
          collection: 'items',
          id: record.id,
          revision: 1,
          payload: { title: 'Done', done: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await data(a.appId, a.release, anna, {
          operation: 'delete',
          collection: 'items',
          id: record.id,
          revision: 1,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await data(a.appId, a.release, anna, {
          operation: 'delete',
          collection: 'items',
          id: record.id,
          revision: 2,
        })
      ).statusCode,
    ).toBe(200);
  });
  it('does not grant a new owner implicit data access', async () => {
    const a = await create();
    expect(
      (await request('POST', `/api/apps/${a.appId}/owner`, owner, { owner_id: 'demo-anna' }))
        .statusCode,
    ).toBe(200);
    expect((await request('GET', `/api/apps/${a.appId}`, anna)).json().management_role).toBe(
      'owner',
    );
    expect((await request('GET', `/api/apps/${a.appId}/launch`, anna)).statusCode).toBe(403);
  });
  it('copies code and schema without records, comments or grants', async () => {
    const a = await create();
    await grant(a.appId, 'demo-anna', 'user');
    await data(a.appId, a.release, owner, {
      operation: 'insert',
      collection: 'items',
      payload: { title: 'private', done: false },
      idempotency_key: randomUUID(),
    });
    await request('POST', `/api/apps/${a.appId}/comments`, owner, { body: 'Original discussion' });
    const copy = (await request('POST', `/api/apps/${a.appId}/copy`, owner, {})).json();
    expect(copy.status).toBe('active');
    expect(copy.app_id).not.toBe(a.appId);
    expect(
      (
        await data(copy.app_id, copy.release_id, owner, { operation: 'list', collection: 'items' })
      ).json().items,
    ).toHaveLength(0);
    expect((await request('GET', `/api/apps/${copy.app_id}/comments`, owner)).json()).toHaveLength(
      0,
    );
    expect((await request('GET', `/api/apps/${copy.app_id}/launch`, anna)).statusCode).toBe(403);
  });
  it('preserves the active release on rejected secret scans, unsupported functions and destructive schema changes', async () => {
    const a = await create();
    const packet = structuredClone(a.packet);
    packet.files['unsafe.txt'] = '-----BEGIN PRIVATE KEY-----';
    const bad = (
      await request('POST', '/api/deployments', owner, {
        packet,
        app_id: a.appId,
        expected_release_id: a.release,
        idempotency_key: randomUUID(),
      })
    ).json();
    expect(bad.status).toBe('failed');
    expect(bad.error.code).toBe('SECRET_DETECTED');
    expect(JSON.stringify(bad)).not.toContain('BEGIN PRIVATE');
    const functions = structuredClone(a.packet);
    functions.manifest.functions = { test: 'test.ts' };
    functions.files['test.ts'] = 'export default async () => 1';
    expect(
      (
        await request('POST', '/api/deployments', owner, {
          packet: functions,
          app_id: a.appId,
          expected_release_id: a.release,
          idempotency_key: randomUUID(),
        })
      ).json().error.code,
    ).toBe('RUNNER_UNAVAILABLE');
    const destructive = structuredClone(a.packet);
    delete destructive.manifest.data.collections.items;
    expect(
      (
        await request('POST', '/api/deployments', owner, {
          packet: destructive,
          app_id: a.appId,
          expected_release_id: a.release,
          idempotency_key: randomUUID(),
        })
      ).json().error.code,
    ).toBe('DESTRUCTIVE_SCHEMA');
    expect((await request('GET', `/api/apps/${a.appId}`, owner)).json().active_release_id).toBe(
      a.release,
    );
  });
  it('enforces immutable version targets, idempotent publishing and safe code rollback', async () => {
    const a = await create(),
      packet = structuredClone(a.packet);
    packet.files['index.html'] = packet.files['index.html'].replace('Общий список', 'Новый список');
    const body = {
      packet,
      app_id: a.appId,
      expected_release_id: a.release,
      idempotency_key: randomUUID(),
    };
    const release = (await request('POST', '/api/deployments', owner, body)).json();
    expect(release.status, JSON.stringify(release.error)).toBe('active');
    expect((await request('POST', '/api/deployments', owner, body)).json().id).toBe(release.id);
    expect(
      (await request('POST', '/api/deployments', owner, { ...body, packet: a.packet })).statusCode,
    ).toBe(409);
    const conflict = (
      await request('POST', '/api/deployments', owner, { ...body, idempotency_key: randomUUID() })
    ).json();
    expect(conflict.error.code).toBe('RELEASE_CONFLICT');
    expect(
      (await data(a.appId, a.release, owner, { operation: 'list', collection: 'items' }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await request('POST', `/api/apps/${a.appId}/rollback`, owner, {
          release_id: a.release,
          expected_release_id: release.release_id,
        })
      ).statusCode,
    ).toBe(200);
    expect((await request('GET', `/api/apps/${a.appId}`, owner)).json().active_release_id).toBe(
      a.release,
    );
  });
  it('enforces tenant boundaries even with known foreign app identifiers', async () => {
    await db.query("INSERT INTO organizations(id,name,region) VALUES('other','Other','KZ')");
    await db.query(
      "INSERT INTO users(id,org_id,name,email,avatar) VALUES('other-user','other','Other','other@example.test','OT')",
    );
    const a = await create();
    expect((await grant(a.appId, 'other-user')).statusCode).toBe(400);
    const token = await newSession(db, 'other-user', 'browser');
    expect(
      (await request('GET', `/api/apps/${a.appId}/launch`, `coship_session=${token}`)).statusCode,
    ).toBe(404);
  });
  it('uses real PostgreSQL RLS with a non-owner runtime role and clears pooled context', async () => {
    const a = await create(),
      b = await create();
    await data(a.appId, a.release, owner, {
      operation: 'insert',
      collection: 'items',
      payload: { title: 'A', done: false },
      idempotency_key: randomUUID(),
    });
    await data(b.appId, b.release, owner, {
      operation: 'insert',
      collection: 'items',
      payload: { title: 'B', done: false },
      idempotency_key: randomUUID(),
    });
    await db.transaction(async (tx) => {
      await tx.query(
        "SELECT set_config('coship.org_id','org_coship',true),set_config('coship.app_id',$1,true)",
        [a.appId],
      );
      await tx.query('SET LOCAL ROLE coship_data_runtime');
      const rows = (await tx.query('SELECT * FROM records')).rows;
      expect(rows.length).toBe(1);
      expect(rows[0].payload.title).toBe('A');
      expect(
        (await tx.query('SELECT * FROM records WHERE app_id=$1', [b.appId])).rows,
      ).toHaveLength(0);
    });
    await db.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE coship_data_runtime');
      expect((await tx.query('SELECT * FROM records')).rows).toHaveLength(0);
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE coship_data_runtime');
        await tx.query('SELECT * FROM secrets');
      }),
    ).rejects.toThrow();
  });
  it('archives automatically without deleting records and restores access', async () => {
    const a = await create();
    await data(a.appId, a.release, owner, {
      operation: 'insert',
      collection: 'items',
      payload: { title: 'Preserve', done: false },
      idempotency_key: randomUUID(),
    });
    await db.query("UPDATE apps SET last_used_at=now()-interval '70 days' WHERE id=$1", [a.appId]);
    await sweepLifecycle(db);
    expect((await request('GET', `/api/apps/${a.appId}`, owner)).json().status).toBe(
      'archive_pending',
    );
    await db.query("UPDATE apps SET archive_after=now()-interval '1 day' WHERE id=$1", [a.appId]);
    await sweepLifecycle(db);
    expect((await request('GET', `/api/apps/${a.appId}/launch`, owner)).statusCode).toBe(409);
    await request('POST', `/api/apps/${a.appId}/archive`, owner, { archived: false });
    expect(
      (await data(a.appId, a.release, owner, { operation: 'list', collection: 'items' })).json()
        .items,
    ).toHaveLength(1);
  });
  it('keeps secrets encrypted and out of read APIs, source packets and logs', async () => {
    const secret = 'test-sensitive-value-for-vault';
    expect(
      (await request('POST', '/api/admin/secrets', owner, { name: 'TEST_KEY', value: secret }))
        .statusCode,
    ).toBe(200);
    const row = (await db.query('SELECT * FROM secrets WHERE name=$1', ['TEST_KEY'])).rows[0];
    expect(row.encrypted).not.toContain(secret);
    const listed = await request('GET', '/api/admin/secrets', owner);
    expect(listed.body).not.toContain(secret);
    expect(listed.body).not.toContain('ciphertext');
    expect((await request('GET', '/api/admin/secrets', anna)).statusCode).toBe(403);
    expect(JSON.stringify((await db.query('SELECT * FROM audit_events')).rows)).not.toContain(
      secret,
    );
  });
  it('scopes CLI credentials to code publication instead of production records', async () => {
    const a = await create(),
      token = await newSession(db, 'demo-sofia', 'cli');
    expect(
      (
        await request('GET', `/api/apps/${a.appId}/source`, undefined, undefined, {
          authorization: `Bearer ${token}`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request('GET', `/api/apps/${a.appId}/launch`, undefined, undefined, {
          authorization: `Bearer ${token}`,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request(
          'POST',
          `/api/apps/${a.appId}/data`,
          undefined,
          { release_id: a.release, operation: 'list', collection: 'items' },
          { authorization: `Bearer ${token}` },
        )
      ).statusCode,
    ).toBe(403);
  });
  it('generates apps from prompts and lets builders, not viewers, change them together', async () => {
    const replies = [templatePacket('tracker', 'Склад'), templatePacket('tracker', 'Склад v2')];
    const calls: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const content = '```json\n' + JSON.stringify(replies[calls.length - 1]) + '\n```';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    });
    try {
      const created = (
        await request('POST', '/api/apps/generate', owner, { prompt: 'Учёт склада' })
      ).json();
      expect(created.status).toBe('active');
      expect(calls[0].url).toBe('https://muse.test/v1/chat/completions');
      expect(calls[0].body.model).toBe('muse-spark-1.3');
      await grant(created.app_id, 'demo-anna', 'user', 'builder');
      await grant(created.app_id, 'demo-daniel', 'user');
      const denied = await request('POST', `/api/apps/${created.app_id}/generate`, daniel, {
        prompt: 'Добавь поле',
        expected_release_id: created.release_id,
      });
      expect(denied.statusCode).toBe(403);
      const edited = (
        await request('POST', `/api/apps/${created.app_id}/generate`, anna, {
          prompt: 'Переименуй в Склад v2',
          expected_release_id: created.release_id,
        })
      ).json();
      expect(edited.status).toBe('active');
      expect(calls[1].body.messages[1].content).toContain('Current app');
      const thread = (await request('GET', `/api/apps/${created.app_id}/comments`, daniel)).json();
      expect(thread.map((c: any) => [c.kind, c.name])).toEqual([
        ['prompt', 'София Ким'],
        ['prompt', 'Анна Ли'],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('revokes disabled users and transfers ownership without transferring data permissions', async () => {
    const a = await create();
    await request('POST', `/api/apps/${a.appId}/owner`, owner, { owner_id: 'demo-daniel' });
    await grant(a.appId, 'demo-daniel', 'user');
    expect((await request('GET', `/api/apps/${a.appId}/launch`, daniel)).statusCode).toBe(200);
    expect(
      (await request('POST', '/api/admin/users/demo-daniel/disable', owner, {})).statusCode,
    ).toBe(200);
    expect((await request('GET', '/api/apps', daniel)).statusCode).toBe(401);
    expect((await request('GET', `/api/apps/${a.appId}`, owner)).json().owner_id).toBe(
      'demo-sofia',
    );
  });
});
