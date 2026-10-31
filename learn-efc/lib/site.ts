import type { Metadata } from 'next';

export const SITE = {
  url: 'https://learn.expressfilecluster.com',
  name: 'learn.efc',
  title: 'learn.efc — Learn backends, Express & EFC from scratch',
  description:
    'A free, beginner-friendly handbook for backend development. Learn HTTP, Node.js and Express, then build a real API with EFC (express-file-cluster), with exercises and interactive practice.',
  locale: 'en_US',
  themeColor: '#0f0e0c',
  github: 'https://github.com/siggold/express-file-cluster',
  npm: 'https://www.npmjs.com/package/express-file-cluster',
};

export const absoluteUrl = (path = '/') => new URL(path, SITE.url).toString();

/** Serialise JSON-LD for a <script> tag without letting content close the tag. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

/**
 * Full metadata for one page. Next merges metadata shallowly, so a page that sets openGraph
 * must repeat the site-level fields or they disappear.
 */
export function pageMetadata({
  title,
  description,
  path,
  type = 'website',
  section,
}: {
  title: string;
  description: string;
  path: string;
  type?: 'website' | 'article';
  section?: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type,
      siteName: SITE.name,
      locale: SITE.locale,
      url: path,
      title: `${title} · ${SITE.name}`,
      description,
      ...(type === 'article' ? { authors: ['Prashant Adhikari'], section } : {}),
    },
    twitter: { card: 'summary_large_image', title: `${title} · ${SITE.name}`, description },
  };
}
