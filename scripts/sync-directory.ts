/** Trusted directory adapter. Run separately from application code and AI agents. */
import { readFile } from 'node:fs/promises';
import { SignJWT, importPKCS8 } from 'jose';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
const provider = process.env.DIRECTORY_PROVIDER;
const endpoint = process.env.COSHIP_SERVER;
const syncToken = process.env.COSHIP_DIRECTORY_TOKEN;
if (!['google', 'microsoft'].includes(provider || '') || !endpoint || !syncToken)
  throw new Error('Configure DIRECTORY_PROVIDER, COSHIP_SERVER and COSHIP_DIRECTORY_TOKEN');
type DirectoryUser = {
  subject: string;
  name: string;
  email: string;
  active: boolean;
  groups: { id: string; name: string }[];
};
async function json(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Directory HTTP ${response.status}`);
  return response.json();
}
async function microsoft(): Promise<DirectoryUser[]> {
  const tenant = process.env.DIRECTORY_TENANT_ID,
    client = process.env.DIRECTORY_CLIENT_ID,
    secret = process.env.DIRECTORY_CLIENT_SECRET;
  if (!tenant || !client || !secret) throw new Error('Microsoft directory credentials missing');
  const auth = await json(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      body: new URLSearchParams({
        client_id: client,
        client_secret: secret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
    },
  );
  async function pages(path: string) {
    let url = `https://graph.microsoft.com/v1.0/${path}`;
    const items: any[] = [];
    let page = 0;
    while (url) {
      if (new URL(url).origin !== 'https://graph.microsoft.com' || ++page > 100)
        throw new Error('Invalid Graph pagination');
      const result = await json(url, { headers: { authorization: `Bearer ${auth.access_token}` } });
      items.push(...result.value);
      url = result['@odata.nextLink'] || '';
    }
    return items;
  }
  const raw = await pages(
    'users?$select=id,displayName,mail,userPrincipalName,accountEnabled,userType&$top=100',
  );
  const users: DirectoryUser[] = [];
  for (const user of raw.filter((u) => u.userType === 'Member')) {
    const groups = await pages(
      `users/${encodeURIComponent(user.id)}/memberOf?$select=id,displayName`,
    );
    // OIDC sub is pairwise to the sign-in client, unlike Graph object ID. Use oid in Microsoft login.
    users.push({
      subject: user.id,
      name: user.displayName,
      email: user.mail || user.userPrincipalName,
      active: user.accountEnabled === true,
      groups: groups
        .filter((g) => g['@odata.type'] === '#microsoft.graph.group')
        .map((g) => ({ id: g.id, name: g.displayName })),
    });
  }
  return users;
}
async function google(): Promise<DirectoryUser[]> {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
    admin = process.env.GOOGLE_DIRECTORY_ADMIN;
  if (!file || !admin) throw new Error('Google directory credentials missing');
  const account = JSON.parse(await readFile(file, 'utf8'));
  const scopes =
    'https://www.googleapis.com/auth/admin.directory.user.readonly https://www.googleapis.com/auth/admin.directory.group.readonly https://www.googleapis.com/auth/admin.directory.group.member.readonly';
  const assertion = await new SignJWT({ scope: scopes })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(account.client_email)
    .setSubject(admin)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(await importPKCS8(account.private_key, 'RS256'));
  const auth = await json('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  async function pages(path: string, key: string) {
    const result: any[] = [];
    let next = '';
    let page = 0;
    do {
      if (++page > 100) throw new Error('Directory pagination limit');
      const url = new URL(`https://admin.googleapis.com/admin/directory/v1/${path}`);
      if (next) url.searchParams.set('pageToken', next);
      const data = await json(url.toString(), {
        headers: { authorization: `Bearer ${auth.access_token}` },
      });
      result.push(...(data[key] || []));
      next = data.nextPageToken || '';
    } while (next);
    return result;
  }
  const raw = await pages('users?customer=my_customer&maxResults=100', 'users');
  const users: DirectoryUser[] = raw.map((u) => ({
    subject: u.id,
    name: u.name.fullName,
    email: u.primaryEmail,
    active: !u.suspended && !u.archived,
    groups: [],
  }));
  const byId = new Map(users.map((u) => [u.subject, u]));
  const groups = await pages('groups?customer=my_customer&maxResults=100', 'groups');
  for (const group of groups) {
    const members = await pages(
      `groups/${encodeURIComponent(group.id)}/members?maxResults=100`,
      'members',
    );
    for (const member of members)
      if (member.type === 'USER')
        byId.get(member.id)?.groups.push({ id: group.id, name: group.name });
  }
  return users;
}
async function sync() {
  const users = await (provider === 'google' ? google() : microsoft());
  if (users.length > 500 || users.some((u) => u.groups.length > 30))
    throw new Error('Directory exceeds MVP limits; no partial snapshot sent');
  await json(`${endpoint}/api/admin/directory/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${syncToken}` },
    body: JSON.stringify({ complete: true, users }),
  });
  console.log(`Directory synchronized: ${users.length} accounts`);
}
if (process.argv.includes('--watch')) {
  for (;;) {
    try {
      await sync();
    } catch (e: any) {
      console.error(`Directory sync failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 120000));
  }
} else await sync();
