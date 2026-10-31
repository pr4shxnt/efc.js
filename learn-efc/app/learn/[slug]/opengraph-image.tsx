import { OG_SIZE, renderOg } from '../../../lib/og';
import { TRACKS, TUTORIALS, tutorialIndex } from '../../../lib/tutorials';

const PARTS = ['Part one', 'Part two', 'Part three', 'Part four'];

export const alt = 'A chapter of the learn.efc backend handbook';
export const size = OG_SIZE;
export const contentType = 'image/png';

export function generateStaticParams() {
  return TUTORIALS.map((t) => ({ slug: t.id }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const index = Math.max(0, tutorialIndex(slug));
  const chapter = TUTORIALS[index];
  return renderOg({
    kicker: `${PARTS[TRACKS.indexOf(chapter.track)]} · Chapter ${index + 1}`,
    title: chapter.title,
    summary: chapter.summary,
  });
}
