import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { actorFor } from './auth.js';
import { requireAccess } from './policy.js';
import { dataOperation } from './broker.js';
import { fail } from './errors.js';
import type { Actor } from '../../../packages/shared/src/index.js';
export function sameSecret(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function registerFunctions(server: FastifyInstance, db: Database, config: Config) {
  const invocations = new Map<
    string,
    { actor: Actor; appId: string; releaseId: string; token: string; expires: number }
  >();
  server.post('/api/internal/invocations/:id/data', async (req) => {
    const { id } = req.params as any,
      invocation = invocations.get(id);
    if (
      !invocation ||
      invocation.expires < Date.now() ||
      !sameSecret(req.headers.authorization || '', `Bearer ${invocation.token}`)
    )
      fail(403, 'INVALID_INVOCATION', 'Вызов недоступен');
    if (config.mode === 'enterprise') {
      const org = (
        await db.query('SELECT directory_synced_at FROM organizations WHERE id=$1', [
          invocation.actor.org_id,
        ])
      ).rows[0];
      if (
        !org?.directory_synced_at ||
        Date.now() - new Date(org.directory_synced_at).getTime() > 300000
      )
        fail(503, 'DIRECTORY_STALE', 'Каталог не синхронизирован');
    }
    return dataOperation(db, invocation.actor, invocation.appId, invocation.releaseId, req.body);
  });
  server.post('/api/apps/:id/functions/:name', async (req) => {
    const actor = await actorFor(req, db, config, true),
      { id: appId, name } = req.params as any;
    const { app } = await requireAccess(db, actor, appId, 'read');
    if (!config.runnerUrl || !config.runnerKey)
      fail(503, 'RUNNER_UNAVAILABLE', 'Серверные функции требуют Linux-runner с gVisor');
    if ((req.body as any)?.release_id !== app.active_release_id)
      fail(409, 'RELEASE_CHANGED', 'Приложение обновилось');
    const release = (
      await db.query('SELECT functions FROM releases WHERE id=$1', [app.active_release_id])
    ).rows[0];
    if (!Object.hasOwn(release.functions, name))
      fail(404, 'FUNCTION_NOT_FOUND', 'Функция не найдена');
    if (
      invocations.size >= 8 ||
      [...invocations.values()].filter((i) => i.appId === appId).length >= 2
    )
      fail(429, 'CONCURRENCY_LIMIT', 'Слишком много одновременных вызовов');
    const id = randomUUID(),
      token = randomBytes(32).toString('base64url');
    invocations.set(id, {
      actor,
      appId,
      releaseId: app.active_release_id,
      token,
      expires: Date.now() + 15000,
    });
    try {
      const base = process.env.COSHIP_BROKER_URL || `http://127.0.0.1:${config.port}`;
      const result = await fetch(`${config.runnerUrl}/invoke`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.runnerKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id,
          code: release.functions[name],
          input: (req.body as any)?.input ?? {},
          callback: `${base}/api/internal/invocations/${id}/data`,
          token,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!result.ok)
        fail(502, 'FUNCTION_FAILED', 'Функция завершилась с ошибкой или превысила лимит');
      const text = await result.text();
      if (Buffer.byteLength(text) > 1048576)
        fail(502, 'RESPONSE_LIMIT', 'Ответ функции слишком большой');
      await requireAccess(db, actor, appId, 'read');
      return JSON.parse(text);
    } finally {
      invocations.delete(id);
    }
  });
}
