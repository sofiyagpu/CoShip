import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import type { Config } from './config.js';
import { openDatabase,migrate,type Database } from './db.js';
import { actorFor,actorId,audit,orgId,registerAuth } from './auth.js';
import { access,requireAccess } from './policy.js';
import { AppError,fail } from './errors.js';
import { dataOperation } from './broker.js';
import { publishProject,rollback } from './publish.js';
import { seed } from './seed.js';
import { disableUser,sweepLifecycle } from './lifecycle.js';
import { encryptSecret,masterKey } from './secrets.js';
import { sameSecret,registerFunctions } from './functions.js';
import { grantSchema,type Actor } from '../../../packages/shared/src/index.js';
import { templates,templatePacket } from '../../../packages/shared/src/templates.js';

export async function createApp(config:Config,providedDb?:Database) {
  const db=providedDb||await openDatabase(config);await migrate(db);await seed(db,config);
  await db.query("UPDATE deployments SET status='failed',error='{"+'"code":"INTERRUPTED","message":"Перезапуск сервера прервал публикацию. Повторите с новым ключом"'+"}'::jsonb WHERE status='checking'");
  const key=await masterKey(config);
  const server=Fastify({logger:config.mode==='test'?false:{level:'warn',redact:['req.headers.authorization','req.headers.cookie','req.body']},bodyLimit:3*1024*1024,trustProxy:false});
  await server.register(cookie);await server.register(rateLimit,{max:config.mode==='test'?10000:300,timeWindow:'1 minute'});
  server.setErrorHandler((error,req,reply)=>{
    if(error instanceof ZodError)return reply.code(400).send({error:{code:'INVALID_INPUT',message:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ').slice(0,500)}});
    if(error instanceof AppError)return reply.code(error.status).send({error:{code:error.code,message:error.message}});
    if((error as any).statusCode && (error as any).statusCode<500)return reply.code((error as any).statusCode).send({error:{code:'INVALID_REQUEST',message:'Некорректный запрос или превышен лимит'}});
    // Never log request bodies, SQL parameter values, arbitrary user errors or app stdout.
    server.log.error({errorCode:(error as any).code||'INTERNAL_ERROR',route:req.routeOptions.url},'Request failed');
    return reply.code(500).send({error:{code:'INTERNAL_ERROR',message:'Не удалось выполнить действие. Попробуйте снова'}});
  });
  server.addHook('onRequest',async(req,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY');
    if(req.url.startsWith('/api'))reply.header('Cache-Control','no-store');
    if(config.mode==='development') {
      const host=req.hostname;
      if(!['localhost','127.0.0.1','::1'].includes(host))fail(403,'LOCAL_ONLY','Демо-вход работает только на localhost');
    }
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const origin=req.headers.origin;
      if(origin && origin!==new URL(config.publicUrl).origin)fail(403,'ORIGIN_DENIED','Запрос с другого сайта запрещён');
      if(!req.headers.authorization && req.headers['x-coship-request']!=='1')fail(403,'CSRF_DENIED','Отсутствует заголовок платформы');
    }
  });
  registerAuth(server,db,config);registerFunctions(server,db,config);
  server.get('/api/health',async()=>{await db.query('SELECT 1');return {ok:true,version:'0.1.0',mode:config.mode};});
  server.get('/.well-known/coship.json',async()=>({platform:'CoShip',version:'0.1.0',manifestVersion:'1',runtime:'coship-js-v1',publishing:{transport:'json-file-packet',max_bytes:2097152,max_files:100,build:'local modules bundled without executing package scripts'},sdk:{browser:'window.coship',functions:'default export (input, ctx)',data:['list','get','insert','update','delete']},functions:!!config.runnerUrl,connectors:[],dataProfiles:['app-shared'],publicLinks:false,limits:{recordsPerApp:10000,collections:12,functionTimeoutSeconds:10},docs:'/api/docs/sdk'}));
  server.get('/api/docs/sdk',async(_req,reply)=>reply.type('text/plain').send('CoShip: manifestVersion="1", runtime="coship-js-v1", entry="index.html". Publish POST /api/deployments { packet:{manifest,files}, idempotency_key, app_id?, expected_release_id? }. Browser global coship.data.collection(name): list({limit,cursor}), get(id), insert(payload), update(id,payload,revision), delete(id,revision). coship.functions.invoke(name,input). All data calls run as the current viewer. No raw SQL, secrets, public access or external network. Functions default-export async (input, ctx); ctx.data has the same collection API. Collections use inline JSON Schema. CLI: coship init; coship publish .; coship mcp serve.'));
  async function appView(actor:Actor,appId:string) {
    const a=await access(db,actor,appId),app=a.app;
    if(!a.dataRole&&!a.managementRole&&!actor.admin)return null;
    const stats=(await db.query(`SELECT (SELECT count(*) FROM releases WHERE app_id=$1) AS release_count,(SELECT count(*) FROM records WHERE app_id=$1) AS record_count,(SELECT count(*) FROM grants WHERE app_id=$1) AS people_count,EXISTS(SELECT 1 FROM favorites WHERE app_id=$1 AND user_id=$2) AS favorite`,[appId,actor.id])).rows[0];
    const collections=(await db.query('SELECT name FROM collections WHERE app_id=$1 ORDER BY name',[appId])).rows.map(r=>r.name);
    return {...app,...stats,record_count:a.dataRole?Number(stats.record_count):0,release_count:Number(stats.release_count),people_count:Number(stats.people_count),data_role:a.dataRole,management_role:a.managementRole,collections};
  }
  server.get('/api/apps',async req=>{
    const actor=await actorFor(req,db,config);const ids=(await db.query('SELECT id FROM apps WHERE org_id=$1 ORDER BY updated_at DESC',[actor.org_id])).rows;
    const apps=[];for(const row of ids){const app=await appView(actor,row.id);if(app)apps.push(app);}return apps;
  });
  server.get('/api/apps/:id',async req=>{const actor=await actorFor(req,db,config);const id=(req.params as any).id;await requireAccess(db,actor,id,'view');return appView(actor,id);});
  server.get('/api/templates',async req=>{await actorFor(req,db,config);return templates;});
  server.post('/api/apps/from-template',async req=>{
    const actor=await actorFor(req,db,config,true);const input=z.object({template:z.enum(['tracker','requests','ideas','blank']),name:z.string().trim().min(1).max(80)}).parse(req.body);
    return publishProject(db,actor,{packet:templatePacket(input.template,input.name),idempotency_key:randomUUID()},!!config.runnerUrl);
  });
  server.post('/api/deployments',async req=>{
    const actor=await actorFor(req,db,config);
    const input=z.object({packet:z.unknown(),app_id:z.string().optional(),expected_release_id:z.string().nullable().optional(),idempotency_key:z.string().min(1).max(100)}).strict().parse(req.body);
    return publishProject(db,actor,{...input,packet:input.packet},!!config.runnerUrl);
  });
  server.get('/api/deployments/:id',async req=>{const actor=await actorFor(req,db,config);const d=(await db.query('SELECT * FROM deployments WHERE id=$1 AND org_id=$2',[(req.params as any).id,actor.org_id])).rows[0];if(!d)fail(404,'NOT_FOUND','Публикация не найдена');if(d.author_id!==actor.id){if(!d.app_id)fail(403,'ACCESS_DENIED','Нет доступа');await requireAccess(db,actor,d.app_id,'publish');}return d;});
  server.post('/api/apps/:id/favorite',async req=>{const actor=await actorFor(req,db,config,true),id=(req.params as any).id;await requireAccess(db,actor,id,'view');const input=z.object({favorite:z.boolean()}).parse(req.body);if(input.favorite)await db.query('INSERT INTO favorites(app_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,actor.id]);else await db.query('DELETE FROM favorites WHERE app_id=$1 AND user_id=$2',[id,actor.id]);return {ok:true};});
  server.patch('/api/apps/:id',async req=>{
    const actor=await actorFor(req,db,config,true),id=(req.params as any).id;await requireAccess(db,actor,id,'manage');
    const input=z.object({name:z.string().trim().min(1).max(80).optional(),description:z.string().max(300).optional(),pinned:z.boolean().optional(),backup_owner_id:z.string().nullable().optional()}).strict().parse(req.body);
    if(input.backup_owner_id && !(await db.query('SELECT id FROM users WHERE id=$1 AND org_id=$2 AND active=true',[input.backup_owner_id,actor.org_id])).rows[0])fail(400,'INVALID_OWNER','Выберите действующего сотрудника');
    await db.transaction(async tx=>{for(const [field,value] of Object.entries(input))await tx.query(`UPDATE apps SET ${field}=$1,updated_at=now() WHERE id=$2`,[value,id]);await audit(tx,actor,'app.updated',id);});return appView(actor,id);
  });
  server.post('/api/apps/:id/archive',async req=>{const actor=await actorFor(req,db,config,true),id=(req.params as any).id;await requireAccess(db,actor,id,'manage');const {archived}=z.object({archived:z.boolean()}).parse(req.body);await db.transaction(async tx=>{await tx.query('UPDATE apps SET status=$1,archive_after=NULL,updated_at=now(),last_used_at=CASE WHEN $2 THEN last_used_at ELSE now() END WHERE id=$3',[archived?'archived':'active',archived,id]);await audit(tx,actor,archived?'app.archived':'app.restored',id);});return {ok:true};});
  server.post('/api/apps/:id/owner',async req=>{const actor=await actorFor(req,db,config,true),id=(req.params as any).id;await requireAccess(db,actor,id,'manage');const {owner_id}=z.object({owner_id:z.string()}).parse(req.body);if(!(await db.query('SELECT id FROM users WHERE id=$1 AND org_id=$2 AND active=true',[owner_id,actor.org_id])).rows[0])fail(400,'INVALID_OWNER','Сотрудник недоступен');await db.transaction(async tx=>{await tx.query('UPDATE apps SET owner_id=$1,needs_owner=false,updated_at=now() WHERE id=$2',[owner_id,id]);await audit(tx,actor,'app.owner_transferred',id,{to:owner_id});});return {ok:true};});
  server.get('/api/apps/:id/grants',async req=>{const actor=await actorFor(req,db,config,true),id=(req.params as any).id;await requireAccess(db,actor,id,'view');return (await db.query(`SELECT g.*,coalesce(u.name,t.name) AS name,u.avatar FROM grants g LEFT JOIN users u ON g.subject_type='user' AND g.subject_id=u.id LEFT JOIN groups t ON g.subject_type='group' AND g.subject_id=t.id WHERE g.app_id=$1 ORDER BY g.subject_type,g.subject_id`,[id])).rows;});
  server.put('/api/apps/:id/grants',async req=>{const actor=await actorFor(req,db,config,true),id=(req.params as any).id;const grant=grantSchema.parse(req.body);return db.transaction(async tx=>{await requireAccess(tx,actor,id,'manage');const table=grant.subject_type==='user'?'users':'groups';if(!(await tx.query(`SELECT id FROM ${table} WHERE id=$1 AND org_id=$2`,[grant.subject_id,actor.org_id])).rows[0])fail(400,'INVALID_SUBJECT','Пользователь или группа другой организации');await tx.query('INSERT INTO grants(app_id,subject_type,subject_id,data_role,management_role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(app_id,subject_type,subject_id) DO UPDATE SET data_role=excluded.data_role,management_role=excluded.management_role',[id,grant.subject_type,grant.subject_id,grant.data_role,grant.management_role]);await audit(tx,actor,'access.granted',id,{subject_type:grant.subject_type,subject_id:grant.subject_id,data_role:grant.data_role,management_role:grant.management_role});return {ok:true};});});
  server.delete('/api/apps/:id/grants/:type/:subject',async req=>{const actor=await actorFor(req,db,config,true),{id,type,subject}=req.params as any;await requireAccess(db,actor,id,'manage');await db.transaction(async tx=>{await tx.query('DELETE FROM grants WHERE app_id=$1 AND subject_type=$2 AND subject_id=$3',[id,type,subject]);await audit(tx,actor,'access.revoked',id,{subject_id:subject});});return {ok:true};});
  server.get('/api/apps/:id/releases',async req=>{const actor=await actorFor(req,db,config),id=(req.params as any).id;await requireAccess(db,actor,id,'view');return (await db.query('SELECT r.id,r.version,r.digest,r.created_at,u.name AS author FROM releases r JOIN users u ON u.id=r.author_id WHERE r.app_id=$1 ORDER BY version DESC',[id])).rows;});
  server.post('/api/apps/:id/rollback',async req=>{const actor=await actorFor(req,db,config),id=(req.params as any).id;const input=z.object({release_id:z.string(),expected_release_id:z.string()}).parse(req.body);return rollback(db,actor,id,input.release_id,input.expected_release_id);});
  server.get('/api/apps/:id/source',async req=>{const actor=await actorFor(req,db,config),id=(req.params as any).id;const {app}=await requireAccess(db,actor,id,'publish');return (await db.query('SELECT packet FROM releases WHERE id=$1',[app.active_release_id])).rows[0]?.packet;});
  server.post('/api/apps/:id/copy',async req=>{const actor=await actorFor(req,db,config,true),id=(req.params as any).id;const {app}=await requireAccess(db,actor,id,'publish');const packet=(await db.query('SELECT packet FROM releases WHERE id=$1',[app.active_release_id])).rows[0]?.packet;if(!packet)fail(409,'NO_RELEASE','Нет опубликованной версии');packet.manifest.name=`${app.name.slice(0,65)} — копия`;const result=await publishProject(db,actor,{packet,idempotency_key:randomUUID()},!!config.runnerUrl);if(result.status==='active')await audit(db,actor,'app.copied',result.app_id,{source_app:id});return result;});
  server.get('/api/apps/:id/launch',async req=>{const actor=await actorFor(req,db,config,true),id=(req.params as any).id;const {app}=await requireAccess(db,actor,id,'read');const release=(await db.query('SELECT id,html FROM releases WHERE id=$1 AND app_id=$2',[app.active_release_id,id])).rows[0];if(!release)fail(409,'NO_RELEASE','Приложение ещё не опубликовано');await db.query("UPDATE apps SET last_used_at=now(),status='active',archive_after=NULL WHERE id=$1",[id]);return {release_id:release.id,html:release.html};});
  server.post('/api/apps/:id/data',async req=>{const actor=await actorFor(req,db,config,true),id=(req.params as any).id;const {release_id,...input}=req.body as any;return dataOperation(db,actor,id,String(release_id),input);});
  server.get('/api/apps/:id/comments',async req=>{const actor=await actorFor(req,db,config,true),id=(req.params as any).id;await requireAccess(db,actor,id,'read');return (await db.query('SELECT c.*,u.name,u.avatar FROM comments c JOIN users u ON c.author_id=u.id WHERE c.app_id=$1 ORDER BY c.created_at LIMIT 200',[id])).rows;});
  server.post('/api/apps/:id/comments',async req=>{const actor=await actorFor(req,db,config,true),id=(req.params as any).id;await requireAccess(db,actor,id,'read');const {body}=z.object({body:z.string().trim().min(1).max(2000)}).parse(req.body);await db.transaction(async tx=>{await tx.query('INSERT INTO comments(id,app_id,author_id,body) VALUES($1,$2,$3,$4)',[randomUUID(),id,actor.id,body]);await audit(tx,actor,'comment.added',id);});return {ok:true};});
  server.get('/api/people',async req=>{const actor=await actorFor(req,db,config,true);return {users:(await db.query('SELECT id,name,email,avatar,active,admin FROM users WHERE org_id=$1 ORDER BY name',[actor.org_id])).rows,groups:(await db.query('SELECT g.*,count(m.user_id)::int AS members FROM groups g LEFT JOIN memberships m ON m.group_id=g.id WHERE g.org_id=$1 GROUP BY g.id ORDER BY name',[actor.org_id])).rows};});
  server.get('/api/activity',async req=>{const actor=await actorFor(req,db,config,true);const rows=(await db.query('SELECT e.*,u.name AS actor_name,u.avatar,a.name AS app_name FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id LEFT JOIN apps a ON a.id=e.app_id WHERE e.org_id=$1 AND e.action NOT LIKE $2 ORDER BY e.created_at DESC LIMIT 100',[actor.org_id,'data.%'])).rows;if(actor.admin)return rows;const visible=[];for(const row of rows){if(row.app_id){const a=await access(db,actor,row.app_id);if(a.dataRole||a.managementRole)visible.push(row);}else if(row.actor_id===actor.id)visible.push(row);}return visible;});
  async function admin(req:any){const actor=await actorFor(req,db,config,true);if(!actor.admin)fail(403,'ADMIN_REQUIRED','Нужны права администратора');return actor;}
  server.get('/api/admin/status',async req=>{const actor=await admin(req);return {mode:config.mode,region:config.region,database:config.databaseUrl?'PostgreSQL':'PGlite (локальный PostgreSQL)',runtime:config.runnerUrl?'gVisor runner подключён':'Серверные функции не подключены',directory_synced_at:(await db.query('SELECT directory_synced_at FROM organizations WHERE id=$1',[actor.org_id])).rows[0].directory_synced_at,public_links:false,external_connectors:false};});
  server.post('/api/admin/users/:id/disable',async req=>{const actor=await admin(req);await db.transaction(tx=>disableUser(tx,actor,(req.params as any).id));return {ok:true};});
  server.post('/api/admin/lifecycle/run',async req=>{await admin(req);await sweepLifecycle(db);return {ok:true};});
  server.get('/api/admin/secrets',async req=>{const actor=await admin(req);return (await db.query('SELECT id,name,created_at FROM secrets WHERE org_id=$1 ORDER BY name',[actor.org_id])).rows;});
  server.post('/api/admin/secrets',async req=>{const actor=await admin(req);const input=z.object({name:z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),value:z.string().min(1).max(16000)}).parse(req.body);await db.transaction(async tx=>{await tx.query('INSERT INTO secrets(id,org_id,name,encrypted) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,name) DO UPDATE SET encrypted=excluded.encrypted',[randomUUID(),actor.org_id,input.name,encryptSecret(input.value,key)]);await audit(tx,actor,'secret.saved',undefined,{name:input.name});});return {ok:true};});
  server.delete('/api/admin/secrets/:id',async req=>{const actor=await admin(req);await db.transaction(async tx=>{await tx.query('DELETE FROM secrets WHERE id=$1 AND org_id=$2',[(req.params as any).id,actor.org_id]);await audit(tx,actor,'secret.deleted');});return {ok:true};});
  server.post('/api/admin/directory/sync',async req=>{
    if(!config.directoryToken || !sameSecret(req.headers.authorization||'',`Bearer ${config.directoryToken}`))fail(403,'DIRECTORY_TOKEN_REQUIRED','Требуется ключ интеграции каталога');
    if(!config.oidcIssuer)fail(409,'OIDC_REQUIRED','Настройте корпоративный IdP');
    const input=z.object({users:z.array(z.object({subject:z.string().min(1),name:z.string().min(1).max(100),email:z.string().email(),active:z.boolean(),groups:z.array(z.string().max(80)).max(30)}).strict()).max(500)}).strict().parse(req.body);
    const initiator=(await db.query<Actor>('SELECT * FROM users WHERE org_id=$1 AND admin=true AND active=true ORDER BY id LIMIT 1',[orgId])).rows[0];if(!initiator)fail(409,'ADMIN_REQUIRED','Сначала войдите как начальный администратор');
    await db.transaction(async tx=>{
      for(const user of input.users) {
        const id=actorId(config.oidcIssuer!,user.subject);
        await tx.query('INSERT INTO users(id,org_id,name,email,avatar,issuer,subject,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email',[id,orgId,user.name,user.email,user.name.slice(0,2).toUpperCase(),config.oidcIssuer,user.subject,user.active]);
        if(!user.active && id!==initiator.id)await disableUser(tx,initiator,id);else if(!user.active)fail(409,'ADMIN_REQUIRED','Назначьте другого администратора перед отключением последнего');else await tx.query('UPDATE users SET active=true WHERE id=$1',[id]);
        await tx.query('DELETE FROM memberships WHERE user_id=$1',[id]);
        for(const name of user.groups){const groupId=`group_${Buffer.from(name).toString('base64url')}`;await tx.query('INSERT INTO groups(id,org_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[groupId,orgId,name]);await tx.query('INSERT INTO memberships(user_id,group_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,groupId]);}
      }
      await tx.query('UPDATE organizations SET directory_synced_at=now() WHERE id=$1',[orgId]);await audit(tx,initiator,'directory.synced',undefined,{count:input.users.length});
    });return {ok:true};
  });
  const clientRoot=resolve('dist/client');
  if(existsSync(clientRoot)) {await server.register(staticFiles,{root:clientRoot,prefix:'/'});server.setNotFoundHandler((req,reply)=>req.url.startsWith('/api')?reply.code(404).send({error:{code:'NOT_FOUND',message:'Маршрут не найден'}}):reply.sendFile('index.html'));}
  const timer=config.mode==='test'?null:setInterval(()=>sweepLifecycle(db).catch(()=>server.log.error('Lifecycle sweep failed')),60_000);
  timer?.unref();server.addHook('onClose',async()=>{if(timer)clearInterval(timer);if(!providedDb)await db.close();});
  await server.ready();return {server,db};
}
