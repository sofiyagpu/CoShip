import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import type { Config } from './config.js';
export interface Sql {
  query<T = any>(sql: string, values?: any[]): Promise<{ rows: T[]; affectedRows?: number }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function openDatabase(
  config: Pick<Config, 'databaseUrl' | 'dataDir'>,
): Promise<Database> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    return {
      query: async (sql, values) => {
        const r = await pool.query(sql, values);
        return { rows: r.rows, affectedRows: r.rowCount ?? 0 };
      },
      exec: async (sql) => {
        await pool.query(sql);
      },
      close: () => pool.end(),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const result = await fn({
            query: async (sql, v) => {
              const r = await c.query(sql, v);
              return { rows: r.rows, affectedRows: r.rowCount ?? 0 };
            },
          });
          await c.query('COMMIT');
          return result;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      },
    };
  }
  if (config.dataDir !== ':memory:') await mkdir(config.dataDir, { recursive: true });
  const db = new PGlite(config.dataDir === ':memory:' ? undefined : `${config.dataDir}/postgres`);
  await db.waitReady;
  return {
    query: (sql, values) => db.query(sql, values),
    exec: async (sql) => {
      await db.exec(sql);
    },
    close: () => db.close(),
    transaction: (fn) =>
      db.transaction((tx) => fn({ query: (sql, values) => tx.query(sql, values) })),
  };
}

export async function migrate(db: Database) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (id text PRIMARY KEY, name text NOT NULL, region text NOT NULL, directory_synced_at timestamptz);
    CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations, name text NOT NULL, email text NOT NULL, avatar text NOT NULL DEFAULT 'CS', admin boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, issuer text, subject text, UNIQUE(issuer,subject), UNIQUE(org_id,id));
    CREATE TABLE IF NOT EXISTS groups (id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations, name text NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (user_id text REFERENCES users, group_id text REFERENCES groups, PRIMARY KEY(user_id,group_id));
    CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users, kind text NOT NULL, expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_requests (state text PRIMARY KEY, payload jsonb NOT NULL, expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS cli_requests (id text PRIMARY KEY, code_hash text NOT NULL, approved_by text REFERENCES users, expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS apps (id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations, name text NOT NULL, description text NOT NULL DEFAULT '', icon text NOT NULL DEFAULT 'layers', color text NOT NULL DEFAULT 'violet', owner_id text NOT NULL REFERENCES users, backup_owner_id text REFERENCES users, status text NOT NULL DEFAULT 'active', needs_owner boolean NOT NULL DEFAULT false, active_release_id text, pinned boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, archive_after timestamptz, UNIQUE(org_id,id));
    CREATE TABLE IF NOT EXISTS grants (app_id text NOT NULL REFERENCES apps, subject_type text NOT NULL, subject_id text NOT NULL, data_role text, management_role text, PRIMARY KEY(app_id,subject_type,subject_id), CHECK(data_role IS NULL OR data_role IN ('viewer','user')), CHECK(management_role IS NULL OR management_role='builder'));
    CREATE TABLE IF NOT EXISTS favorites (app_id text NOT NULL REFERENCES apps, user_id text NOT NULL REFERENCES users, PRIMARY KEY(app_id,user_id));
    CREATE TABLE IF NOT EXISTS releases (id text PRIMARY KEY, app_id text NOT NULL REFERENCES apps, version integer NOT NULL, manifest jsonb NOT NULL, html text NOT NULL, functions jsonb NOT NULL DEFAULT '{}', packet jsonb NOT NULL, digest text NOT NULL, author_id text NOT NULL REFERENCES users, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(app_id,version));
    CREATE TABLE IF NOT EXISTS deployments (id text PRIMARY KEY, org_id text NOT NULL, app_id text REFERENCES apps, author_id text NOT NULL REFERENCES users, idempotency_key text NOT NULL, request_hash text NOT NULL, status text NOT NULL, release_id text, error jsonb, checks jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,author_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS collections (app_id text NOT NULL REFERENCES apps, name text NOT NULL, schema jsonb NOT NULL, PRIMARY KEY(app_id,name));
    CREATE TABLE IF NOT EXISTS records (id uuid PRIMARY KEY, org_id text NOT NULL, app_id text NOT NULL, collection text NOT NULL, payload jsonb NOT NULL, revision integer NOT NULL DEFAULT 1, created_by text NOT NULL REFERENCES users, idempotency_key uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(org_id,app_id) REFERENCES apps(org_id,id), FOREIGN KEY(app_id,collection) REFERENCES collections(app_id,name), UNIQUE(app_id,collection,created_by,idempotency_key));
    CREATE TABLE IF NOT EXISTS comments (id text PRIMARY KEY, app_id text NOT NULL REFERENCES apps, author_id text NOT NULL REFERENCES users, release_id text, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS audit_events (id text PRIMARY KEY, org_id text NOT NULL, actor_id text, app_id text, action text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS secrets (id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations, name text NOT NULL, encrypted text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,name));
    CREATE INDEX IF NOT EXISTS records_collection ON records(app_id,collection,id);
    CREATE INDEX IF NOT EXISTS audit_app ON audit_events(org_id,app_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
    DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='coship_data_runtime') THEN CREATE ROLE coship_data_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
    GRANT coship_data_runtime TO CURRENT_USER;
    GRANT USAGE ON SCHEMA public TO coship_data_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON records TO coship_data_runtime;
    ALTER TABLE records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE records FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS records_scope ON records;
    CREATE POLICY records_scope ON records TO coship_data_runtime
      USING (org_id=current_setting('coship.org_id',true) AND app_id=current_setting('coship.app_id',true))
      WITH CHECK (org_id=current_setting('coship.org_id',true) AND app_id=current_setting('coship.app_id',true));
  `);
}
