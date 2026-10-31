import type { Metadata } from 'next';
import { toolPage } from '../../lib/pages';
import { pageMetadata } from '../../lib/site';
import { Glossary } from '../../components/Glossary';

const page = toolPage('glossary');
export const metadata: Metadata = pageMetadata({
  title: page.title,
  description: page.description,
  path: page.href,
});

export default function Page() {
  return (
    <div className="tool-page">
      <Glossary />
    </div>
  );
}
