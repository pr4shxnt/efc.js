import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { SITE } from './site';

export const OG_SIZE = { width: 1200, height: 630 };

// Cached so the font reads don't count as request-time I/O; the images then prerender at build.
async function loadFonts() {
  'use cache';
  // Strings survive the cache round-trip intact; binary views did not.
  const read = (file: string) => readFile(join(process.cwd(), 'assets/fonts', file), 'base64');
  return Promise.all([
    read('Inter-SemiBold.ttf'),
    read('Inter-Regular.ttf'),
    read('InstrumentSerif-Italic.ttf'),
    read('JetBrainsMono-Medium.ttf'),
  ]);
}

// Plain-colour version of the site's dark palette; the image renderer has no CSS variables.
const C = {
  bg: '#0f0e0c',
  line: '#2a2824',
  text: '#ede8df',
  muted: '#b0a99d',
  faint: '#7f786d',
  accent: '#f0a030',
  accentText: '#f4b357',
};

export async function renderOg({
  kicker,
  title,
  accent,
  summary,
}: {
  kicker: string;
  title: string;
  accent?: string;
  summary?: string;
}) {
  const [semibold, regular, serif, mono] = (await loadFonts()).map(
    (b64) => Uint8Array.from(Buffer.from(b64, 'base64')).buffer,
  );
  const titleSize = accent ? 72 : title.length > 46 ? 64 : title.length > 30 ? 74 : 84;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        background: C.bg,
        color: C.text,
        fontFamily: 'Inter',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <svg width="40" height="36" viewBox="5 6 22 20">
          <rect x="6" y="7" width="20" height="3.4" rx="1.7" fill={C.accent} />
          <rect x="6" y="14.3" width="14" height="3.4" rx="1.7" fill={C.accent} opacity="0.85" />
          <rect x="6" y="21.6" width="20" height="3.4" rx="1.7" fill={C.accent} />
        </svg>
        <div style={{ display: 'flex', fontSize: 32, fontWeight: 600, letterSpacing: -0.5 }}>
          learn<span style={{ color: C.accent }}>.</span>efc
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div
          style={{
            display: 'flex',
            fontFamily: 'Instrument Serif',
            fontSize: 38,
            color: C.accentText,
          }}
        >
          {kicker}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: titleSize,
            fontWeight: 600,
            lineHeight: 1.06,
            letterSpacing: -2.5,
            maxWidth: 1000,
          }}
        >
          <span>{title}</span>
          {accent && (
            <span
              style={{
                fontFamily: 'Instrument Serif',
                fontWeight: 400,
                letterSpacing: -0.5,
                color: C.accentText,
              }}
            >
              {accent}
            </span>
          )}
        </div>
        {summary && (
          <div
            style={{
              display: 'flex',
              fontSize: 28,
              lineHeight: 1.4,
              color: C.muted,
              maxWidth: 960,
            }}
          >
            {summary}
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: 24,
          borderTop: `1px solid ${C.line}`,
          fontFamily: 'JetBrains Mono',
          fontSize: 22,
          color: C.faint,
        }}
      >
        <span>{new URL(SITE.url).host}</span>
        <span>HTTP → Express → EFC</span>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Inter', data: regular, weight: 400, style: 'normal' },
        { name: 'Inter', data: semibold, weight: 600, style: 'normal' },
        { name: 'Instrument Serif', data: serif, weight: 400, style: 'italic' },
        { name: 'JetBrains Mono', data: mono, weight: 500, style: 'normal' },
      ],
    },
  );
}
