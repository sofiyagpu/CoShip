import type { Database, Sql } from './db.js';
import { audit } from './auth.js';
import { fail } from './errors.js';
import type { Actor } from '../../../packages/shared/src/index.js';

export async function disableUser(tx:Sql,actor:Actor,id:string) {
  const user=(await tx.query('SELECT * FROM users WHERE id=$1 AND org_id=$2 FOR UPDATE',[id,actor.org_id])).rows[0];
  if(!user)fail(404,'USER_NOT_FOUND','Сотрудник не найден');
  if(id===actor.id)fail(400,'SELF_DISABLE','Нельзя отключить собственную учётную запись этим действием');
  const fallback=(await tx.query('SELECT id FROM users WHERE org_id=$1 AND admin=true AND active=true AND id<>$2 ORDER BY id LIMIT 1',[actor.org_id,id])).rows[0];
  if(!fallback)fail(409,'ADMIN_REQUIRED','Нужен другой действующий администратор');
  await tx.query('UPDATE users SET active=false WHERE id=$1',[id]);
  await tx.query('DELETE FROM sessions WHERE user_id=$1',[id]);
  const apps=(await tx.query('SELECT * FROM apps WHERE owner_id=$1 FOR UPDATE',[id])).rows;
  for(const app of apps) {
    const backup=app.backup_owner_id?(await tx.query('SELECT id FROM users WHERE id=$1 AND org_id=$2 AND active=true AND id<>$3',[app.backup_owner_id,actor.org_id,id])).rows[0]:null;
    await tx.query('UPDATE apps SET owner_id=$1,needs_owner=$2,updated_at=now() WHERE id=$3',[backup?.id||fallback.id,!backup,app.id]);
    await audit(tx,actor,'app.owner_transferred',app.id,{from:id,to:backup?.id||fallback.id});
  }
  await audit(tx,actor,'user.disabled',undefined,{user_id:id});
}
export async function sweepLifecycle(db:Database) {
  await db.transaction(async tx=>{
    const pending=(await tx.query("UPDATE apps SET status='archive_pending',archive_after=now()+interval '7 days' WHERE status='active' AND pinned=false AND coalesce(last_used_at,created_at)<now()-interval '60 days' RETURNING id,org_id")).rows;
    for(const app of pending)await tx.query("INSERT INTO audit_events(id,org_id,app_id,action) VALUES(gen_random_uuid()::text,$1,$2,'app.archive_pending')",[app.org_id,app.id]);
    const archived=(await tx.query("UPDATE apps SET status='archived',updated_at=now() WHERE status='archive_pending' AND pinned=false AND archive_after<now() RETURNING id,org_id")).rows;
    for(const app of archived)await tx.query("INSERT INTO audit_events(id,org_id,app_id,action) VALUES(gen_random_uuid()::text,$1,$2,'app.auto_archived')",[app.org_id,app.id]);
    await tx.query('DELETE FROM sessions WHERE expires_at<now()');
    await tx.query('DELETE FROM auth_requests WHERE expires_at<now()');
    await tx.query('DELETE FROM cli_requests WHERE expires_at<now()');
  });
}
