// Wraps mongoose connection for Pre-Flight. Throws clearly if mongoose isn't installed.
import type * as MongooseNS from 'mongoose';
import { getLogger } from '../logger.js';
import { loadMongoose } from './mongo-model.js';
import type { DatabasePoolConfig } from '../types.js';

export async function connectMongo(
  url: string,
  pool: DatabasePoolConfig = {},
): Promise<MongooseNS.Connection> {
  // loadMongoose() unwraps the CJS default export: in native ESM the namespace's own
  // `connection` binding is not the live connection, so reading it gave `undefined`.
  const mg = await loadMongoose();
  await mg
    .connect(url, {
    ...(pool.max !== undefined && { maxPoolSize: pool.max }),
    ...(pool.idleTimeoutMs !== undefined && { maxIdleTimeMS: pool.idleTimeoutMs }),
    ...(pool.connectionTimeoutMs !== undefined && {
      serverSelectionTimeoutMS: pool.connectionTimeoutMs,
      waitQueueTimeoutMS: pool.connectionTimeoutMs,
    }),
    })
    .catch((err: unknown) => {
      throw explainMongoError(err, url);
    });
  getLogger().info('MongoDB connected');
  return mg.connection;
}

/**
 * mongoose's connection errors, said in terms of DATABASE_URL. Unrecognised errors come back
 * unchanged; the original is kept as `cause`.
 */
export function explainMongoError(err: unknown, url: string): Error {
  const e = err as { code?: number; codeName?: string; name?: string; message?: string };
  let where = '(unparsable DATABASE_URL)';
  let user = '(none)';
  try {
    const u = new URL(url);
    where = u.host || 'localhost';
    user = decodeURIComponent(u.username) || '(none)';
  } catch {
    /* keep the placeholders */
  }
  let text: string | undefined;
  if (e.code === 18 || e.codeName === 'AuthenticationFailed') {
    text = `MongoDB rejected the login for user "${user}" at ${where}. Check the username and password in DATABASE_URL (special characters must be URL-encoded), and authSource if the user lives in another database.`;
  } else if (e.name === 'MongooseServerSelectionError' || e.name === 'MongoServerSelectionError') {
    text = `Could not reach MongoDB at ${where}. Is it running? On Atlas, add this machine's IP under Network Access.`;
  } else if (e.name === 'MongoParseError') {
    text = `DATABASE_URL isn't a valid MongoDB connection string: ${e.message ?? ''}`;
  }
  return text ? new Error(`[EFC] ${text}`, { cause: err }) : (err as Error);
}
