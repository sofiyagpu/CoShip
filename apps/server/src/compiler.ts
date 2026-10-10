import { canonical } from '../../../packages/shared/src/canonical.js';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parse, serialize, parseFragment } from 'parse5';
import { build, transform } from 'esbuild';
import { packetSchema, type ProjectPacket } from '../../../packages/shared/src/index.js';
import { browserSdk } from '../../../packages/sdk/src/index.js';
import { ajv } from './broker.js';
import { fail } from './errors.js';

export function validatePath(path:string) {
  if(!path || path.length>200 || path.startsWith('/') || path.includes('\\') || path.split('/').some(p=>p==='..'||p==='.'||!p) || /[\x00-\x1f]/.test(path)) fail(400,'INVALID_PATH','Недопустимый путь файла');
  if(path.split('/').some(p=>/^\.env|^\.git$|^\.coship$|^node_modules$|\.(pem|key|p12|pfx|sqlite|db|dump)$/i.test(p))) fail(400,'FORBIDDEN_FILE','В проекте есть закрытый или служебный файл');
}
export function scanSecrets(files:Record<string,string>) {
  const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bAKIA[0-9A-Z]{16}\b/,/\bgh[pousr]_[A-Za-z0-9]{30,}\b/,/\bsk-(?:proj-)?[a-zA-Z0-9_-]{24,}\b/,/(?:postgres(?:ql)?|mysql):\/\/[^\s:]+:[^\s@]+@/i,/(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*["'][^"'\s]{12,}["']/i];
  for(const [path,text] of Object.entries(files)) if(patterns.some(p=>p.test(text))) fail(422,'SECRET_DETECTED',`В ${path} обнаружен возможный секрет. Удалите его и используйте хранилище платформы`);
}
function walk(node:any,visitor:(node:any)=>void) { visitor(node); for(const child of node.childNodes||[]) walk(child,visitor); if(node.content)walk(node.content,visitor); }
export async function compileProject(raw:unknown) {
  const packet=packetSchema.parse(raw);
  if(Buffer.byteLength(JSON.stringify(packet))>2*1024*1024) fail(413,'PROJECT_TOO_LARGE','Проект превышает 2 МБ');
  for(const key of Object.keys(packet.files))validatePath(key);
  validatePath(packet.manifest.entry);
  for(const [name,col] of Object.entries(packet.manifest.data.collections)) {
    if(!/^[a-z][a-z0-9_]{0,47}$/.test(name)) fail(400,'COLLECTION_NAME','Некорректное имя коллекции');
    if(JSON.stringify(col.schema).length>12000 || !ajv.validateSchema(col.schema)) fail(400,'INVALID_SCHEMA','Некорректная JSON Schema');
    // Keep schemas bounded and local; never load remote references.
    if(/"\$ref"|"pattern"|"patternProperties"/.test(JSON.stringify(col.schema))) fail(400,'UNSUPPORTED_SCHEMA','В MVP используйте локальную схему без $ref и регулярных выражений');
    ajv.compile(col.schema);
  }
  if(Object.keys(packet.manifest.data.collections).length>12 || Object.keys(packet.manifest.functions).length>10) fail(400,'CAPABILITY_LIMIT','Слишком много коллекций или функций');
  scanSecrets(packet.files);
  const source=packet.files[packet.manifest.entry]; if(!source)fail(400,'ENTRY_MISSING','Не найден входной HTML-файл');
  const document:any=parse(source); let head:any; const scripts:any[]=[],styles:any[]=[];
  walk(document,node=>{
    if(node.tagName==='head') head=node;
    if(node.tagName==='base'||node.tagName==='iframe'||node.tagName==='object'||node.tagName==='embed') fail(422,'UNSUPPORTED_HTML','Вложенные документы и base не поддерживаются');
    if(node.tagName==='meta' && node.attrs?.some((a:any)=>a.name==='http-equiv')) fail(422,'UNSUPPORTED_HTML','Заголовки безопасности управляются платформой');
    if(node.tagName==='script')scripts.push(node);
    if(node.tagName==='link') styles.push(node);
  });
  async function bundle(path:string,contents:string) {
    const result=await build({stdin:{contents,sourcefile:path,loader:path.endsWith('.ts')?'ts':'js'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',logLevel:'silent',plugins:[{name:'project-only',setup(b){
      b.onResolve({filter:/.*/},args=>{
        if(!args.path.startsWith('.')) return {errors:[{text:'Только относительные импорты из проекта; внешние зависимости предварительно соберите локально'}]};
        const name=posix.normalize(posix.join(posix.dirname(args.importer||path),args.path));
        const found=[name,`${name}.js`,`${name}.ts`].find(n=>packet.files[n]!==undefined);
        if(!found)return {errors:[{text:'Импорт не найден в пакете'}]};validatePath(found);return {path:found,namespace:'project'};
      });
      b.onLoad({filter:/.*/,namespace:'project'},args=>({contents:packet.files[args.path],loader:args.path.endsWith('.ts')?'ts':'js'}));
    }}]});
    return result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  }
  for(const script of scripts) {
    const attrs=Object.fromEntries(script.attrs.map((a:any)=>[a.name,a.value]));
    if(attrs.type && !['module','text/javascript','application/javascript'].includes(attrs.type)) continue;
    const path=attrs.src?posix.normalize(posix.join(posix.dirname(packet.manifest.entry),attrs.src)):packet.manifest.entry+'.js';
    if(attrs.src)validatePath(path);
    const content=attrs.src?packet.files[path]:script.childNodes.map((n:any)=>n.value||'').join('');
    if(content===undefined)fail(400,'ASSET_MISSING','Скрипт не найден в проекте');
    const code=await bundle(path,content); script.attrs=[];script.childNodes=[{nodeName:'#text',value:code,parentNode:script}];
  }
  for(const link of styles) {
    const attrs=Object.fromEntries(link.attrs.map((a:any)=>[a.name,a.value]));
    if(attrs.rel!=='stylesheet') fail(422,'UNSUPPORTED_ASSET','Разрешены только локальные CSS-файлы; остальные ресурсы встройте в HTML');
    const path=posix.normalize(posix.join(posix.dirname(packet.manifest.entry),attrs.href||''));validatePath(path);
    const css=packet.files[path];if(css===undefined)fail(400,'ASSET_MISSING','CSS-файл не найден');
    link.nodeName=link.tagName='style';link.attrs=[];link.childNodes=[{nodeName:'#text',value:css.replace(/<\/style/gi,'<\\/style'),parentNode:link}];
  }
  const functions:Record<string,string>={};
  for(const [name,path] of Object.entries(packet.manifest.functions)) {
    if(!/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(name))fail(400,'FUNCTION_NAME','Некорректное имя функции');validatePath(path);
    const code=packet.files[path];if(code===undefined)fail(400,'FUNCTION_MISSING','Функция не найдена');
    functions[name]=(await transform(code,{loader:path.endsWith('.ts')?'ts':'js',format:'esm',target:'es2022'})).code;
  }
  const bootstrap=parseFragment(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';"><script>${browserSdk}</script>`);
  for(const child of bootstrap.childNodes as any[])child.parentNode=head;
  head.childNodes.unshift(...bootstrap.childNodes);
  const html=serialize(document);scanSecrets({'compiled.html':html,...functions});
  const digest=createHash('sha256').update(JSON.stringify({manifest:packet.manifest,html,functions})).digest('hex');
  return {packet,html,functions,digest,checks:[{name:'Файлы и секреты',status:'passed'},{name:'Сборка интерфейса',status:'passed'},{name:'Политика данных',status:'passed'},{name:'Закрытый доступ',status:'passed'}]};
}

export function compatible(oldPacket:ProjectPacket,newPacket:ProjectPacket) {
  for(const [name,col] of Object.entries(oldPacket.manifest.data.collections)) {
    const next=newPacket.manifest.data.collections[name];
    if(!next)fail(409,'DESTRUCTIVE_SCHEMA','Удаление коллекций не поддерживается');
    const before:any=col.schema, after:any=next.schema;
    for(const [field,value] of Object.entries(before.properties||{}))if(canonical((after.properties||{})[field])!==canonical(value))fail(409,'DESTRUCTIVE_SCHEMA','Изменение или удаление существующих полей не поддерживается');
    if((after.required||[]).some((key:string)=>!(before.required||[]).includes(key)))fail(409,'DESTRUCTIVE_SCHEMA','Новые поля должны быть необязательными');
    for(const [key,value] of Object.entries(before))if(!['properties','required'].includes(key)&&canonical(after[key])!==canonical(value))fail(409,'DESTRUCTIVE_SCHEMA','Изменение ограничений схемы не поддерживается');
    for(const key of Object.keys(after))if(!(key in before)&&!['properties','required'].includes(key))fail(409,'DESTRUCTIVE_SCHEMA','Новые ограничения схемы не поддерживаются');
  }
}
