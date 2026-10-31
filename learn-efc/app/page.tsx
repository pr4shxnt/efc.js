import { HeroSection } from '../components/HeroSection';
import { Library } from '../components/QuestsSection';
import { jsonLd } from '../lib/site';
import { homeJsonLd } from '../lib/structured-data';

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(homeJsonLd()) }}
      />
      <HeroSection />
      <Library />
    </>
  );
}
