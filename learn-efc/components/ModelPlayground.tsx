'use client';

import React, { useState } from 'react';
import { CodeBlock, PageHeader, Panel, Segmented, ToolIntro } from './ui';

export function ModelPlayground() {
  const [engine, setEngine] = useState<'postgres' | 'mongodb'>('postgres');
  const [selectedPresetIndex, setSelectedPresetIndex] = useState<number>(0);
  const [includePosts, setIncludePosts] = useState<boolean>(true);
  const [limit, setLimit] = useState<number>(5);
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const pgPresets = [
    {
      title: 'findMany with Relations (include)',
      desc: 'Prisma-style single-statement query with foreign key joins.',
      fnName: 'User.findMany',
      getEfcCode: () => `const users = await User.findMany({
  where: ${roleFilter === 'all' ? '{}' : `{ role: '${roleFilter}' }`},
  ${includePosts ? 'include: { posts: true },\n  ' : ''}orderBy: { createdAt: 'desc' },
  take: ${limit}
});`,
      getSql: () => `SELECT u.id, u.email, u.role, u.created_at
${includePosts ? "     , coalesce(json_agg(p.*) FILTER (WHERE p.id IS NOT NULL), '[]') AS posts\n" : ''}FROM users u
${includePosts ? 'LEFT JOIN posts p ON p.author_id = u.id\n' : ''}${roleFilter !== 'all' ? `WHERE u.role = '${roleFilter}'\n` : ''}GROUP BY u.id
ORDER BY u.created_at DESC
LIMIT ${limit};`,
      getData: () => [
        {
          id: 'usr_89f1a',
          email: 'sarah.connor@example.com',
          role: roleFilter === 'all' ? 'admin' : roleFilter,
          createdAt: '2026-10-30T14:20:00Z',
          ...(includePosts
            ? {
                posts: [
                  {
                    id: 'pst_101',
                    title: 'Deploying EFC to Multi-core Linux',
                    authorId: 'usr_89f1a',
                  },
                  {
                    id: 'pst_102',
                    title: 'Why defineTable Beats Heavy ORMs',
                    authorId: 'usr_89f1a',
                  },
                ],
              }
            : {}),
        },
        {
          id: 'usr_42b7c',
          email: 'alex.rivera@example.com',
          role: roleFilter === 'all' ? 'member' : roleFilter,
          createdAt: '2026-10-31T09:12:00Z',
          ...(includePosts
            ? {
                posts: [
                  { id: 'pst_103', title: 'Setting up BullMQ with Redis', authorId: 'usr_42b7c' },
                ],
              }
            : {}),
        },
      ],
    },
    {
      title: 'Nested Write (connectOrCreate)',
      desc: 'Creates a post and connects/creates the user in a single atomic transaction.',
      fnName: 'Post.create',
      getEfcCode: () => `const newPost = await Post.create({
  data: {
    title: 'Zero Hallucination Backend in Node.js',
    content: 'Full walkthrough of express-file-cluster features.',
    author: {
      connectOrCreate: {
        where: { email: 'dev@example.com' },
        create: { email: 'dev@example.com', role: 'author' }
      }
    }
  }
});`,
      getSql: () => `BEGIN;
INSERT INTO users (id, email, role)
VALUES (gen_random_uuid(), 'dev@example.com', 'author')
ON CONFLICT (email) DO NOTHING;

INSERT INTO posts (id, title, content, author_id)
VALUES (gen_random_uuid(), 'Zero Hallucination Backend...', '...',
       (SELECT id FROM users WHERE email = 'dev@example.com'))
RETURNING *;
COMMIT;`,
      getData: () => ({
        id: 'pst_999a',
        title: 'Zero Hallucination Backend in Node.js',
        content: 'Full walkthrough of express-file-cluster features.',
        authorId: 'usr_dev44',
        createdAt: new Date().toISOString(),
      }),
    },
    {
      title: 'Aggregation & GroupBy',
      desc: 'Group by role and calculate counts and stats without writing raw SQL.',
      fnName: 'User.groupBy',
      getEfcCode: () => `const stats = await User.groupBy({
  by: ['role'],
  _count: { _all: true },
  having: {
    role: { not: 'guest' }
  }
});`,
      getSql: () => `SELECT role, COUNT(*) AS _count_all
FROM users
WHERE role <> 'guest'
GROUP BY role;`,
      getData: () => [
        { role: 'admin', _count: { _all: 4 } },
        { role: 'member', _count: { _all: 32 } },
        { role: 'author', _count: { _all: 12 } },
      ],
    },
  ];

  const mongoPresets = [
    {
      title: 'defineCollection Aggregation Pipeline',
      desc: 'MongoDB-native collection with BSON types and aggregation stages.',
      fnName: 'Orders.aggregate',
      getEfcCode: () => `const totals = await Orders.aggregate([
  { $match: { status: 'completed' } },
  { $group: { _id: '$userId', totalSpent: { $sum: '$amount' } } },
  { $sort: { totalSpent: -1 } },
  { $limit: ${limit} }
]);`,
      getSql: () => `// MongoDB Aggregation Pipeline:
db.orders.aggregate([
  { "$match": { "status": "completed" } },
  { "$group": { "_id": "$userId", "totalSpent": { "$sum": "$amount" } } },
  { "$sort": { "totalSpent": -1 } },
  { "$limit": ${limit} }
]);`,
      getData: () => [
        { _id: '6723a1ef90c8831', totalSpent: 1420.5 },
        { _id: '6723a1ef90c8832', totalSpent: 980.0 },
        { _id: '6723a1ef90c8833', totalSpent: 450.25 },
      ],
    },
  ];

  const presets = engine === 'postgres' ? pgPresets : mongoPresets;
  const activePreset = presets[selectedPresetIndex] || presets[0];

  const schema =
    engine === 'postgres'
      ? `import { defineTable } from 'express-file-cluster';

export const User = defineTable('User', {
  email: { type: 'string', unique: true, maxLength: 255 },
  role: { type: 'string', default: 'member' }
}, {
  relations: {
    posts: { hasMany: 'Post', foreignKey: 'authorId' }
  }
});

export const Post = defineTable('Post', {
  title: { type: 'string' },
  authorId: { type: 'uuid', ref: 'User', onDelete: 'cascade' }
});`
      : `import { defineCollection } from 'express-file-cluster';

export const Orders = defineCollection('Orders', {
  userId: { type: 'objectId', required: true, index: true },
  amount: { type: 'decimal128', required: true },
  status: { type: 'string', enum: ['pending', 'completed'] },
  location: { type: 'geoPoint', index: '2dsphere' }
});`;

  return (
    <>
      <PageHeader
        title="Database playground"
        actions={
          <Segmented
            label="Database engine"
            value={engine}
            onChange={(next) => {
              setEngine(next);
              setSelectedPresetIndex(0);
            }}
            options={[
              { value: 'postgres', label: 'PostgreSQL · defineTable' },
              { value: 'mongodb', label: 'MongoDB · defineCollection' },
            ]}
          />
        }
      >
        Each engine gets its own native API. Pick a query to see the model code, the statement EFC
        sends to the database, and the shape of what comes back.
      </PageHeader>

      <ToolIntro
        chapterIds={['database-basics', 'quest-3']}
        steps={[
          <>Pick an engine at the top right. Most beginners start with PostgreSQL.</>,
          <>Pick a query from the buttons below. The left side shows the model definition.</>,
          <>
            On the right, read top to bottom: the code you write, what EFC sends to the database,
            and the data you get back.
          </>,
          <>For the first PostgreSQL query, change the options and watch all three update.</>,
        ]}
      >
        A model is a JavaScript object for one table. You call methods like findMany and EFC turns
        them into database queries for you. Nothing here touches a real database.
      </ToolIntro>

      <div className="presets">
        {presets.map((p, idx) => (
          <button
            key={p.title}
            className={`preset ${selectedPresetIndex === idx ? 'active' : ''}`}
            aria-pressed={selectedPresetIndex === idx}
            onClick={() => setSelectedPresetIndex(idx)}
          >
            {p.title}
          </button>
        ))}
      </div>

      <div className="tool-grid">
        <div className="stack">
          <Panel flush>
            <CodeBlock
              code={schema}
              label={`src/models/${engine === 'postgres' ? 'User.ts' : 'Orders.ts'}`}
            />
          </Panel>

          {engine === 'postgres' && selectedPresetIndex === 0 && (
            <Panel title="Query options">
              <div className="options-list">
                <div className="option-row">
                  <span id="opt-include">Include posts (one joined statement)</span>
                  <button
                    className="switch"
                    role="switch"
                    aria-checked={includePosts}
                    aria-labelledby="opt-include"
                    onClick={() => setIncludePosts(!includePosts)}
                  />
                </div>
                <label className="option-row">
                  <span>Role</span>
                  <select
                    className="select"
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  >
                    <option value="all">Any role</option>
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                  </select>
                </label>
                <label className="option-row">
                  <span>
                    take: <code>{limit}</code>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  />
                </label>
              </div>
            </Panel>
          )}

          <div className="note note-warn">
            <strong>Don&apos;t mix the vocabularies</strong>
            {engine === 'postgres' ? (
              <>
                <code>defineTable</code> speaks Prisma: <code>findMany</code>,{' '}
                <code>findUnique</code>, <code>groupBy</code>. There is no <s>User.find()</s> or{' '}
                <s>User.findById()</s>; those belong to MongoDB.
              </>
            ) : (
              <>
                <code>defineCollection</code> speaks mongoose: <code>find</code>,{' '}
                <code>aggregate</code>, <code>watch</code>. There is no <s>Orders.findMany()</s> and
                no <s>include</s>.
              </>
            )}
          </div>
        </div>

        <div className="stack">
          <Panel flush>
            <CodeBlock
              code={activePreset.getEfcCode()}
              label="Your code"
              footer={activePreset.desc}
            />
          </Panel>
          <Panel flush>
            <CodeBlock
              code={activePreset.getSql()}
              label={engine === 'postgres' ? 'What PostgreSQL receives' : 'What MongoDB receives'}
            />
          </Panel>
          <Panel flush>
            <CodeBlock
              code={JSON.stringify(activePreset.getData(), null, 2)}
              label="Result · InferRecord<typeof Model>"
              maxHeight={260}
            />
          </Panel>
        </div>
      </div>
    </>
  );
}
