import { randomUUID } from 'node:crypto';
import type { Actor, ProjectPacket } from '../../../packages/shared/src/index.js';
import type { Database } from './db.js';
import { requireAccess } from './policy.js';
import { audit, hash } from './auth.js';
import { compileProject, compatible } from './compiler.js';
import { AppError, fail } from './errors.js';

export async function publishProject(db:Database,actor:Actor,input:{packet:unknown;app_id?:string;expected_release_id?:string|null;idempotency_key:string},runnerEnabled=false) {
  if(!input.idempotency_key || input.idempotency_key.length>100)fail(400,'IDEMPOTENCY_REQUIRED','Нужен ключ публикации');
  if(input.app_id)await requireAccess(db,actor,input.app_id,'publish');
  if(input.app_id && !Object.hasOwn(input,'expected_release_id'))fail(400,'EXPECTED_RELEASE_REQUIRED','Укажите expected_release_id');
  const requestHash=hash(JSON.stringify({packet:input.packet,app_id:input.app_id,expected_release_id:input.expected_release_id}));
  const id=randomUUID();
  const inserted=await db.query("INSERT INTO deployments(id,org_id,app_id,author_id,idempotency_key,request_hash,status) VALUES($1,$2,$3,$4,$5,$6,'checking') ON CONFLICT(org_id,author_id,idempotency_key) DO NOTHING RETURNING id",[id,actor.org_id,input.app_id??null,actor.id,input.idempotency_key,requestHash]);
  if(!inserted.rows[0]) {
    const old=(await db.query('SELECT * FROM deployments WHERE org_id=$1 AND author_id=$2 AND idempotency_key=$3',[actor.org_id,actor.id,input.idempotency_key])).rows[0];
    if(old.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','Ключ публикации уже использован для другого пакета');
    return old;
  }
  try {
    const compiled=await compileProject(input.packet);
    if(Object.keys(compiled.functions).length && !runnerEnabled)fail(422,'RUNNER_UNAVAILABLE','Для серверных функций подключите Linux-runner с gVisor');
    return await db.transaction(async tx=>{
      const active=(await tx.query('SELECT active FROM users WHERE id=$1 FOR SHARE',[actor.id])).rows[0];
      if(!active?.active)fail(403,'USER_DISABLED','Автор публикации отключён');
      let appId=input.app_id;
      const m=compiled.packet.manifest;
      if(appId) {
        await tx.query('SELECT id FROM apps WHERE id=$1 FOR UPDATE',[appId]);
        const {app}=await requireAccess(tx,actor,appId,'publish');
        if(app.status==='archived')fail(409,'APP_ARCHIVED','Сначала восстановите приложение');
        if(app.active_release_id!==input.expected_release_id)fail(409,'RELEASE_CONFLICT','Приложение уже обновилось. Получите новую активную версию');
        if(app.active_release_id) { const current=(await tx.query('SELECT packet FROM releases WHERE id=$1',[app.active_release_id])).rows[0]; compatible(current.packet,compiled.packet); }
      } else {
        const count=Number((await tx.query('SELECT count(*) AS total FROM apps WHERE org_id=$1',[actor.org_id])).rows[0].total);
        if(count>=100)fail(429,'APP_QUOTA','Достигнут лимит 100 приложений');
        appId=randomUUID();
        await tx.query('INSERT INTO apps(id,org_id,name,description,icon,color,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[appId,actor.org_id,m.name,m.description,m.icon,m.color,actor.id]);
        await tx.query("INSERT INTO grants(app_id,subject_type,subject_id,data_role) VALUES($1,'user',$2,'user')",[appId,actor.id]);
      }
      const releaseId=randomUUID();
      const version=Number((await tx.query('SELECT coalesce(max(version),0)+1 AS version FROM releases WHERE app_id=$1',[appId])).rows[0].version);
      await tx.query('INSERT INTO releases(id,app_id,version,manifest,html,functions,packet,digest,author_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[releaseId,appId,version,JSON.stringify(m),compiled.html,JSON.stringify(compiled.functions),JSON.stringify(compiled.packet),compiled.digest,actor.id]);
      for(const [name,col] of Object.entries(m.data.collections))await tx.query('INSERT INTO collections(app_id,name,schema) VALUES($1,$2,$3) ON CONFLICT(app_id,name) DO UPDATE SET schema=excluded.schema',[appId,name,JSON.stringify(col.schema)]);
      await tx.query('UPDATE apps SET active_release_id=$1,name=$2,description=$3,icon=$4,color=$5,updated_at=now() WHERE id=$6',[releaseId,m.name,m.description,m.icon,m.color,appId]);
      await tx.query("UPDATE deployments SET status='active',app_id=$1,release_id=$2,checks=$3 WHERE id=$4",[appId,releaseId,JSON.stringify(compiled.checks),id]);
      await audit(tx,actor,'app.published',appId,{version,digest:compiled.digest});
      return (await tx.query('SELECT * FROM deployments WHERE id=$1',[id])).rows[0];
    });
  } catch(error) {
    const e=error as Error;
    const safe=error instanceof AppError?{code:error.code,message:error.message}:{code:'BUILD_FAILED',message:'Не удалось собрать проект. Проверьте манифест, синтаксис и относительные импорты'};
    await db.query("UPDATE deployments SET status='failed',error=$1 WHERE id=$2",[JSON.stringify(safe),id]);
    return (await db.query('SELECT * FROM deployments WHERE id=$1',[id])).rows[0];
  }
}

export async function rollback(db:Database,actor:Actor,appId:string,releaseId:string,expected:string) {
  return db.transaction(async tx=>{
    await tx.query('SELECT id FROM apps WHERE id=$1 FOR UPDATE',[appId]);
    const {app}=await requireAccess(tx,actor,appId,'publish');
    if(app.status==='archived')fail(409,'APP_ARCHIVED','Сначала восстановите приложение');
    if(app.active_release_id!==expected)fail(409,'RELEASE_CONFLICT','Активная версия изменилась');
    const target=(await tx.query('SELECT * FROM releases WHERE id=$1 AND app_id=$2',[releaseId,appId])).rows[0];
    const current=(await tx.query('SELECT manifest FROM releases WHERE id=$1',[app.active_release_id])).rows[0];
    if(!target)fail(404,'RELEASE_NOT_FOUND','Версия не найдена');
    // Conservative: rolling back schema changes requires an explicit future migration workflow.
    if(JSON.stringify(target.manifest.data)!==JSON.stringify(current.manifest.data))fail(409,'SCHEMA_INCOMPATIBLE','Схема данных изменилась. Создайте совместимый релиз вместо отката');
    await tx.query('UPDATE apps SET active_release_id=$1,updated_at=now() WHERE id=$2',[releaseId,appId]);
    await audit(tx,actor,'app.rolled_back',appId,{release_id:releaseId});return {ok:true};
  });
}
