// Data-layer benchmarks: the same operations against the same tables / collections and data,
// run one at a time (so pool sizes don't matter), after a warmup, timing each call.
//
//   npm run bench                         # PostgreSQL and MongoDB
//   npm run bench -- --engine pg          # one engine
//   npm run bench -- --iterations 5000
//   npm run bench -- --json results.json  # save the numbers
//   npm run bench -- --compare results/baseline.json   # exit 1 if EFC fell behind (ratio to the fastest, +25%)
//
// PostgreSQL: EFC defineTable vs Prisma 7 (pg adapter) vs Drizzle. MongoDB: EFC
// defineCollection vs mongoose. EFC runs through ignite(), as an app would.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ENGINE = arg('engine', 'all')!;
const N = Number(arg('iterations', '2000'));
const WARMUP = Number(arg('warmup', '200'));
/** Rounds per operation: contenders alternate within each round; the median round counts. */
const ROUNDS = Number(arg('rounds', '7'));
const PG_URL = process.env['BENCH_PG_URL'] ?? 'postgres://postgres@127.0.0.1:5433/efc_bench';
const MONGO_URL = process.env['BENCH_MONGO_URL'] ?? 'mongodb://127.0.0.1:27017/efc_bench';
const USERS = 200;
const POSTS_PER_USER = 10;

type Stats = { meanMs: number; p50Ms: number; p99Ms: number; opsPerSec: number };
type Results = Record<string, Record<string, Record<string, Stats>>>; // engine → op → contender

/** One round: `n` timed calls after `warmup` untimed ones. */
async function round(fn: (i: number) => Promise<unknown>, n: number, warmup: number, offset: number) {
  for (let i = 0; i < warmup; i++) await fn(offset + i);
  const times = new Float64Array(n);
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn(offset + warmup + i);
    times[i] = performance.now() - t;
  }
  return { mean: (performance.now() - start) / n, times };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function stats(rounds: { mean: number; times: Float64Array }[]): Stats {
  const all = rounds.flatMap((r) => [...r.times]).sort((a, b) => a - b);
  const meanMs = median(rounds.map((r) => r.mean));
  return {
    meanMs,
    p50Ms: all[Math.floor(all.length * 0.5)]!,
    p99Ms: all[Math.floor(all.length * 0.99)]!,
    opsPerSec: 1000 / meanMs,
  };
}

/** Deterministic seed data, shared by every contender of an engine. */
function seedData() {
  const users = Array.from({ length: USERS }, (_, i) => ({
    id: crypto.randomUUID(),
    email: `user${i}@bench.dev`,
    name: `user${i}`,
  }));
  const posts = users.flatMap((u, i) =>
    Array.from({ length: POSTS_PER_USER }, (_, j) => ({
      id: crypto.randomUUID(),
      title: `post ${i}-${j}`,
      views: j,
      authorId: u.id,
    })),
  );
  return { users, posts };
}

interface Contender {
  name: string;
  ops: Record<string, (i: number) => Promise<unknown>>;
  close(): Promise<void>;
}

// ── PostgreSQL ───────────────────────────────────────────────────────────────

