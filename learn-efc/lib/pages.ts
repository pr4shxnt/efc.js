// URL, label and description for every non-chapter page. Shared by the client navigation
// and by server-only files (sitemap, metadata), so it must not import client components.
export const TOOL_PAGES = [
  {
    id: 'router' as const,
    href: '/routes',
    label: 'Routes',
    title: 'Route simulator',
    description: 'Add files to src/api and watch requests match, miss, or 405.',
  },
  {
    id: 'database' as const,
    href: '/database',
    label: 'Database',
    title: 'Database playground',
    description: 'Compare defineTable and defineCollection queries with their SQL.',
  },
  {
    id: 'tasks' as const,
    href: '/tasks',
    label: 'Tasks',
    title: 'Tasks and workers',
    description: 'Enqueue jobs, watch retries, and replay dead letters.',
  },
  {
    id: 'guard' as const,
    href: '/guard',
    label: 'API guard',
    title: 'API guard',
    description: 'Paste a snippet and catch imports and options EFC does not have.',
  },
  {
    id: 'cheatsheet' as const,
    href: '/reference',
    label: 'Reference',
    title: 'API reference',
    description: 'Every common export across the four import paths.',
  },
  {
    id: 'glossary' as const,
    href: '/glossary',
    label: 'Glossary',
    title: 'Glossary',
    description: 'Every term from the handbook in plain words.',
  },
];
export type ToolPageId = (typeof TOOL_PAGES)[number]['id'];
export const toolPage = (id: ToolPageId) => TOOL_PAGES.find((p) => p.id === id)!;
