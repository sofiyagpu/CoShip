import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { inspect, publish, request } from './client.js';
export async function startMcp(root: string) {
  const server = new McpServer({ name: 'coship', version: '0.1.0' });
  const output = (result: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  });
  const safe = (fn: (args: any) => Promise<unknown>) => async (args: any) => {
    try {
      return output(await fn(args));
    } catch (e: any) {
      return { ...output({ error: e.message }), isError: true };
    }
  };
  server.registerTool(
    'coship_capabilities',
    {
      description:
        'Describe this CoShip installation: supported app manifest, SDK, limits and available runtime.',
      inputSchema: {},
    },
    safe(() => request('/.well-known/coship.json', undefined, { anonymous: true })),
  );
  server.registerTool(
    'coship_inspect',
    {
      description:
        'Validate a project inside the configured root without publishing. Never executes package scripts.',
      inputSchema: { path: z.string() },
    },
    safe(({ path }) => inspect(resolve(root, path), root)),
  );
  server.registerTool(
    'coship_publish',
    {
      description:
        'Publish the selected project to CoShip. Creates a private app or updates its project binding; does not grant sharing or production-data access.',
      inputSchema: { path: z.string(), idempotency_key: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(({ path, idempotency_key }) =>
      publish(resolve(root, path), { root, key: idempotency_key }),
    ),
  );
  server.registerTool(
    'coship_deployment_status',
    {
      description: 'Read status and checks for an authorized publication.',
      inputSchema: { deployment_id: z.string() },
    },
    safe(({ deployment_id }) => request(`/api/deployments/${encodeURIComponent(deployment_id)}`)),
  );
  server.registerTool(
    'coship_rollback',
    {
      description:
        'Activate a compatible previous code release. Does not roll back data or grants.',
      inputSchema: { app_id: z.string(), release_id: z.string(), expected_release_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    safe(({ app_id, ...body }) =>
      request(`/api/apps/${encodeURIComponent(app_id)}/rollback`, body),
    ),
  );
  server.registerResource(
    'sdk',
    'coship://sdk',
    { description: 'SDK contract without any corporate data', mimeType: 'text/plain' },
    async () => ({
      contents: [
        {
          uri: 'coship://sdk',
          mimeType: 'text/plain',
          text: 'Use a coship.json manifest (manifestVersion 1, runtime coship-js-v1, entry index.html, data.profile app-shared, inline collection JSON Schemas). Browser: window.coship.data.collection(name).list/get/insert/update/delete; window.coship.functions.invoke(name,input). Functions default-export async (input,ctx), using ctx.data. All data access is delegated to current viewer. Never put secrets or production data in code. No external connectors in this release. Publish only the user-selected project root.',
        },
      ],
    }),
  );
  await server.connect(new StdioServerTransport());
}