async function postgres(): Promise<Record<string, Record<string, Stats>>> {
  const { default: pg } = await import('pg');
  const admin = new pg.Pool({ connectionString: PG_URL, max: 2 });
  const { users, posts } = seedData();
  const pick = (i: number) => users[(i * 7919) % USERS]!;
  const pickPost = (i: number) => posts[(i * 104729) % posts.length]!;
  let created = 0;
  const fresh = (tag: string) => `${tag}-${process.pid}-${created++}@bench.dev`;

  // Same shape for everyone: <prefix>_users / <prefix>_posts.
  const reset = async (prefix: string, create: boolean) => {
    await admin.query(`DROP TABLE IF EXISTS ${prefix}_posts, ${prefix}_users CASCADE`);
    if (create) {
      await admin.query(`CREATE TABLE ${prefix}_users (
        id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now())`);
      await admin.query(`CREATE TABLE ${prefix}_posts (
        id uuid PRIMARY KEY, title text NOT NULL, views integer NOT NULL DEFAULT 0,
        "authorId" uuid NOT NULL REFERENCES ${prefix}_users(id) ON DELETE CASCADE)`);
      await admin.query(`CREATE INDEX ON ${prefix}_posts ("authorId")`);
    }
  };
  const seed = async (prefix: string, authorCol: string) => {
    await admin.query(
      `INSERT INTO ${prefix}_users (id, email, name) SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[])`,
      [users.map((u) => u.id), users.map((u) => u.email), users.map((u) => u.name)],
    );
    await admin.query(
      `INSERT INTO ${prefix}_posts (id, title, views, "${authorCol}") SELECT * FROM unnest($1::uuid[], $2::text[], $3::int[], $4::uuid[])`,
      [posts.map((p) => p.id), posts.map((p) => p.title), posts.map((p) => p.views), posts.map((p) => p.authorId)],
    );
  };

  const contenders: Contender[] = [];

  // EFC — defineTable, booted through ignite().
  {
    await reset('efc', false);
    const efc = await import('express-file-cluster');
    const User = efc.defineTable(
      'BenchUser',
      {
        email: { type: 'string', required: true, unique: true },
        name: { type: 'string', required: true },
      },
      {
        collection: 'efc_users',
        timestamps: { createdAt: 'createdAt', updatedAt: false },
        relations: { posts: { hasMany: 'BenchPost', foreignKey: 'authorId' } },
      },
    );
    const Post = efc.defineTable(
      'BenchPost',
      {
        title: { type: 'string', required: true },
        views: { type: 'integer', required: true, default: 0 },
        authorId: { type: 'uuid', ref: 'BenchUser', required: true, onDelete: 'cascade' },
      },
      { collection: 'efc_posts', timestamps: false },
    );
    const server = await efc.ignite({
      databaseUrl: PG_URL,
      cluster: false,
      port: 0,
      logging: { level: 'warn' },
    });
    await User.sync();
    await Post.sync();
    await seed('efc', 'authorId');
    contenders.push({
      name: 'EFC',
      ops: {
        findUnique: (i) => User.findUnique({ where: { id: pick(i).id } }),
        findMany: () =>
          User.findMany({ where: { name: { startsWith: 'user1' } }, orderBy: { email: 'asc' }, take: 20 }),
        include: (i) => User.findUnique({ where: { id: pick(i).id }, include: { posts: true } }),
        create: () => User.create({ data: { email: fresh('efc'), name: 'new' } }),
        update: (i) => Post.update({ where: { id: pickPost(i).id }, data: { views: { increment: 1 } } }),
        count: () => Post.count({ where: { views: { gt: 4 } } }),
      },
      close: async () => {
        await new Promise((r) => (server as unknown as { close(cb: () => void): void }).close(() => r(null)));
      },
    });
  }

  // Prisma 7 with the node-postgres adapter.
  {
    await reset('prisma', true);
    await seed('prisma', 'authorId');
    const { PrismaClient } = await import('./prisma/generated/client.ts');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: PG_URL }) });
    contenders.push({
      name: 'Prisma',
      ops: {
        findUnique: (i) => prisma.user.findUnique({ where: { id: pick(i).id } }),
        findMany: () =>
          prisma.user.findMany({ where: { name: { startsWith: 'user1' } }, orderBy: { email: 'asc' }, take: 20 }),
        include: (i) => prisma.user.findUnique({ where: { id: pick(i).id }, include: { posts: true } }),
        create: () => prisma.user.create({ data: { id: crypto.randomUUID(), email: fresh('prisma'), name: 'new' } }),
        update: (i) => prisma.post.update({ where: { id: pickPost(i).id }, data: { views: { increment: 1 } } }),
        count: () => prisma.post.count({ where: { views: { gt: 4 } } }),
      },
      close: () => prisma.$disconnect(),
    });
  }

  // Drizzle (node-postgres) with its relational query API.
  {
    await reset('drizzle', true);
    await seed('drizzle', 'authorId');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { pgTable, uuid, text, integer, timestamp } = await import('drizzle-orm/pg-core');
    const { relations, eq, gt, like, asc, sql, count } = await import('drizzle-orm');
    const users_ = pgTable('drizzle_users', {
      id: uuid('id').primaryKey(),
      email: text('email').notNull().unique(),
      name: text('name').notNull(),
      createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    });
    const posts_ = pgTable('drizzle_posts', {
      id: uuid('id').primaryKey(),
      title: text('title').notNull(),
      views: integer('views').notNull().default(0),
      authorId: uuid('authorId').notNull(),
    });
    const usersRelations = relations(users_, ({ many }) => ({ posts: many(posts_) }));
    const postsRelations = relations(posts_, ({ one }) => ({
      author: one(users_, { fields: [posts_.authorId], references: [users_.id] }),
    }));
    const pool = new pg.Pool({ connectionString: PG_URL });
    const db = drizzle(pool, { schema: { users: users_, posts: posts_, usersRelations, postsRelations } });
    contenders.push({
      name: 'Drizzle',
      ops: {
        findUnique: (i) => db.query.users.findFirst({ where: eq(users_.id, pick(i).id) }),
        findMany: () =>
          db.select().from(users_).where(like(users_.name, 'user1%')).orderBy(asc(users_.email)).limit(20),
        include: (i) => db.query.users.findFirst({ where: eq(users_.id, pick(i).id), with: { posts: true } }),
        create: () =>
          db.insert(users_).values({ id: crypto.randomUUID(), email: fresh('drizzle'), name: 'new' }).returning(),
        update: (i) =>
          db
            .update(posts_)
            .set({ views: sql`${posts_.views} + 1` })
            .where(eq(posts_.id, pickPost(i).id))
            .returning(),
        count: () => db.select({ n: count() }).from(posts_).where(gt(posts_.views, 4)),
      },
      close: () => pool.end(),
    });
  }

  const results = await runAll(contenders);
  for (const c of contenders) await c.close();
  for (const p of ['efc', 'prisma', 'drizzle']) await reset(p, false);
  await admin.end();
  return results;
}

