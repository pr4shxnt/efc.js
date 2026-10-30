import { it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { preparedDriver, invalidatePreparedStatements } from '../../db/prepared-statements.js';

it('bounds names per connection, reuses SQL shapes across values, preserves query config, and invalidates without exceeding the lifetime budget', async () => {
  const queries: unknown[][] = [];
  let releases = 0;
  const client = Object.assign(new EventEmitter(), {
    query: (...args: unknown[]) => {
      queries.push(args);
      return Promise.resolve({ rows: [] });
    },
    release: () => {
      releases++;
    },
  }) as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  const driver = preparedDriver(pool, 2);
  const types = { getTypeParser: () => String };
  const query = { text: 'select $1::int', rowMode: 'array', types };
  await driver.query(query, [1]);
  await driver.query(query, [2]);
  const first = queries[0]![0] as { name: string };
  expect(first.name).toMatch(/^efc_auto_/);
  expect(queries[1]![0]).toMatchObject({ ...query, name: first.name });
  expect(queries[1]![1]).toEqual([2]);
  expect(query).not.toHaveProperty('name');
  invalidatePreparedStatements(pool);
  await driver.query(query, [3]);
  expect((queries[2]![0] as { name: string }).name).not.toBe(first.name);
  await driver.query({ text: 'select $1::text' }, ['new']);
  expect(queries[3]![0]).not.toHaveProperty('name');
  expect(releases).toBe(4);
});

it('wraps checked-out transaction clients and leaves caller names, control statements, multi-statements and native Pool queries alone', async () => {
  const queries: unknown[][] = [];
  const client = Object.assign(new EventEmitter(), {
    query: (...args: unknown[]) => {
      queries.push(args);
      return Promise.resolve({ rows: [] });
    },
    release() {},
  }) as unknown as PoolClient;
  const pool = { connect: async () => client, query: client.query.bind(client) } as unknown as Pool;
  const driver = preparedDriver(pool, 5);
  const tx = await driver.connect();
  await tx.query({ text: 'begin' });
  await tx.query({ text: 'select $1', name: 'custom' }, [1]);
  await tx.query({ text: 'select 1; select 2' });
  await pool.query({ text: 'select $1' }, [2]);
  for (const index of [0, 2, 3]) expect(queries[index]![0]).not.toHaveProperty('name');
  expect(queries[1]![0]).toHaveProperty('name', 'custom');
  await tx.query({ text: 'select $1' }, [3]);
  expect(queries[4]![0]).toHaveProperty('name');
  expect(preparedDriver(pool, 0)).toBe(pool);
  for (const value of [-1, NaN, 1.5, Infinity])
    expect(() => preparedDriver(pool, value)).toThrow('nonnegative safe integer');
});

it('releases the checked-out client when a query rejects', async () => {
  let released = false;
  const pool = {
    connect: async () =>
      Object.assign(new EventEmitter(), {
        query: async () => {
          throw new Error('query failed');
        },
        release: () => {
          released = true;
        },
      }),
  } as unknown as Pool;
  await expect(preparedDriver(pool, 10).query({ text: 'select $1' }, [1])).rejects.toThrow(
    'query failed',
  );
  expect(released).toBe(true);
});

it('owns connection error events during pooled queries and releases the failed client with its error', async () => {
  const error = new Error('socket closed');
  let released: Error | undefined;
  const client = Object.assign(new EventEmitter(), {
    query: () =>
      new Promise((_resolve, reject) =>
        queueMicrotask(() => {
          client.emit('error', error);
          reject(error);
        }),
      ),
    release: (err?: Error) => {
      released = err;
    },
  });
  const pool = { connect: async () => client } as unknown as Pool;
  await expect(preparedDriver(pool, 2).query({ text: 'select 1' })).rejects.toBe(error);
  expect(released).toBe(error);
  expect(client.listenerCount('error')).toBe(0);
});
