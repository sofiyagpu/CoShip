import type { Config } from './config.js';
import type { ProjectPacket } from '../../../packages/shared/src/index.js';
import { fail } from './errors.js';

const contract = `You build small internal web apps for the CoShip platform. Reply with ONE JSON object and nothing else:
{"manifest":{...},"files":{"index.html":"..."}}
Manifest: {"manifestVersion":"1","name":<=80 chars,"description":<=300 chars,"icon":one of layers|chart|check|calendar|box|sparkles|users|file,"color":one of violet|blue|green|orange|pink|slate,"runtime":"coship-js-v1","entry":"index.html","functions":{},"data":{"profile":"app-shared","collections":{<name matching ^[a-z][a-z0-9_]{0,47}$>:{"schema":<inline JSON Schema, type object, additionalProperties false, no $ref, no pattern>,"operations":["list","get","insert","update","delete"]}}},"connectors":[]}
Files: a single self-contained index.html with inline <style> and <script>. No external URLs, fonts, images, CDNs, fetch or forms that submit. Embed any image as data URL.
Data: the platform injects window.coship before your script. const c = coship.data.collection('name'); await c.list({limit:100}) -> {items:[{id,payload,revision,created_at,updated_at}],next_cursor}; await c.insert(payload); await c.update(id,payload,revision) replaces the whole payload; await c.delete(id,revision). All data is shared by every user the app is shared with. Max 12 collections, 64 KiB per record.
UI: Russian language, clean and calm, works at 360px width, accessible labels, show errors from coship calls in an element with role="alert". Never put personal data in the source.
Style (match the CoShip console): system font stack; white background, text #121317, muted #5f6368, accent #0f7b54; headings weight 500 with tight letter-spacing; pill-shaped buttons (background #121317, white text) and inputs; cards with 14px radius and 1px #dfe3e8 borders. Dark mode is required: the platform sets data-theme="light" or "dark" on <html>, so define colors as CSS variables and override them under html[data-theme=dark] (background #16181c, text #eceef1, accent #4cc38a, buttons #eceef1 with #121317 text).`;

export async function generatePacket(
  config: Config,
  prompt: string,
  current?: ProjectPacket,
): Promise<ProjectPacket> {
  if (!config.museApiKey)
    fail(503, 'GENERATION_DISABLED', 'Генерация не настроена: нужен MUSE_API_KEY');
  const user = current
    ? `Current app:\n${JSON.stringify(current)}\n\nChange it: ${prompt}\nKeep every existing collection and field; you may only add optional fields or new collections. Return the full updated JSON.`
    : `Create an app: ${prompt}`;
  let response: Response;
  try {
    response = await fetch(`${config.museBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.museApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.museModel,
        messages: [
          { role: 'system', content: contract },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    fail(502, 'GENERATION_UNAVAILABLE', 'Muse Spark не ответил. Повторите позже');
  }
  if (!response.ok) fail(502, 'GENERATION_FAILED', `Muse Spark вернул ошибку ${response.status}`);
  const text: string = (await response.json()).choices?.[0]?.message?.content ?? '';
  return parsePacket(text);
}

export function parsePacket(text: string): ProjectPacket {
  const start = text.indexOf('{'),
    end = text.lastIndexOf('}');
  let packet: any;
  try {
    packet = JSON.parse(text.slice(start, end + 1));
  } catch {
    fail(502, 'GENERATION_INVALID', 'Модель вернула некорректный пакет. Уточните запрос');
  }
  if (!packet?.manifest || typeof packet.files !== 'object')
    fail(502, 'GENERATION_INVALID', 'Модель вернула некорректный пакет. Уточните запрос');
  // The model owns content, the platform owns these fields.
  Object.assign(packet.manifest, {
    manifestVersion: '1',
    runtime: 'coship-js-v1',
    entry: 'index.html',
    functions: {},
    connectors: [],
  });
  return { manifest: packet.manifest, files: packet.files };
}
