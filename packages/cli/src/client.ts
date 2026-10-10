import { readFile,writeFile,mkdir,readdir,lstat,realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve,relative,join,dirname,sep } from 'node:path';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { manifestSchema,type ProjectPacket } from '../../shared/src/index.js';
import { compileProject,validatePath } from '../../../apps/server/src/compiler.js';
const exec=promisify(execFile);
const configFile=()=>join(process.env.COSHIP_CONFIG_DIR||join(homedir(),'.config','coship'),'config.json');
export async function settings() { try{return JSON.parse(await readFile(configFile(),'utf8')) as {server:string}}catch{return {server:'http://127.0.0.1:4300'}} }
export async function getToken(server:string) {
  if(process.env.COSHIP_TOKEN)return process.env.COSHIP_TOKEN;
  try{
    if(process.platform==='darwin')return (await exec('/usr/bin/security',['find-generic-password','-s','coship','-a',server,'-w'])).stdout.trim();
    if(process.platform==='linux')return (await exec('secret-tool',['lookup','service','coship','server',server])).stdout.trim();
  }catch{/* Keychain unavailable or no saved credential. */}
  throw new Error('Сначала выполните coship login. Для CI передайте COSHIP_TOKEN через менеджер секретов.');
}
async function saveToken(server:string,token:string) {
  if(process.platform==='darwin')await exec('/usr/bin/security',['add-generic-password','-U','-s','coship','-a',server,'-w',token]);
  else if(process.platform==='linux')await new Promise<void>((ok,fail)=>{const p=spawn('secret-tool',['store','--label=CoShip CLI','service','coship','server',server],{stdio:['pipe','ignore','pipe']});p.on('error',()=>fail(new Error('Для безопасного хранения установите libsecret (secret-tool). Токен не сохранён.')));p.on('exit',code=>code===0?ok():fail(new Error('Не удалось сохранить токен в системное хранилище')));p.stdin.end(token);});
  else throw new Error('На этой системе используйте COSHIP_TOKEN через защищённое хранилище CI.');
  await mkdir(dirname(configFile()),{recursive:true,mode:0o700});await writeFile(configFile(),JSON.stringify({server}),{mode:0o600});
}
export function checkedServer(server:string){const url=new URL(server);if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Укажите origin сервера без пути и credentials');if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('HTTP разрешён только для localhost');return url.origin;}
export async function request(path:string,body?:unknown,options:{server?:string;anonymous?:boolean;method?:string}={}) {
  const server=checkedServer(options.server||process.env.COSHIP_SERVER||(await settings()).server);
  const token=options.anonymous?undefined:await getToken(server);
  const response=await fetch(`${server}${path}`,{method:options.method||(body===undefined?'GET':'POST'),headers:{'content-type':'application/json','x-coship-request':'1',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000),redirect:'error'});
  const data=await response.json() as any;if(!response.ok)throw new Error(`${data.error?.code||response.status}: ${data.error?.message||'Запрос отклонён'}`);return data;
}
export async function login(server:string) {
  server=checkedServer(server);const device=await request('/api/auth/cli/request',{}, {server,anonymous:true});
  console.log(`Откройте ссылку и подтвердите подключение CLI:\n${device.verification_url}\nЗапрос: ${device.request_id}`);
  const open=process.platform==='darwin'?'open':process.platform==='linux'?'xdg-open':null;
  if(open){const child=spawn(open,[device.verification_url],{stdio:'ignore'});child.on('error',()=>{});child.unref();}
  const deadline=Date.now()+device.expires_in*1000;
  while(Date.now()<deadline){await new Promise(r=>setTimeout(r,2000));const result=await request('/api/auth/cli/token',{request_id:device.request_id,device_code:device.device_code},{server,anonymous:true});if(result.status==='approved'){await saveToken(server,result.token);console.log('CLI подключён. Токен сохранён в системном хранилище.');return;}}
  throw new Error('Время подтверждения истекло. Повторите вход.');
}
export async function packProject(folder:string,allowedRoot?:string):Promise<ProjectPacket> {
  const root=await realpath(folder);
  if(allowedRoot){const allowed=await realpath(allowedRoot),r=relative(allowed,root);if(r==='..'||r.startsWith(`..${sep}`)||r.startsWith(sep))throw new Error('Папка находится за пределами разрешённого MCP root');}
  const mf=join(root,'coship.json');if((await lstat(mf)).isSymbolicLink())throw new Error('Манифест не может быть символьной ссылкой');
  const manifest=manifestSchema.parse(JSON.parse(await readFile(mf,'utf8'))),files:Record<string,string>={};let bytes=0;
  async function walk(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){
    if(entry.name.startsWith('.')||['node_modules','coverage','test-results'].includes(entry.name))continue;
    const absolute=join(dir,entry.name),path=relative(root,absolute).split(sep).join('/');
    if(entry.isSymbolicLink())throw new Error(`Символьная ссылка запрещена: ${path}`);
    if(entry.isDirectory()){await walk(absolute);continue}
    if(!entry.isFile()||path==='coship.json'||! /\.(html|js|mjs|ts|css|json|svg|md|txt)$/i.test(path))continue;
    validatePath(path);const stat=await lstat(absolute);if(stat.size>2097152||bytes+stat.size>2097152)throw new Error('Проект превышает 2 МБ');
    files[path]=await readFile(absolute,'utf8');bytes+=stat.size;if(Object.keys(files).length>100)throw new Error('В проекте больше 100 файлов');
  }}
  await walk(root);return {manifest,files};
}
export async function inspect(folder:string,root?:string) { const packet=await packProject(folder,root);const result=await compileProject(packet);return {name:packet.manifest.name,files:Object.keys(packet.files),bytes:Buffer.byteLength(JSON.stringify(packet)),digest:result.digest,checks:result.checks}; }
export async function publish(folder:string,options:{app?:string;root?:string;key?:string}={}) {
  const root=await realpath(folder),packet=await packProject(root,options.root),server=checkedServer(process.env.COSHIP_SERVER||(await settings()).server);
  await compileProject(packet);
  let binding:any;try{binding=JSON.parse(await readFile(join(root,'.coship/project.json'),'utf8'))}catch{}
  if(binding&&binding.server!==server&&!options.app)throw new Error('Проект привязан к другому серверу. Используйте новую папку или явный --app.');
  const appId=options.app||binding?.app_id;
  const expected=appId?(await request(`/api/apps/${encodeURIComponent(appId)}`)).active_release_id:undefined;
  const result=await request('/api/deployments',{packet,idempotency_key:options.key||randomUUID(),...(appId?{app_id:appId,expected_release_id:expected}:{})});
  if(result.status!=='active')throw new Error(`${result.error?.code||result.status}: ${result.error?.message||'Публикация ещё обрабатывается'}`);
  await mkdir(join(root,'.coship'),{recursive:true,mode:0o700});await writeFile(join(root,'.coship/project.json'),JSON.stringify({server,app_id:result.app_id},null,2));
  return {...result,url:`${server}/#app/${result.app_id}`};
}
