import Fastify from 'fastify';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
const exec = promisify(execFile);
const token = process.env.COSHIP_RUNNER_KEY;
const callbackOrigin = process.env.COSHIP_BROKER_ORIGIN;
if (!token || token.length < 32 || !callbackOrigin)
  throw new Error('Set COSHIP_RUNNER_KEY (32+ characters) and COSHIP_BROKER_ORIGIN');
if (process.platform !== 'linux')
  throw new Error('The gVisor runner requires Linux. No unsandboxed fallback exists.');
const runtime = JSON.parse(
  (await exec('docker', ['info', '--format', '{{json .Runtimes}}'])).stdout,
);
if (!runtime.runsc) throw new Error('Docker runtime runsc must be installed');
const image = process.env.COSHIP_FUNCTION_IMAGE || 'coship-function:0.1.0';
await exec('docker', ['image', 'inspect', image]);
const server = Fastify({ logger: false, bodyLimit: 2097152 });
const inputSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string().max(500000),
    input: z.unknown(),
    callback: z.string().url(),
    token: z.string().min(32),
  })
  .strict();
const active = new Set<string>();
server.get('/health', async () => ({ ok: true, runtime: 'runsc', active: active.size }));
server.post('/invoke', async (req, reply) => {
  const expected = Buffer.from(`Bearer ${token}`),
    actual = Buffer.from(req.headers.authorization || '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return reply.code(403).send({ error: 'Forbidden' });
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid invocation' });
  const input = parsed.data,
    callback = new URL(input.callback);
  if (
    callback.origin !== new URL(callbackOrigin).origin ||
    callback.pathname !== `/api/internal/invocations/${input.id}/data` ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    return reply.code(400).send({ error: 'Invalid broker callback' });
  if (active.size >= 4 || active.has(input.id))
    return reply.code(429).send({ error: 'Concurrency limit' });
  active.add(input.id);
  const container = `coship-${input.id}`;
  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'run',
          '--rm',
          '--pull=never',
          '--runtime=runsc',
          '--network=none',
          '--read-only',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--memory=256m',
          '--memory-swap=256m',
          '--cpus=0.5',
          '--pids-limit=64',
          '--user=65532:65532',
          '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
          '--log-driver=none',
          '--name',
          container,
          '-i',
          image,
        ],
        { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH } },
      );
      let buffer = '',
        bytes = 0,
        settled = false,
        rpcs = 0,
        inFlight = 0;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdin.end();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('Timeout')), 10000);
      child.on('error', () => finish(new Error('Sandbox unavailable')));
      child.on('exit', () => {
        if (!settled) finish(new Error('Function exited without result'));
      });
      child.stdin.on('error', () => {});
      child.stdout.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 1048576) return finish(new Error('Output limit'));
        buffer += chunk.toString();
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          let message: any;
          try {
            message = JSON.parse(line);
          } catch {
            return finish(new Error('Invalid protocol'));
          }
          if (message.type === 'result') return finish(undefined, message.value ?? null);
          if (message.type === 'error') return finish(new Error('Function failed'));
          if (message.type !== 'data' || typeof message.id !== 'string' || message.id.length > 64)
            return finish(new Error('Invalid RPC'));
          if (++rpcs > 100 || inFlight >= 8) return finish(new Error('RPC limit'));
          inFlight++;
          void fetch(input.callback, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${input.token}` },
            body: JSON.stringify(message.args),
            signal: AbortSignal.timeout(5000),
            redirect: 'error',
          })
            .then(async (response) => {
              const data = await response.json();
              if (!settled)
                child.stdin.write(
                  JSON.stringify(
                    response.ok
                      ? { id: message.id, result: data }
                      : {
                          id: message.id,
                          error: (data as any).error || { message: 'Data request denied' },
                        },
                  ) + '\n',
                );
            })
            .catch(() => {
              if (!settled)
                child.stdin.write(
                  JSON.stringify({ id: message.id, error: { message: 'Data request failed' } }) +
                    '\n',
                );
            })
            .finally(() => inFlight--);
        }
      });
      child.stdin.write(JSON.stringify({ code: input.code, input: input.input }) + '\n');
    });
    return result;
  } catch {
    return reply.code(502).send({ error: 'Function failed or exceeded limits' });
  } finally {
    await exec('docker', ['rm', '-f', container]).catch(() => {});
    active.delete(input.id);
  }
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await server.close();
    await Promise.all(
      [...active].map((id) => exec('docker', ['rm', '-f', `coship-${id}`]).catch(() => {})),
    );
    process.exit(0);
  });
await server.listen({
  host: process.env.RUNNER_HOST || '127.0.0.1',
  port: Number(process.env.RUNNER_PORT || 4400),
});
console.log('CoShip isolated runner ready');
