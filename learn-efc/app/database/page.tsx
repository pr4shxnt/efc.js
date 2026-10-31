import type { Metadata } from 'next';
import { toolPage } from '../../lib/pages';
import { pageMetadata } from '../../lib/site';
import { ModelPlayground } from '../../components/ModelPlayground';

const page = toolPage('database');
export const metadata: Metadata = pageMetadata({
  title: page.title,
  description: page.description,
  path: page.href,
});

export default function Page() {
  return (
    <div className="tool-page">
      <ModelPlayground />
    </div>
  );
}
