import type { MetadataRoute } from 'next';
import { SITE } from '../lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'learn.efc — the backend handbook',
    short_name: 'learn.efc',
    description: SITE.description,
    start_url: '/',
    display: 'standalone',
    background_color: SITE.themeColor,
    theme_color: SITE.themeColor,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
