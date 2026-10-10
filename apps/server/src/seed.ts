import { randomUUID } from 'node:crypto';
import type { Database } from './db.js';
import type { Config } from './config.js';
import type { Actor } from '../../../../packages/shared/src/index.js';
import { templatePacket } from '../../../../packages/shared/src/templates.js';
import { publishProject } from './publish.js';
import { orgId } from './auth.js';
export async function seed(db:Database,config:Config) {
  await db.query('INSERT INTO organizations(id,name,region) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[orgId,config.orgName,config.region]);
  if(config.mode==='enterprise')return;
  if((await db.query('SELECT id FROM users LIMIT 1')).rows.length)return;
  for(const u of [
    {id:'demo-sofia',name:'София Ким',email:'sofia@acme.example',avatar:'СК',admin:true},
    {id:'demo-daniel',name:'Даниил Смирнов',email:'daniel@acme.example',avatar:'ДС',admin:false},
    {id:'demo-anna',name:'Анна Ли',email:'anna@acme.example',avatar:'АЛ',admin:false},
    {id:'demo-max',name:'Максим Орлов',email:'max@acme.example',avatar:'МО',admin:false},
  ])await db.query('INSERT INTO users(id,org_id,name,email,avatar,admin) VALUES($1,$2,$3,$4,$5,$6)',[u.id,orgId,u.name,u.email,u.avatar,u.admin]);
  for(const [id,name] of [['team-product','Продукт'],['team-sales','Продажи'],['team-ops','Операции']])await db.query('INSERT INTO groups(id,org_id,name) VALUES($1,$2,$3)',[id,orgId,name]);
  for(const [user,group] of [['demo-sofia','team-product'],['demo-daniel','team-product'],['demo-anna','team-sales'],['demo-max','team-ops']])await db.query('INSERT INTO memberships(user_id,group_id) VALUES($1,$2)',[user,group]);
  const actor=(await db.query<Actor>('SELECT * FROM users WHERE id=$1',['demo-sofia'])).rows[0];
  const examples=[['tracker','Запуск нового продукта','check','green','Всё, что нужно команде для следующего релиза.'],['requests','Заявки на закупки','box','orange','От запроса до одобрения — без потерянных сообщений.'],['ideas','Банк идей','sparkles','violet','Место для маленьких идей с большим потенциалом.'],['tracker','Онбординг команды','users','blue','Помогаем новым коллегам почувствовать себя дома.'],['requests','Обратная связь','chart','pink','Слышим клиентов и превращаем отзывы в улучшения.'],['blank','Контент-план','calendar','slate','Публикации, дедлайны и немного вдохновения.']];
  for(const [template,name,icon,color,description] of examples) {
    const packet=templatePacket(template,name);packet.manifest.icon=icon as any;packet.manifest.color=color as any;packet.manifest.description=description;
    const result=await publishProject(db,actor,{packet,idempotency_key:randomUUID()});
    if(result.status!=='active')throw new Error(`Seed publication failed: ${JSON.stringify(result.error)}`);
    await db.query("INSERT INTO grants(app_id,subject_type,subject_id,data_role) VALUES($1,'group','team-product','user')",[result.app_id]);
    if(template==='tracker')await db.query('INSERT INTO favorites(app_id,user_id) VALUES($1,$2)',[result.app_id,actor.id]);
    if(name==='Запуск нового продукта')for(const title of ['Обсудить идею с командой','Собрать первую версию','Поделиться результатом'])await db.query('INSERT INTO records(id,org_id,app_id,collection,payload,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),orgId,result.app_id,'items',JSON.stringify({title,done:title==='Обсудить идею с командой'}),actor.id]);
  }
}
