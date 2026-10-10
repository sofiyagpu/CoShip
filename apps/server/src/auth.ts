import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Database, Sql } from './db.js';
import type { Config } from './config.js';
import type { Actor } from '../../../packages/shared/src/index.js';
import { fail } from './errors.js';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const orgId = 'org_coship';
export const actorId = (issuer: string, subject: string) => `u_${hash(`${issuer}:${subject}`).slice(0,24)}`;

export async function actorFor(req: FastifyRequest, db: Sql, config: Config, browserOnly = false): Promise<Actor> {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  const token = bearer || req.cookies.coship_session;
  if (!token) fail(401, 'SIGN_IN_REQUIRED', 'Войдите в рабочее пространство');
  const { rows } = await db.query<Actor & { kind: string }>('SELECT u.*,s.kind FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true', [hash(token)]);
  const actor = rows[0];
  if (!actor) fail(401, 'SESSION_EXPIRED', 'Сессия завершена. Войдите снова');
  if (browserOnly && actor.kind !== 'browser') fail(403, 'BROWSER_SESSION_REQUIRED', 'Это действие доступно только в Console');
  if (config.mode === 'enterprise') {
    const { rows: org } = await db.query('SELECT directory_synced_at FROM organizations WHERE id=$1', [actor.org_id]);
    const fresh = org[0]?.directory_synced_at && Date.now() - new Date(org[0].directory_synced_at).getTime() < 5*60_000;
    // Administrators retain access to repairing the directory, not to app data.
    if (!fresh && !req.url.startsWith('/api/admin') && req.url !== '/api/me' && req.url !== '/api/auth/logout') fail(503, 'DIRECTORY_STALE', 'Каталог не синхронизирован. Администратор должен обновить доступы');
  }
  return actor;
}
export async function newSession(db: Sql, userId: string, kind: 'browser'|'cli') {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions(token_hash,user_id,kind,expires_at) VALUES($1,$2,$3,$4)', [hash(token),userId,kind,new Date(Date.now()+(kind==='browser'?12:24)*3600_000).toISOString()]);
  return token;
}
export function setSession(reply: FastifyReply, token: string, config: Config) {
  reply.setCookie('coship_session', token, { httpOnly: true, secure: config.mode==='enterprise', sameSite:'lax', path:'/', maxAge:43200 });
}
export async function audit(db: Sql, actor: Pick<Actor,'id'|'org_id'>, action: string, appId?: string, metadata: object = {}) {
  await db.query('INSERT INTO audit_events(id,org_id,actor_id,app_id,action,metadata) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(),actor.org_id,actor.id,appId??null,action,JSON.stringify(metadata)]);
}

export function registerAuth(server: FastifyInstance, db: Database, config: Config) {
  server.get('/api/auth/config', async () => ({ mode:config.mode, organization:config.orgName, region:config.region, oidc:!!config.oidcIssuer }));
  if (config.mode !== 'enterprise') {
    server.get('/api/auth/demo-users', async () => (await db.query('SELECT id,name,email,avatar,admin FROM users WHERE org_id=$1 AND active=true ORDER BY admin DESC,name', [orgId])).rows);
    server.post('/api/auth/demo', async (req, reply) => {
      const id = (req.body as any)?.user_id;
      const { rows } = await db.query('SELECT id FROM users WHERE id=$1 AND org_id=$2 AND active=true', [id,orgId]);
      if (!rows[0]) fail(400,'UNKNOWN_USER','Выберите пользователя');
      setSession(reply,await newSession(db,id,'browser'),config); return { ok:true };
    });
  }
  server.post('/api/auth/logout', async (req,reply) => { if(req.cookies.coship_session) await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(req.cookies.coship_session)]); reply.clearCookie('coship_session',{path:'/'}); return {ok:true}; });
  server.get('/api/me', async req => { const actor = await actorFor(req,db,config); return { ...actor, mode:config.mode, organization:config.orgName, region:config.region, runnerEnabled:!!config.runnerUrl }; });
  server.post('/api/auth/cli/request', async () => {
    const id=randomUUID(), code=randomBytes(32).toString('base64url');
    await db.query('INSERT INTO cli_requests(id,code_hash,expires_at) VALUES($1,$2,$3)',[id,hash(code),new Date(Date.now()+300000).toISOString()]);
    return { request_id:id, device_code:code, verification_url:`${config.publicUrl}/#authorize/${id}`, expires_in:300 };
  });
  server.post('/api/auth/cli/approve', async req => {
    const actor = await actorFor(req,db,config,true); const id=(req.body as any)?.request_id;
    const r = await db.query('UPDATE cli_requests SET approved_by=$1 WHERE id=$2 AND expires_at>now() AND approved_by IS NULL RETURNING id',[actor.id,id]);
    if(!r.rows[0]) fail(400,'REQUEST_EXPIRED','Запрос истёк или уже подтверждён');
    await audit(db,actor,'cli.authorized'); return {ok:true};
  });
  server.post('/api/auth/cli/token', async req => {
    const { request_id, device_code } = (req.body||{}) as any;
    return db.transaction(async tx => {
      const {rows}=await tx.query('SELECT * FROM cli_requests WHERE id=$1 AND code_hash=$2 AND expires_at>now() FOR UPDATE',[request_id,hash(String(device_code))]);
      if(!rows[0]) fail(400,'REQUEST_EXPIRED','Запрос входа истёк');
      if(!rows[0].approved_by) return {status:'pending'};
      const user=await tx.query('SELECT id FROM users WHERE id=$1 AND active=true',[rows[0].approved_by]);
      if(!user.rows[0]) fail(403,'USER_DISABLED','Учётная запись отключена');
      const token=await newSession(tx,rows[0].approved_by,'cli'); await tx.query('DELETE FROM cli_requests WHERE id=$1',[request_id]);
      return {status:'approved',token,expires_in:86400};
    });
  });
  if(config.oidcIssuer && config.oidcClientId) {
    let discovery: any;
    async function discover() {
      if (!discovery) { const response=await fetch(`${config.oidcIssuer!.replace(/\/$/,'')}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(10000)}); if(!response.ok) fail(503,'OIDC_UNAVAILABLE','Корпоративный вход недоступен'); discovery=await response.json(); if(discovery.issuer!==config.oidcIssuer) throw new Error('OIDC issuer mismatch'); }
      return discovery;
    }
    server.get('/api/auth/oidc',async (_req,reply)=>{
      const d=await discover(), state=randomBytes(24).toString('base64url'), verifier=randomBytes(32).toString('base64url'), nonce=randomBytes(24).toString('base64url');
      await db.query('INSERT INTO auth_requests(state,payload,expires_at) VALUES($1,$2,$3)',[state,JSON.stringify({verifier,nonce}),new Date(Date.now()+300000).toISOString()]);
      reply.setCookie('coship_oidc',state,{httpOnly:true,secure:config.mode==='enterprise',sameSite:'lax',path:'/api/auth',maxAge:300});
      const url=new URL(d.authorization_endpoint); const params={client_id:config.oidcClientId!,redirect_uri:`${config.publicUrl}/api/auth/callback`,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'};
      Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v)); return reply.redirect(url.toString());
    });
    server.get('/api/auth/callback',async (req,reply)=>{
      const {state,code} = req.query as any;
      if(!state || req.cookies.coship_oidc!==state || typeof code!=='string') fail(400,'INVALID_OIDC_STATE','Не удалось проверить вход');
      const result=await db.query('DELETE FROM auth_requests WHERE state=$1 AND expires_at>now() RETURNING payload',[state]);
      if(!result.rows[0]) fail(400,'INVALID_OIDC_STATE','Запрос входа истёк');
      const {verifier,nonce}=result.rows[0].payload, d=await discover();
      const response=await fetch(d.token_endpoint,{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code,client_id:config.oidcClientId!,client_secret:config.oidcClientSecret!,redirect_uri:`${config.publicUrl}/api/auth/callback`,code_verifier:verifier}),signal:AbortSignal.timeout(10000)});
      if(!response.ok) fail(401,'OIDC_FAILED','Не удалось завершить корпоративный вход');
      const tokens=await response.json() as any;
      const {payload}=await jwtVerify(tokens.id_token,createRemoteJWKSet(new URL(d.jwks_uri)),{issuer:config.oidcIssuer,audience:config.oidcClientId,algorithms:['RS256','ES256'],requiredClaims:['exp','iat','sub','nonce']}).catch(()=>fail(401,'INVALID_OIDC_TOKEN','Не удалось проверить корпоративный токен'));
      if(payload.nonce!==nonce || !payload.sub) fail(401,'INVALID_OIDC_TOKEN','Некорректный ответ провайдера');
      if(config.oidcDomain && payload.hd!==config.oidcDomain) fail(403,'WRONG_ORGANIZATION','Аккаунт другой организации');
      if(config.oidcTenant && payload.tid!==config.oidcTenant) fail(403,'WRONG_ORGANIZATION','Аккаунт другого корпоративного каталога');
      const directorySubject=config.oidcTenant?String(payload.oid||''):payload.sub;
      if(!directorySubject)fail(401,'INVALID_OIDC_TOKEN','Отсутствует идентификатор каталога');
      const id=actorId(config.oidcIssuer!,directorySubject), email=String(payload.email || payload.preferred_username || '');
      let user=(await db.query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
      if(!user) {
        const firstAdmin=!(await db.query('SELECT id FROM users WHERE org_id=$1 AND admin=true',[orgId])).rows.length;
        if(!firstAdmin || directorySubject!==config.adminSubject || (config.oidcDomain && payload.email_verified!==true)) fail(403,'NOT_PROVISIONED','Администратор должен добавить вас через корпоративный каталог');
        await db.query('INSERT INTO users(id,org_id,name,email,avatar,admin,issuer,subject) VALUES($1,$2,$3,$4,$5,true,$6,$7)',[id,orgId,String(payload.name||email),email,'AD',config.oidcIssuer,directorySubject]);
        user={id,active:true};
      }
      if(!user.active) fail(403,'USER_DISABLED','Учётная запись отключена');
      setSession(reply,await newSession(db,id,'browser'),config); reply.clearCookie('coship_oidc',{path:'/api/auth'}); return reply.redirect(`${config.publicUrl}/`);
    });
  }
}
