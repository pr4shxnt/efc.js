import type { Metadata } from 'next';
import { toolPage } from '../../lib/pages';
import { pageMetadata } from '../../lib/site';
import { AntiHallucinationGuard } from '../../components/AntiHallucinationGuard';

const page = toolPage('guard');
export const metadata: Metadata = pageMetadata({
  title: page.title,
  description: page.description,
  path: page.href,
});

export default function Page() {
  return (
    <div className="tool-page">
      <AntiHallucinationGuard />
    </div>
  );
}
