import type { ProjectPacket } from './index.js';
export const templates = [
  {
    id: 'tracker',
    name: 'Командный трекер',
    description: 'Список задач с отметками о выполнении.',
    icon: 'check',
    color: 'green',
    category: 'Работа команды',
  },
  {
    id: 'requests',
    name: 'Заявки и согласования',
    description: 'Список заявок и отметки об обработке.',
    icon: 'file',
    color: 'blue',
    category: 'Операции',
  },
  {
    id: 'ideas',
    name: 'Банк идей',
    description: 'Предложения команды и заметки.',
    icon: 'sparkles',
    color: 'violet',
    category: 'Работа команды',
  },
  {
    id: 'blank',
    name: 'Чистый лист',
    description: 'Базовый список для собственного проекта.',
    icon: 'layers',
    color: 'orange',
    category: 'С нуля',
  },
] as const;
export function templatePacket(templateId: string, name?: string): ProjectPacket {
  const template = templates.find((t) => t.id === templateId) || templates[0];
  const title = name || template.name;
  const safeTitle = title.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
  return {
    manifest: {
      manifestVersion: '1',
      name: title,
      description: template.description,
      icon: template.icon,
      color: template.color,
      runtime: 'coship-js-v1',
      entry: 'index.html',
      functions: {},
      data: {
        profile: 'app-shared',
        collections: {
          items: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'done'],
              properties: {
                title: { type: 'string', minLength: 1, maxLength: 200 },
                done: { type: 'boolean' },
                note: { type: 'string', maxLength: 500 },
              },
            },
            operations: ['list', 'get', 'insert', 'update', 'delete'],
          },
        },
      },
      connectors: [],
    },
    files: {
      'index.html': `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>
    :root{--bg:#fff;--surface:#f8f9fb;--line:#dfe3e8;--text:#121317;--muted:#5f6368;--accent:#0f7b54;--primary:#121317;--on-primary:#fff;color-scheme:light}
    html[data-theme=dark]{--bg:#16181c;--surface:#1f2227;--line:#2e3238;--text:#eceef1;--muted:#a8adb4;--accent:#4cc38a;--primary:#eceef1;--on-primary:#121317;color-scheme:dark}
    @media(prefers-color-scheme:dark){html:not([data-theme]){--bg:#16181c;--surface:#1f2227;--line:#2e3238;--text:#eceef1;--muted:#a8adb4;--accent:#4cc38a;--primary:#eceef1;--on-primary:#121317;color-scheme:dark}}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}.wrap{max-width:760px;margin:0 auto;padding:40px 28px}.eyebrow{font-size:12px;font-weight:600;color:var(--accent)}h1{font-size:34px;font-weight:500;letter-spacing:-.03em;margin:6px 0 8px}p{color:var(--muted);margin:0}.form{display:flex;gap:8px;margin:28px 0 8px}input{width:100%;padding:12px 18px;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:999px;font:inherit;outline:none}input:focus{border-color:var(--accent)}button{font:inherit;font-weight:500;cursor:pointer;border:0;border-radius:999px;padding:12px 22px;background:var(--primary);color:var(--on-primary);white-space:nowrap}.item{display:flex;align-items:center;gap:12px;border:1px solid var(--line);background:var(--surface);border-radius:14px;margin:8px 0;padding:14px 16px}.item input{width:18px;height:18px;padding:0;accent-color:var(--accent);cursor:pointer}.item span{flex:1}.item.done span{text-decoration:line-through;color:var(--muted)}.item button{padding:4px 10px;color:var(--muted);background:transparent}.empty{padding:40px 20px;text-align:center;border:1px dashed var(--line);border-radius:14px;color:var(--muted)}.error{color:#d93025;min-height:22px;font-size:13px}h3{display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin:20px 0 4px}.count{font-weight:400;color:var(--muted)}@media(max-width:500px){.wrap{padding:24px 16px}.form{flex-direction:column}}</style></head><body><main class="wrap"><div class="eyebrow">CoShip</div><h1>${safeTitle}</h1><p>Общий список записей. Изменения сохраняются автоматически.</p><form class="form" id="form"><input id="title" placeholder="Что нужно сделать?" aria-label="Новая запись" maxlength="200" required><button>Добавить</button></form><div class="error" id="error" role="alert"></div><h3>Все записи <span class="count" id="count"></span></h3><div id="items"></div></main><script>
    const collection=coship.data.collection('items'); let rows=[];
    const error=document.getElementById('error');
    async function act(fn){try{error.textContent='';await fn()}catch(e){error.textContent=e.message}}
    async function load(){const result=await collection.list({limit:100});rows=result.items;render()}
    function render(){const target=document.getElementById('items');target.replaceChildren();document.getElementById('count').textContent=rows.length+' записей';if(!rows.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='Пока нет записей. Добавьте первую.';target.append(empty)}for(const row of rows){const item=document.createElement('div');item.className='item'+(row.payload.done?' done':'');const check=document.createElement('input');check.type='checkbox';check.checked=row.payload.done;check.setAttribute('aria-label','Выполнено: '+row.payload.title);check.onchange=()=>act(async()=>{await collection.update(row.id,{...row.payload,done:check.checked},row.revision);await load()});const text=document.createElement('span');text.textContent=row.payload.title;const del=document.createElement('button');del.textContent='×';del.setAttribute('aria-label','Удалить '+row.payload.title);del.onclick=()=>act(async()=>{await collection.delete(row.id,row.revision);await load()});item.append(check,text,del);target.append(item)}}
    document.getElementById('form').onsubmit=e=>{e.preventDefault();act(async()=>{const input=document.getElementById('title');await collection.insert({title:input.value.trim(),done:false});input.value='';await load()})};act(load);
    </script></body></html>`,
    },
  };
}
