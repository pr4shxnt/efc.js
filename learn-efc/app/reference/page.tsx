import type { Metadata } from 'next';
import { toolPage } from '../../lib/pages';
import { pageMetadata } from '../../lib/site';
import { CheatsheetSection } from '../../components/CheatsheetSection';

const page = toolPage('cheatsheet');
export const metadata: Metadata = pageMetadata({
  title: page.title,
  description: page.description,
  path: page.href,
});

export default function Page() {
  return (
    <div className="tool-page">
      <CheatsheetSection />
    </div>
  );
}
