import { canonical } from '../../../packages/shared/src/canonical.js';
import { randomUUID } from 'node:crypto';
import AjvModule from 'ajv';
import { dataRequestSchema, type Actor, type Manifest } from '../../../packages/shared/src/index.js';
import type { Database } from './db.js';
import { requireAccess } from './policy.js';
import { fail } from './errors.js';
import { audit } from './auth.js';
const Ajv = (AjvModule as any).default || AjvModule;
export const ajv = new Ajv({ strict:false, allErrors:true, validateFormats:false, addUsedSchema:false });
export async function dataOperation(db:Database,actor:Actor,appId:string,releaseId:string,raw:unknown) {
  const input=dataRequestSchema.parse(raw), write=['insert','update','delete'].includes(input.operation);
  return db.transaction(async tx=>{
    if(write)await tx.query('SELECT id FROM apps WHERE id=$1 AND org_id=$2 FOR UPDATE',[appId,actor.org_id]);
    const {app}=await requireAccess(tx,actor,appId,write?'write':'read');
    if(app.active_release_id!==releaseId) fail(409,'RELEASE_CHANGED','Приложение обновилось. Откройте его снова');
    const release=(await tx.query('SELECT manifest FROM releases WHERE id=$1 AND app_id=$2',[releaseId,appId])).rows[0];
    const manifest=release?.manifest as Manifest;
    const collection=manifest?.data.collections[input.collection];
    if(!Object.hasOwn(manifest.data.collections,input.collection) || !collection || !collection.operations.includes(input.operation)) fail(403,'CAPABILITY_DENIED','Операция не разрешена для этой коллекции');
    if(['get','update','delete'].includes(input.operation) && !input.id) fail(400,'ID_REQUIRED','Нужен идентификатор записи');
    if(['update','delete'].includes(input.operation) && !input.revision) fail(400,'REVISION_REQUIRED','Нужна версия записи');
    if(['insert','update'].includes(input.operation)) {
      if(!input.payload || JSON.stringify(input.payload).length>65536) fail(400,'INVALID_RECORD','Запись отсутствует или превышает 64 КБ');
      const validate=ajv.compile(collection.schema); if(!validate(input.payload)) fail(400,'SCHEMA_VALIDATION','Поля записи не соответствуют схеме');
    }
    // PostgreSQL's role and transaction-local context form the second boundary.
    await tx.query("SELECT set_config('coship.org_id',$1,true),set_config('coship.app_id',$2,true)",[actor.org_id,appId]);
    await tx.query('SET LOCAL ROLE coship_data_runtime');
    let output:any;
    if(input.operation==='list') {
      const {rows}=await tx.query('SELECT id,payload,revision,created_at,updated_at FROM records WHERE app_id=$1 AND collection=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4',[appId,input.collection,input.cursor??null,input.limit+1]);
      output={items:rows.slice(0,input.limit),next_cursor:rows.length>input.limit?rows[input.limit-1].id:null};
    } else if(input.operation==='get') {
      output=(await tx.query('SELECT id,payload,revision,created_at,updated_at FROM records WHERE app_id=$1 AND collection=$2 AND id=$3',[appId,input.collection,input.id])).rows[0];
      if(!output) fail(404,'RECORD_NOT_FOUND','Запись не найдена');
    } else if(input.operation==='insert') {
      if(!input.idempotency_key) fail(400,'IDEMPOTENCY_REQUIRED','Нужен idempotency_key');
      const existing=(await tx.query('SELECT * FROM records WHERE app_id=$1 AND collection=$2 AND created_by=$3 AND idempotency_key=$4',[appId,input.collection,actor.id,input.idempotency_key])).rows[0];
      if(existing) { if(canonical(existing.payload)!==canonical(input.payload)) fail(409,'IDEMPOTENCY_CONFLICT','Этот ключ уже использован с другой записью'); output=existing; }
      else { const count=Number((await tx.query('SELECT count(*) AS total FROM records WHERE app_id=$1',[appId])).rows[0].total); if(count>=10000) fail(429,'STORAGE_QUOTA','Достигнут лимит 10 000 записей');
        output=(await tx.query('INSERT INTO records(id,org_id,app_id,collection,payload,created_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,payload,revision,created_at,updated_at',[randomUUID(),actor.org_id,appId,input.collection,JSON.stringify(input.payload),actor.id,input.idempotency_key])).rows[0]; }
    } else if(input.operation==='update') {
      output=(await tx.query('UPDATE records SET payload=$1,revision=revision+1,updated_at=now() WHERE app_id=$2 AND collection=$3 AND id=$4 AND revision=$5 RETURNING id,payload,revision,created_at,updated_at',[JSON.stringify(input.payload),appId,input.collection,input.id,input.revision])).rows[0];
      if(!output) fail(409,'REVISION_CONFLICT','Запись уже изменена. Обновите данные');
    } else {
      const r=await tx.query('DELETE FROM records WHERE app_id=$1 AND collection=$2 AND id=$3 AND revision=$4 RETURNING id',[appId,input.collection,input.id,input.revision]);
      if(!r.rows[0]) fail(409,'REVISION_CONFLICT','Запись уже изменена или удалена'); output={deleted:true};
    }
    await tx.query('RESET ROLE');
    await tx.query("UPDATE apps SET last_used_at=now(),status='active',archive_after=NULL WHERE id=$1",[appId]);
    await audit(tx,actor,`data.${input.operation}`,appId,{collection:input.collection});
    return output;
  });
}
