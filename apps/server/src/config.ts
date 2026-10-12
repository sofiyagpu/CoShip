import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');

export interface Config {
  mode: 'development' | 'enterprise' | 'test';
  port: number;
  host: string;
  publicUrl: string;
  dataDir: string;
  databaseUrl?: string;
  orgName: string;
  region: string;
  masterKey?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcDomain?: string;
  oidcTenant?: string;
  adminSubject?: string;
  directoryToken?: string;
  runnerUrl?: string;
  runnerKey?: string;
  museApiKey?: string;
  museBaseUrl: string;
  museModel: string;
}
export function configFromEnv(): Config {
  const mode = (process.env.COSHIP_MODE || 'development') as Config['mode'];
  if (!['development', 'enterprise', 'test'].includes(mode)) throw new Error('Unknown COSHIP_MODE');
  const config: Config = {
    mode,
    port: Number(process.env.PORT || 4300),
    host: mode === 'enterprise' ? '0.0.0.0' : '127.0.0.1',
    publicUrl: process.env.PUBLIC_URL || 'http://127.0.0.1:5173',
    dataDir: resolve(process.env.COSHIP_DATA_DIR || '.coship/data'),
    databaseUrl: process.env.DATABASE_URL,
    orgName: process.env.COSHIP_ORG_NAME || 'Acme Studio',
    region: process.env.COSHIP_REGION || 'KZ',
    masterKey: process.env.COSHIP_MASTER_KEY,
    oidcIssuer: process.env.OIDC_ISSUER,
    oidcClientId: process.env.OIDC_CLIENT_ID,
    oidcClientSecret: process.env.OIDC_CLIENT_SECRET,
    oidcDomain: process.env.OIDC_ALLOWED_DOMAIN,
    oidcTenant: process.env.OIDC_TENANT_ID,
    adminSubject: process.env.COSHIP_ADMIN_SUBJECT,
    directoryToken: process.env.COSHIP_DIRECTORY_TOKEN,
    runnerUrl: process.env.COSHIP_RUNNER_URL,
    runnerKey: process.env.COSHIP_RUNNER_KEY,
    museApiKey: process.env.MUSE_API_KEY,
    museBaseUrl: (process.env.MUSE_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, ''),
    museModel: process.env.MUSE_MODEL || 'muse-spark-1.3',
  };
  if (config.runnerUrl || config.runnerKey) {
    if (!config.runnerUrl || !config.runnerKey || config.runnerKey.length < 32)
      throw new Error('Runner requires URL and a key of at least 32 characters');
    const url = new URL(config.runnerUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Invalid runner URL');
  }
  if (mode === 'enterprise') {
    for (const key of [
      'databaseUrl',
      'masterKey',
      'oidcIssuer',
      'oidcClientId',
      'oidcClientSecret',
      'adminSubject',
      'directoryToken',
    ] as const) {
      if (!config[key]) throw new Error(`Enterprise mode requires ${key}`);
    }
    if (!config.publicUrl.startsWith('https://'))
      throw new Error('Enterprise PUBLIC_URL must use HTTPS');
    if (!config.oidcIssuer?.startsWith('https://'))
      throw new Error('Enterprise OIDC issuer must use HTTPS');
    if (!config.oidcDomain && !config.oidcTenant)
      throw new Error('Configure OIDC_ALLOWED_DOMAIN or OIDC_TENANT_ID');
  }
  return config;
}
