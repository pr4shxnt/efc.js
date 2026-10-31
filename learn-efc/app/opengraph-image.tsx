import { OG_SIZE, renderOg } from '../lib/og';

export const alt = 'learn.efc — learn how backends work, from the first request';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderOg({
    kicker: 'The backend handbook',
    title: 'Learn how backends work,',
    accent: 'from the first request.',
    summary: '24 beginner chapters: HTTP, Node.js, Express, then a real API with EFC.',
  });
}
