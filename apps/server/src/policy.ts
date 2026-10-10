import type { Actor, DataRole, ManagementRole } from '../../../packages/shared/src/index.js';
import type { Sql } from './db.js';
import { fail } from './errors.js';
export async function access(db: Sql, actor: Actor, appId: string) {
  const app=(await db.query('SELECT a.*,u.name AS owner_name FROM apps a JOIN users u ON u.id=a.owner_id WHERE a.id=$1 AND a.org_id=$2',[appId,actor.org_id])).rows[0];
  if(!app) fail(404,'APP_NOT_FOUND','Приложение не найдено');
  // Do not trust a cached Actor, including during long-running invocations.
  const user=(await db.query('SELECT active FROM users WHERE id=$1 AND org_id=$2',[actor.id,actor.org_id])).rows[0];
  if(!user?.active) fail(401,'USER_DISABLED','Учётная запись отключена');
  const grants=(await db.query(`SELECT * FROM grants WHERE app_id=$1 AND ((subject_type='user' AND subject_id=$2) OR (subject_type='group' AND subject_id IN (SELECT group_id FROM memberships WHERE user_id=$2)))`,[appId,actor.id])).rows;
  const dataRole: DataRole|null=grants.some(g=>g.data_role==='user')?'user':grants.some(g=>g.data_role==='viewer')?'viewer':null;
  const managementRole: ManagementRole=app.owner_id===actor.id?'owner':grants.some(g=>g.management_role==='builder')?'builder':null;
  return {app,dataRole,managementRole};
}
export async function requireAccess(db:Sql,actor:Actor,appId:string,action:'view'|'read'|'write'|'publish'|'manage') {
  const a=await access(db,actor,appId);
  const ok=action==='view' ? a.dataRole||a.managementRole||actor.admin : action==='read'?a.dataRole:action==='write'?a.dataRole==='user':action==='publish'?a.managementRole: a.managementRole==='owner'||actor.admin;
  if(!ok) fail(403,'ACCESS_DENIED','У вас нет прав на это действие');
  if((action==='read'||action==='write') && a.app.status==='archived') fail(409,'APP_ARCHIVED','Приложение в архиве');
  return a;
}
