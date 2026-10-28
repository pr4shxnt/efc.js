import type { Pool } from 'pg';
import { getLogger } from '../logger.js';
import { countStatement } from './query-log.js';
import type { DatabasePoolConfig } from '../types.js';

// Pre-Flight's PostgreSQL connection: a node-postgres Pool (exposed as `db`) plus a
// Drizzle instance over it that the model adapter queries through.

/* eslint-disable @typescript-eslint/no-explicit-any -- drizzle is an optional peer, loaded dynamically */
let pool: Pool | undefined;

/** Only a genuinely missing package becomes "not installed"; other load errors surface as-is. */
export function notInstalled(err: unknown, pkg: string, install: string): Error {
  const code = (err as { code?: string }).code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND'
    ? new Error(`[EFC] ${pkg} is not installed. Run: ${install}`)
    : (err as Error);
}
let orm: any;

export async function connectPostgres(
  url: string,
  poolConfig: DatabasePoolConfig = {},
): Promise<Pool> {
  let PoolCtor: typeof Pool;
  try {
    const pg = (await import('pg')) as unknown as {
      default?: { Pool: typeof Pool };
      Pool?: typeof Pool;
    };
    PoolCtor = (pg.default?.Pool ?? pg.Pool)!;
  } catch (err) {
    throw notInstalled(err, 'pg', 'npm install pg drizzle-orm');
  }
  let drizzle: (client: Pool, config: object) => unknown;
  try {
    ({ drizzle } = (await import('drizzle-orm/node-postgres')) as unknown as {
      drizzle: (client: Pool, config: object) => unknown;
    });
  } catch (err) {
    throw notInstalled(err, 'drizzle-orm', 'npm install drizzle-orm');
  }

  const next = new PoolCtor({
    connectionString: url,
    ...(poolConfig.max !== undefined && { max: poolConfig.max }),
    ...(poolConfig.idleTimeoutMs !== undefined && { idleTimeoutMillis: poolConfig.idleTimeoutMs }),
    ...(poolConfig.connectionTimeoutMs !== undefined && {
      connectionTimeoutMillis: poolConfig.connectionTimeoutMs,
    }),
  });
  // Idle-client errors (e.g. the server restarting) are emitted on the pool; unhandled
  // they would crash the process.
  next.on('error', (err) => getLogger().error({ err }, 'PostgreSQL pool error'));
  try {
    await next.query('select 1');
  } catch (err) {
    await next.end().catch(() => {});
    throw explainPostgresError(err, url);
  }
  pool = next;
  // Every model statement goes through Drizzle, in or out of a transaction: count it.
  orm = drizzle(next, { logger: { logQuery: countStatement } });
  getLogger().info('PostgreSQL connected');
  return next;
}

/** Where a connection string points, without the password (for error messages). */
function describeUrl(url: string): { where: string; user: string; database: string } {
  try {
    const u = new URL(url);
    const database = decodeURIComponent(u.pathname.slice(1)) || '(default)';
    return {
      where: `${u.hostname || 'localhost'}:${u.port || '5432'}`,
      user: decodeURIComponent(u.username) || '(none)',
      database,
    };
  } catch {
    return { where: '(unparsable DATABASE_URL)', user: '?', database: '?' };
  }
}

/**
 * node-postgres' connection errors, said in terms of DATABASE_URL — e.g. a URL with no password
 * surfaces from pg as "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string".
 * Unrecognised errors come back unchanged. The original is kept as `cause`.
 */
export function explainPostgresError(err: unknown, url: string): Error {
  const e = err as { code?: string; message?: string };
  const msg = e.message ?? '';
  const { where, user, database } = describeUrl(url);
  const hosted = 'For Neon, Supabase or RDS, copy the full connection string from the dashboard.';
  let text: string | undefined;
  if (/client password must be a string/.test(msg)) {
    text = `PostgreSQL asked for a password and DATABASE_URL has none (user "${user}" at ${where}). Put it in the URL: postgres://${user === '(none)' ? 'user' : user}:<password>@${where}/${database === '(default)' ? 'db' : database}. ${hosted}`;
  } else if (e.code === '28P01') {
    text = `PostgreSQL rejected the password for user "${user}" at ${where}. Check DATABASE_URL (special characters in the password must be URL-encoded). ${hosted}`;
  } else if (e.code === '28000' && /role .* does not exist/.test(msg)) {
    text = `PostgreSQL has no user "${user}" at ${where}. Create it (CREATE ROLE ${user} LOGIN PASSWORD '…';) or fix the user in DATABASE_URL.`;
  } else if (/no pg_hba\.conf entry.*no encryption/.test(msg)) {
    text = `PostgreSQL at ${where} only accepts encrypted connections. Add ?sslmode=require to DATABASE_URL.`;
  } else if (e.code === '28000') {
    text = `PostgreSQL at ${where} refused user "${user}": ${msg}`;
  } else if (e.code === '3D000') {
    text = `Database "${database}" does not exist at ${where}. Create it first: createdb ${database} (or CREATE DATABASE "${database}";).`;
  } else if (/does not support SSL/.test(msg)) {
    text = `PostgreSQL at ${where} doesn't support SSL. Remove sslmode / ssl from DATABASE_URL (local servers usually run without it).`;
  } else if (e.code === 'ECONNREFUSED') {
    text = `Nothing is accepting connections at ${where}. Is PostgreSQL running, and is the host/port in DATABASE_URL right?`;
  } else if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
    text = `Can't resolve the PostgreSQL host in DATABASE_URL (${where}). Check the hostname.`;
  } else if (e.code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    text = `Timed out connecting to PostgreSQL at ${where}. Check the host, and that a firewall / the provider's IP allow-list lets this machine in.`;
  }
  return text ? new Error(`[EFC] ${text}`, { cause: err }) : (err as Error);
}

/**
 * Every cluster worker opens its own pools, so a machine's total is `workers × (pool + …)`.
 * Logs that total against the server's limit, warning when this machine alone can exhaust it.
 * Best effort: a failure to read the limit is ignored.
 */
export async function checkConnectionBudget(
  perMachine: number,
  breakdown: string,
): Promise<void> {
  const log = getLogger();
  try {
    const { rows } = await getPool().query<{ max: number; reserved: number }>(
      `select current_setting('max_connections')::int as max,
              current_setting('superuser_reserved_connections')::int as reserved`,
    );
    const { max, reserved } = rows[0]!;
    const usable = max - reserved;
    if (perMachine > usable) {
      log.warn(
        `[EFC] PostgreSQL connections: up to ${perMachine} from this machine (${breakdown}), but the server allows ${usable} (max_connections ${max} − ${reserved} reserved). Under load, queries will fail with "too many clients". Lower databasePool.max or workers, or put PgBouncer in front.`,
      );
    } else {
      log.info(
        `PostgreSQL connections: up to ${perMachine} from this machine (${breakdown}) of ${usable} allowed — multiply by your instance count if you run several`,
      );
    }
  } catch {
    /* can't read the limit (permissions, pooler) — nothing to compare against */
  }
}

export function getOrm(): any {
  if (!orm) {
    throw new Error(
      '[EFC] PostgreSQL not connected — set database/databaseUrl in ignite() (or call connectPostgres)',
    );
  }
  return orm;
}

export function getPool(): Pool {
  if (!pool) throw new Error('[EFC] PostgreSQL not connected');
  return pool;
}

export async function closePostgres(): Promise<void> {
  const p = pool;
  pool = undefined;
  orm = undefined;
  await p?.end();
}
