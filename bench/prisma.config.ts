import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.BENCH_PG_URL ?? 'postgres://postgres@127.0.0.1:5433/efc_bench',
  },
});
