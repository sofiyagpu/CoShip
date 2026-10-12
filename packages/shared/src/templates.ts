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
    *{box-sizing:border-box}body{margin:0;background:#ffffff;color:#1f2328;font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.wrap{max-width:820px;margin:0 auto;padding:45px 35px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:2px;color:#819188;text-transform:uppercase}h1{font-size:32px;letter-spacing:-1px;margin:12px 0}p{color:#87928b;line-height:1.6}.form{display:flex;gap:10px;margin:30px 0 24px}input{width:100%;padding:14px 16px;border:1px solid #dce4dd;background:white;border-radius:10px;font:inherit;outline:none}input:focus{border-color:#0969da}button{font:inherit;cursor:pointer;border:0;border-radius:999px;padding:12px 20px;background:#1f2328;color:white;white-space:nowrap}.item{display:flex;align-items:center;gap:14px;border:1px solid #e7ebe7;background:white;border-radius:12px;margin:9px 0;padding:18px}.item input{width:18px;height:18px;accent-color:#1f2328;cursor:pointer}.item span{flex:1}.item.done span{text-decoration:line-through;color:#94a098}.item button{padding:5px 10px;color:#97a099;background:transparent}.empty{padding:48px 20px;text-align:center;border:1px dashed #d7e0d8;border-radius:14px;color:#89968d}.error{color:#b84949;min-height:24px;font-size:13px}footer{margin-top:30px;color:#a0aaa3;font-size:12px}.count{float:right;font-size:13px;font-weight:normal;color:#859189}h3{font-size:13px;margin-top:30px} @media(max-width:500px){.wrap{padding:25px 18px}.form{flex-direction:column}}</style></head><body><main class="wrap"><div class="eyebrow">Рабочее пространство команды</div><h1>${safeTitle}</h1><p>Общий список записей. Изменения сохраняются автоматически.</p><form class="form" id="form"><input id="title" placeholder="Что нужно сделать?" aria-label="Новая запись" maxlength="200" required><button>Добавить</button></form><div class="error" id="error" role="alert"></div><h3>ВСЕ ЗАПИСИ <span class="count" id="count"></span></h3><div id="items"></div><footer>Доступ к данным управляется через кнопку «Поделиться» в CoShip.</footer></main><script>
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
