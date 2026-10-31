import { TRACKS, TUTORIALS, type Tutorial } from './tutorials';
import { absoluteUrl, SITE } from './site';

const author = { '@type': 'Person', name: 'Prashant Adhikari' };
const totalMinutes = TUTORIALS.reduce((sum, t) => sum + (parseInt(t.duration, 10) || 0), 0);
const courseId = absoluteUrl('/#course');

export function homeJsonLd() {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': absoluteUrl('/#website'),
      name: SITE.name,
      url: SITE.url,
      description: SITE.description,
      inLanguage: 'en',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Course',
      '@id': courseId,
      name: 'The backend handbook: HTTP, Node.js, Express and EFC',
      description: SITE.description,
      url: SITE.url,
      inLanguage: 'en',
      isAccessibleForFree: true,
      educationalLevel: 'Beginner',
      teaches: [
        'HTTP requests and responses',
        'Node.js servers',
        'Express routing and middleware',
        'Environment variables',
        'File-based routing with express-file-cluster',
        'Request validation',
        'PostgreSQL models',
        'Background tasks',
        'API testing',
        'Backend security basics',
        'Deployment',
      ],
      provider: { ...author, url: SITE.github },
      offers: { '@type': 'Offer', category: 'Free', price: 0, priceCurrency: 'USD' },
      hasCourseInstance: {
        '@type': 'CourseInstance',
        courseMode: 'Online',
        courseWorkload: `PT${Math.round(totalMinutes / 60)}H`,
      },
      syllabusSections: TRACKS.map((track) => ({
        '@type': 'Syllabus',
        name: track,
        description: TUTORIALS.filter((t) => t.track === track)
          .map((t) => t.title)
          .join(', '),
      })),
    },
  ];
}

export function chapterJsonLd(chapter: Tutorial, index: number) {
  const url = absoluteUrl(`/learn/${chapter.id}`);
  return [
    {
      '@context': 'https://schema.org',
      '@type': ['TechArticle', 'LearningResource'],
      headline: chapter.title,
      description: chapter.summary,
      url,
      image: absoluteUrl(`/learn/${chapter.id}/opengraph-image`),
      inLanguage: 'en',
      author,
      educationalLevel: chapter.difficulty,
      learningResourceType: 'Tutorial',
      timeRequired: `PT${parseInt(chapter.duration, 10) || 10}M`,
      position: index + 1,
      isAccessibleForFree: true,
      isPartOf: { '@type': 'Course', '@id': courseId, name: 'The backend handbook' },
      ...(chapter.terms?.length ? { keywords: chapter.terms.map((t) => t.term).join(', ') } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Handbook', item: SITE.url },
        {
          '@type': 'ListItem',
          position: 2,
          name: chapter.track,
          item: absoluteUrl('/#curriculum'),
        },
        { '@type': 'ListItem', position: 3, name: chapter.title, item: url },
      ],
    },
  ];
}
