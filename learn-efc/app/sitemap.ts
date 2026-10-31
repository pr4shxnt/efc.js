import type { MetadataRoute } from 'next';
import { TOOL_PAGES } from '../lib/pages';
import { TUTORIALS } from '../lib/tutorials';
import { absoluteUrl } from '../lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    { url: absoluteUrl('/'), changeFrequency: 'weekly' as const, priority: 1 },
    ...TUTORIALS.map((t) => ({
      url: absoluteUrl(`/learn/${t.id}`),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    ...TOOL_PAGES.map((n) => ({
      url: absoluteUrl(n.href),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  ];
  return pages;
}
