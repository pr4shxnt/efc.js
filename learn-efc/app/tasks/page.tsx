import type { Metadata } from 'next';
import { toolPage } from '../../lib/pages';
import { pageMetadata } from '../../lib/site';
import { TaskSimulator } from '../../components/TaskSimulator';

const page = toolPage('tasks');
export const metadata: Metadata = pageMetadata({
  title: page.title,
  description: page.description,
  path: page.href,
});

export default function Page() {
  return (
    <div className="tool-page">
      <TaskSimulator />
    </div>
  );
}
