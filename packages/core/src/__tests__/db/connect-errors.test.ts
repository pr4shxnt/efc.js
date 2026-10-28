import { describe, it, expect, beforeAll } from 'vitest';
import { connectPostgres, closePostgres, explainPostgresError } from '../../db/postgres.js';
import { explainMongoError } from '../../db/mongo.js';

// Connection failures should say what to fix in DATABASE_URL, not echo node-postgres.
// The real-server cases self-skip when the test PostgreSQL isn't reachable.
const PG_URL = process.env['EFC_TEST_PG_URL'] ?? 'postgres://postgres@127.0.0.1:5433/efc_test';

async function reachablePg(url: string): Promise<boolean> {
  try {
    await connectPostgres(url);
    await closePostgres();
    return true;
  } catch {
    return false;
  }
}

describe('explainPostgresError', () => {
  const url = 'postgres://app@db.example.com:6543/shop';

  it('turns the no-password SASL error into a DATABASE_URL hint', () => {
    // node-postgres' own message for a URL without a password against SCRAM auth.
    const raw = new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string');
    const e = explainPostgresError(raw, url);
    expect(e.message).toMatch(/^\[EFC\] PostgreSQL asked for a password and DATABASE_URL has none/);
    expect(e.message).toContain('postgres://app:<password>@db.example.com:6543/shop');
    expect(e.cause).toBe(raw);
  });

  it('never echoes the password', () => {
    const raw = Object.assign(new Error('password authentication failed for user "app"'), {
      code: '28P01',
    });
    const e = explainPostgresError(raw, 'postgres://app:hunter2@db.example.com/shop');
    expect(e.message).toMatch(/rejected the password for user "app" at db\.example\.com:5432/);
    expect(e.message).not.toContain('hunter2');
  });

  it('suggests sslmode=require when the server insists on encryption', () => {
    const raw = Object.assign(
      new Error('no pg_hba.conf entry for host "1.2.3.4", user "app", database "shop", no encryption'),
      { code: '28000' },
    );
    expect(explainPostgresError(raw, url).message).toContain('?sslmode=require');
  });

  it('leaves unknown errors alone', () => {
    const raw = Object.assign(new Error('something else'), { code: 'XX000' });
    expect(explainPostgresError(raw, url)).toBe(raw);
  });
});

describe('explainMongoError', () => {
  it('names the user on an auth failure', () => {
    const raw = Object.assign(new Error('Authentication failed.'), {
      code: 18,
      codeName: 'AuthenticationFailed',
    });
    const e = explainMongoError(raw, 'mongodb://app:secret@cluster0.example.net/shop');
    expect(e.message).toMatch(/rejected the login for user "app" at cluster0\.example\.net/);
    expect(e.message).not.toContain('secret');
  });

  it('points at Network Access when the server is unreachable', () => {
    const raw = Object.assign(new Error('connect ECONNREFUSED'), {
      name: 'MongooseServerSelectionError',
    });
    expect(explainMongoError(raw, 'mongodb://127.0.0.1:1/x').message).toMatch(
      /Could not reach MongoDB at 127\.0\.0\.1:1/,
    );
  });
});

describe('connectPostgres errors (real server)', () => {
  let ok = false;
  beforeAll(async () => {
    ok = await reachablePg(PG_URL);
  });
  const withPath = (path: string) => PG_URL.replace(/\/[^/?]*(\?|$)/, `/${path}$1`);

  it('a missing database says how to create it', async (ctx) => {
    if (!ok) ctx.skip();
    await expect(connectPostgres(withPath('efc_no_such_db'))).rejects.toThrow(
      /\[EFC\] Database "efc_no_such_db" does not exist .*createdb efc_no_such_db/,
    );
  });

  it('a missing role says so', async (ctx) => {
    if (!ok) ctx.skip();
    const u = new URL(PG_URL);
    u.username = 'efc_no_such_role';
    await expect(connectPostgres(u.toString())).rejects.toThrow(
      /\[EFC\] PostgreSQL has no user "efc_no_such_role"/,
    );
  });

  it('a closed port asks whether PostgreSQL is running', async () => {
    await expect(connectPostgres('postgres://postgres@127.0.0.1:1/x')).rejects.toThrow(
      /\[EFC\] Nothing is accepting connections at 127\.0\.0\.1:1/,
    );
  });
});