// ── MongoDB ──────────────────────────────────────────────────────────────────

async function mongo(): Promise<Record<string, Record<string, Stats>>> {
  const mongooseMod = await import('mongoose');
  const mongoose = mongooseMod.default;
  const { users, posts } = seedData();
  const contenders: Contender[] = [];
  let created = 0;
  const fresh = (tag: string) => `${tag}-${process.pid}-${created++}@bench.dev`;

  // Shared data with ObjectIds, written raw so both contenders start identical.
  const oid = () => new mongoose.Types.ObjectId();
  const uIds = users.map(() => oid());
  const pIds = posts.map(() => oid());
  const userDocs = users.map((u, i) => ({ _id: uIds[i], email: u.email, name: u.name, createdAt: new Date(), updatedAt: new Date() }));
  const postDocs = posts.map((p, i) => ({
    _id: pIds[i],
    title: p.title,
    views: p.views,
    author: uIds[users.findIndex((u) => u.id === p.authorId)],
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const pick = (i: number) => String(uIds[(i * 7919) % USERS]);
  const pickPost = (i: number) => String(pIds[(i * 104729) % pIds.length]);

  // EFC — defineCollection, booted through ignite().
  {
    const efc = await import('express-file-cluster');
    const User = efc.defineCollection(
      'BenchMUser',
      { email: { type: 'string', required: true, unique: true }, name: { type: 'string', required: true } },
      { collection: 'efc_users' },
    );
    const Post = efc.defineCollection(
      'BenchMPost',
      {
        title: { type: 'string', required: true },
        views: { type: 'number', required: true, default: 0 },
        author: { type: 'objectId', ref: 'BenchMUser', required: true, index: true },
      },
      { collection: 'efc_posts' },
    );
    const server = await efc.ignite({ databaseUrl: MONGO_URL, cluster: false, port: 0, logging: { level: 'warn' } });
    // EFC's own mongoose connection (its mongoose may be a different copy from this file's).
    const conn = efc.db as unknown as import('mongoose').Connection;
    await conn.db!.collection('efc_users').deleteMany({});
    await conn.db!.collection('efc_posts').deleteMany({});
    await User.sync();
    await Post.sync();
    await conn.db!.collection('efc_users').insertMany(userDocs);
    await conn.db!.collection('efc_posts').insertMany(postDocs);
    contenders.push({
      name: 'EFC',
      ops: {
        findById: (i) => User.findById(pick(i)),
        find: () => User.find({ name: { $regex: '^user1' } }, { sort: { email: 1 }, limit: 20 }),
        populate: (i) => Post.findById(pickPost(i), { populate: 'author' }),
        create: () => User.create({ email: fresh('efc'), name: 'new' }),
        update: (i) => Post.updateOne({ _id: pickPost(i) }, { $inc: { views: 1 } }),
        count: () => Post.countDocuments({ views: { $gt: 4 } }),
      },
      close: async () => {
        await conn.db!.collection('efc_users').drop();
        await conn.db!.collection('efc_posts').drop();
        await new Promise((r) => (server as unknown as { close(cb: () => void): void }).close(() => r(null)));
        await conn.close();
      },
    });
  }

  // mongoose on its own connection, lean() reads (what EFC returns: plain objects).
  {
    const conn = await mongoose.createConnection(MONGO_URL).asPromise();
    const MUser = conn.model(
      'MUser',
      new mongoose.Schema({ email: { type: String, required: true, unique: true }, name: { type: String, required: true } }, { timestamps: true }),
      'mongoose_users',
    );
    const MPost = conn.model(
      'MPost',
      new mongoose.Schema(
        {
          title: { type: String, required: true },
          views: { type: Number, required: true, default: 0 },
          author: { type: mongoose.Schema.Types.ObjectId, ref: 'MUser', required: true, index: true },
        },
        { timestamps: true },
      ),
      'mongoose_posts',
    );
    await MUser.deleteMany({});
    await MPost.deleteMany({});
    await MUser.syncIndexes();
    await MPost.syncIndexes();
    await conn.db!.collection('mongoose_users').insertMany(userDocs);
    await conn.db!.collection('mongoose_posts').insertMany(postDocs);
    contenders.push({
      name: 'mongoose',
      ops: {
        findById: (i) => MUser.findById(pick(i)).lean(),
        find: () => MUser.find({ name: { $regex: '^user1' } }).sort({ email: 1 }).limit(20).lean(),
        populate: (i) => MPost.findById(pickPost(i)).populate('author').lean(),
        create: () => MUser.create({ email: fresh('mongoose'), name: 'new' }),
        update: (i) => MPost.updateOne({ _id: pickPost(i) }, { $inc: { views: 1 } }),
        count: () => MPost.countDocuments({ views: { $gt: 4 } }),
      },
      close: async () => {
        await conn.db!.collection('mongoose_users').drop();
        await conn.db!.collection('mongoose_posts').drop();
        await conn.close();
      },
    });
  }

  const results = await runAll(contenders);
  // Close mongoose's own connection before EFC's (which disconnects the default one).
  for (const c of [...contenders].reverse()) await c.close();
  return results;
}

// ── Run & report ─────────────────────────────────────────────────────────────

async function runAll(contenders: Contender[]): Promise<Record<string, Record<string, Stats>>> {
  const out: Record<string, Record<string, Stats>> = {};
  const perRound = Math.max(1, Math.round(N / ROUNDS));
  const warmup = Math.max(1, Math.round(WARMUP / ROUNDS));
  for (const op of Object.keys(contenders[0]!.ops)) {
    const rounds = new Map(contenders.map((c) => [c.name, [] as Awaited<ReturnType<typeof round>>[]]));
    // Contenders alternate within every round (in a rotating order), so machine drift and
    // noise land on all of them alike; the median round is reported.
    for (let r = 0; r < ROUNDS; r++) {
      const order = contenders.map((_, k) => contenders[(k + r) % contenders.length]!);
      for (const c of order) {
        rounds.get(c.name)!.push(await round(c.ops[op]!, perRound, warmup, r * (perRound + warmup)));
      }
      process.stderr.write('.');
    }
    out[op] = Object.fromEntries([...rounds].map(([name, rs]) => [name, stats(rs)]));
  }
  process.stderr.write('\n');
  return out;
}

function table(engine: string, res: Record<string, Record<string, Stats>>): string {
  const names = Object.keys(Object.values(res)[0]!);
  const lines = [
    `### ${engine} — mean latency (ms, lower is better; median of ${ROUNDS} rounds)`,
    '',
    `| operation | ${names.join(' | ')} | EFC vs fastest |`,
    `|---|${names.map(() => '---:').join('|')}|---:|`,
  ];
  for (const [op, byName] of Object.entries(res)) {
    const best = Math.min(...Object.values(byName).map((s) => s.meanMs));
    const efc = byName['EFC']!.meanMs;
    const cells = names.map((n) => {
      const s = byName[n]!;
      const v = s.meanMs.toFixed(3);
      return s.meanMs === best ? `**${v}**` : v;
    });
    const rel = efc === best ? 'fastest' : `${(efc / best).toFixed(2)}×`;
    lines.push(`| ${op} | ${cells.join(' | ')} | ${rel} |`);
  }
  return lines.join('\n');
}

const results: Results = {};
if (ENGINE === 'all' || ENGINE === 'pg') results['postgresql'] = await postgres();
if (ENGINE === 'all' || ENGINE === 'mongo') results['mongodb'] = await mongo();

const report = Object.entries(results)
  .map(([engine, res]) => table(engine, res))
  .join('\n\n');
console.log(
  `\nNode ${process.version} · ${new Date().toISOString().slice(0, 10)} · ${N} calls per operation and contender in ${ROUNDS} interleaved rounds (+${WARMUP} warmup), sequential\n\n${report}\n`,
);

const jsonOut = arg('json');
if (jsonOut)
  fs.writeFileSync(jsonOut, JSON.stringify({ node: process.version, n: N, rounds: ROUNDS, results }, null, 2));

// Regression gate. Absolute times move with machine load, so it compares EFC's ratio to the
// fastest contender in the same run against that ratio in the saved run.
const baselineFile = arg('compare');
if (baselineFile) {
  const tolerance = Number(arg('tolerance', '25')) / 100;
  const base = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as { results: Results };
  const ratio = (byName: Record<string, Stats> | undefined) => {
    if (!byName?.['EFC']) return undefined;
    return byName['EFC'].meanMs / Math.min(...Object.values(byName).map((x) => x.meanMs));
  };
  const slower: string[] = [];
  for (const [engine, ops] of Object.entries(results)) {
    for (const [op, byName] of Object.entries(ops)) {
      const before = ratio(base.results[engine]?.[op]);
      const now = ratio(byName);
      if (before && now && now > before * (1 + tolerance)) {
        slower.push(`${engine} ${op}: ${before.toFixed(2)}× → ${now.toFixed(2)}× the fastest`);
      }
    }
  }
  if (slower.length) {
    console.error(
      `EFC fell further behind than in ${baselineFile} (tolerance ${tolerance * 100}%):\n  ${slower.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(`No EFC regression beyond ${tolerance * 100}% against ${baselineFile}.`);
}
process.exit(0);
