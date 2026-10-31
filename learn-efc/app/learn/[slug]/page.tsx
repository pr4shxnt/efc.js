import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Reader } from '../../../components/QuestsSection';
import { TUTORIALS, tutorialIndex } from '../../../lib/tutorials';
import { jsonLd, pageMetadata } from '../../../lib/site';
import { chapterJsonLd } from '../../../lib/structured-data';

// Every chapter is prerendered from generateStaticParams, so navigation can wait for the
// finished page instead of streaming a URL-independent shell first.
export const instant = false;

export function generateStaticParams() {
  return TUTORIALS.map((t) => ({ slug: t.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const chapter = TUTORIALS[tutorialIndex(slug)];
  return chapter
    ? pageMetadata({
        title: chapter.title,
        description: chapter.summary,
        path: `/learn/${chapter.id}`,
        type: 'article',
        section: chapter.track,
      })
    : {};
}

export default async function ChapterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const index = tutorialIndex(slug);
  if (index < 0) notFound();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(chapterJsonLd(TUTORIALS[index], index)) }}
      />
      <Reader index={index} key={slug} />
    </>
  );
}
