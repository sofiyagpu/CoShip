import { it, expect } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from '../apps/server/src/app.js';
import { newSession } from '../apps/server/src/auth.js';
const exec = promisify(execFile);
it('publishes and updates one local folder through actual CLI and MCP clients', async () => {
  const { server, db } = await createApp({
    mode: 'test',
    port: 0,
    host: '127.0.0.1',
    publicUrl: 'http://localhost',
    dataDir: ':memory:',
    orgName: 'CLI Test',
    region: 'KZ',
  });
  const root = await mkdtemp(join(tmpdir(), 'coship-cli-'));
  let client: Client | undefined;
  try {
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const token = await newSession(db, 'demo-sofia', 'cli');
    const env = {
      ...process.env,
      COSHIP_TOKEN: token,
      COSHIP_SERVER: address,
      COSHIP_CONFIG_DIR: join(root, 'config'),
    };
    const script = resolve('packages/cli/src/index.ts'),
      project = join(root, 'project');
    const run = (args: string[]) =>
      exec(process.execPath, ['--import', 'tsx', script, ...args], { env });
    await run(['init', project, '--name', 'CLI application']);
    await expect(run(['pack', project, '--output', join(project, 'packet.json')])).rejects.toThrow(
      'вне папки',
    );
    await run(['pack', project, '--output', join(root, 'packet.json')]);
    const inspected = JSON.parse((await run(['inspect', project])).stdout);
    expect(inspected.checks).toHaveLength(4);
    const deployed = JSON.parse((await run(['publish', project])).stdout);
    expect(deployed.status).toBe('active');
    const binding = JSON.parse(await readFile(join(project, '.coship/project.json'), 'utf8'));
    expect(binding.app_id).toBe(deployed.app_id);
    client = new Client({ name: 'coship-test', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', script, 'mcp', 'serve', '--root', project],
      env: Object.fromEntries(
        Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'),
      ),
      stderr: 'pipe',
    });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('coship_publish');
    const denied = await client.callTool({ name: 'coship_inspect', arguments: { path: '..' } });
    expect(denied.isError).toBe(true);
    const result = await client.callTool({ name: 'coship_publish', arguments: { path: '.' } });
    expect(result.isError).not.toBe(true);
    const next = JSON.parse((result.content as any[])[0].text);
    expect(next.app_id).toBe(deployed.app_id);
    expect(next.release_id).not.toBe(deployed.release_id);
    const metadata = JSON.parse((await run(['list'])).stdout).find(
      (app: any) => app.id === deployed.app_id,
    );
    expect(metadata.release_count).toBe(2);
    const sdk = await client.readResource({ uri: 'coship://sdk' });
    expect(sdk.contents[0].text).toContain('Never put secrets');
  } finally {
    await client?.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
