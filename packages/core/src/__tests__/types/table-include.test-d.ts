/* eslint-disable @typescript-eslint/no-unused-vars -- models are only inspected via `typeof` */
// Type-level tests for defineTable `include`. Checked by `tsc` (npm run typecheck); every
// `@ts-expect-error` marks a call that must NOT compile.
import { expectTypeOf } from 'vitest';
import { defineTable } from '../../index.js';
import type { InferTableRecord } from '../../index.js';

const User = defineTable(
  'TUser',
  { email: { type: 'string', required: true, unique: true } },
  {
    relations: {
      posts: { hasMany: 'TPost', foreignKey: 'author' },
      profile: { hasOne: 'TProfile', foreignKey: 'user' },
    },
  },
);
const Profile = defineTable('TProfile', {
  bio: { type: 'string' },
  user: { type: 'uuid', ref: 'TUser', required: true, unique: true },
});
const Post = defineTable(
  'TPost',
  {
    title: { type: 'string', required: true },
    author: { type: 'uuid', ref: 'TUser' },
    editor: { type: 'uuid', ref: 'TUser', required: true },
    tags: { type: 'array', of: 'uuid', ref: 'TTag' },
    stray: { type: 'uuid', ref: 'NotRegistered' },
  },
  { id: 'serial' },
);
const Tag = defineTable('TTag', { label: { type: 'string', required: true } });

declare module '../../index.js' {
  interface Tables {
    TUser: typeof User;
    TProfile: typeof Profile;
    TPost: typeof Post;
    TTag: typeof Tag;
  }
}

type UserRecord = InferTableRecord<typeof User>;
type TagRecord = InferTableRecord<typeof Tag>;
type ProfileRecord = InferTableRecord<typeof Profile>;
type PostRecord = InferTableRecord<typeof Post>;

async function checks() {
  // Own refs: an optional ref may be null, a required one not; many-to-many is a list.
  const post = await Post.findFirstOrThrow({
    include: { author: true, editor: true, tags: true, stray: true },
  });
  expectTypeOf(post.author).toEqualTypeOf<UserRecord | null>();
  expectTypeOf(post.editor).toEqualTypeOf<UserRecord>();
  expectTypeOf(post.tags).toEqualTypeOf<TagRecord[]>();
  expectTypeOf(post.stray).toEqualTypeOf<Record<string, unknown> | null>(); // not registered
  expectTypeOf(post.title).toEqualTypeOf<string>();
  expectTypeOf(post.id).toEqualTypeOf<number>();

  // Without include, refs stay ids.
  const plain = await Post.findFirstOrThrow();
  expectTypeOf(plain.author).toEqualTypeOf<string | undefined>();
  expectTypeOf(plain.tags).toEqualTypeOf<string[] | undefined>();

  // Back-relations, with select / nested include / list options.
  const users = await User.findMany({
    include: {
      profile: true,
      posts: {
        where: { title: { startsWith: 'a' } },
        orderBy: { title: 'asc' },
        take: 3,
        select: { title: true },
        include: { tags: { select: { label: true } } },
      },
    },
  });
  expectTypeOf(users[0]!.profile).toEqualTypeOf<ProfileRecord | null>();
  expectTypeOf(users[0]!.posts).toEqualTypeOf<{ title: string; tags: { label: string }[] }[]>();
  expectTypeOf(users[0]!.email).toEqualTypeOf<string>();

  // select at the top level keeps included relations.
  const picked = await Post.findUnique({
    where: { id: 1 },
    select: { title: true },
    include: { editor: { select: { email: true } } },
  });
  expectTypeOf(picked).toEqualTypeOf<{ title: string; editor: { email: string } } | null>();

  // Writes take include too.
  const created = await Post.create({
    data: { title: 't', editor: 'u' },
    include: { tags: true },
  });
  expectTypeOf(created.tags).toEqualTypeOf<TagRecord[]>();

  // `false` leaves a relation out.
  const none = await Post.findFirstOrThrow({ include: { author: false } });
  expectTypeOf(none).toEqualTypeOf<PostRecord>();

  // @ts-expect-error — not a relation
  await Post.findMany({ include: { title: true } });
  // @ts-expect-error — filters are typed by the target model
  await User.findMany({ include: { posts: { where: { nope: 1 } } } });
  // @ts-expect-error — a to-one include has no list options
  await Post.findMany({ include: { author: { take: 1 } } });
}
