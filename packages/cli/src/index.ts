#!/usr/bin/env node
import { Command } from 'commander';
import { mkdir, writeFile, readFile, access, realpath } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { templatePacket } from '../../shared/src/templates.js';
import { validatePath } from '../../../apps/server/src/compiler.js';
import { login, settings, request, packProject, inspect, publish } from './client.js';
import { startMcp } from './mcp.js';
const program = new Command();
program.name('coship').description('Publish and share small corporate software').version('0.1.0');
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
program
  .command('login')
  .option('--server <url>', 'CoShip server')
  .action(async (options) =>
    login(options.server || process.env.COSHIP_SERVER || (await settings()).server),
  );
program
  .command('init')
  .argument('[folder]', 'project folder', 'my-coship-app')
  .option('--name <name>', 'application name', 'Моё приложение')
  .action(async (folder, options) => {
    const root = resolve(folder);
    try {
      await access(root);
      throw new Error('Папка уже существует. Выберите новую, чтобы не перезаписать файлы.');
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    const packet = templatePacket('tracker', options.name);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'coship.json'), JSON.stringify(packet.manifest, null, 2));
    for (const [path, content] of Object.entries(packet.files))
      await writeFile(join(root, path), content);
    console.log(`Проект создан: ${root}\nДалее: coship publish ${folder}`);
  });
program
  .command('inspect')
  .argument('[folder]', 'project folder', '.')
  .action(async (folder) => print(await inspect(folder)));
program
  .command('pack')
  .argument('[folder]', 'project folder', '.')
  .requiredOption('-o, --output <file>', 'output JSON packet (outside project)')
  .action(async (folder, options) => {
    const root = await realpath(resolve(folder));
    const output = join(
      await realpath(dirname(resolve(options.output))),
      resolve(options.output).split('/').pop()!,
    );
    const rel = relative(root, output);
    if (!rel || (!rel.startsWith('../') && !isAbsolute(rel)))
      throw new Error('Сохраните пакет вне папки проекта');
    const packet = await packProject(folder);
    await inspect(folder);
    await writeFile(output, JSON.stringify(packet, null, 2), { flag: 'wx' });
    console.log('Пакет создан');
  });
program
  .command('publish')
  .argument('[folder]', 'project folder', '.')
  .option('--app <id>', 'explicit target application')
  .option('--key <idempotency-key>', 'retry key')
  .action(async (folder, options) => print(await publish(folder, options)));
program.command('list').action(async () => print(await request('/api/apps')));
program
  .command('status')
  .argument('<deployment-id>')
  .action(async (id) => print(await request(`/api/deployments/${encodeURIComponent(id)}`)));
program
  .command('capabilities')
  .action(async () =>
    print(await request('/.well-known/coship.json', undefined, { anonymous: true })),
  );
program
  .command('rollback')
  .argument('<app-id>')
  .requiredOption('--release <id>')
  .requiredOption('--expected <id>', 'currently active release')
  .action(async (id, options) =>
    print(
      await request(`/api/apps/${encodeURIComponent(id)}/rollback`, {
        release_id: options.release,
        expected_release_id: options.expected,
      }),
    ),
  );
program
  .command('pull')
  .argument('<app-id>')
  .argument('<folder>')
  .action(async (id, folder) => {
    const root = resolve(folder);
    try {
      await access(root);
      throw new Error('Целевая папка уже существует');
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    const app = await request(`/api/apps/${encodeURIComponent(id)}`);
    const packet = await request(`/api/apps/${encodeURIComponent(id)}/source`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'coship.json'), JSON.stringify(packet.manifest, null, 2));
    for (const [path, content] of Object.entries(packet.files)) {
      validatePath(path);
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), String(content), { flag: 'wx' });
    }
    await mkdir(join(root, '.coship'));
    await writeFile(
      join(root, '.coship/project.json'),
      JSON.stringify(
        {
          server: process.env.COSHIP_SERVER || (await settings()).server,
          app_id: id,
          release_id: app.active_release_id,
        },
        null,
        2,
      ),
    );
    console.log(`Код скачан в ${root}. Данные не копировались.`);
  });
program
  .command('mcp')
  .command('serve')
  .option('--root <folder>', 'the only folder the agent may publish', process.cwd())
  .action(async (options) => startMcp(resolve(options.root)));
program.parseAsync().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
