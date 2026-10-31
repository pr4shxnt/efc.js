import { TOOL_PAGES } from './pages';
import { absoluteUrl, SITE } from './site';
import { TRACKS, TUTORIALS } from './tutorials';

const header = `# learn.efc

> ${SITE.description}

Covers express-file-cluster (EFC) 0.12.0 and Express 5. EFC reference documentation lives at https://efc.prashantadhikari7.com.np/docs.html and in ${SITE.github}/tree/main/docs.
`;

export function llmsIndex() {
  const parts = TRACKS.map(
    (track) =>
      `## ${track}\n\n` +
      TUTORIALS.filter((t) => t.track === track)
        .map((t) => `- [${t.title}](${absoluteUrl(`/learn/${t.id}`)}): ${t.summary}`)
        .join('\n'),
  );
  const tools =
    '## Practice tools\n\n' +
    TOOL_PAGES.map((p) => `- [${p.title}](${absoluteUrl(p.href)}): ${p.description}`).join('\n');
  return (
    [
      header,
      ...parts,
      tools,
      `## Optional\n\n- [Full text of every chapter](${absoluteUrl('/llms-full.txt')})`,
    ].join('\n\n') + '\n'
  );
}

export function llmsFull() {
  const chapters = TUTORIALS.map((t, i) => {
    const sections = t.sections
      .map((s) =>
        [
          `### ${s.title}`,
          ...s.body,
          s.code ? '```\n' + s.code + '\n```' : '',
          s.note ? `Note: ${s.note}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      )
      .join('\n\n');
    const comparison = t.comparison
      ? `### Express and EFC, side by side\n\n${t.comparison.explanation}\n\nExpress:\n\n\`\`\`\n${t.comparison.express}\n\`\`\`\n\nEFC:\n\n\`\`\`\n${t.comparison.efc}\n\`\`\`\n\nWhat stays the same: ${t.comparison.same}`
      : '';
    const exercise = t.exercise
      ? `### Try it yourself\n\n${t.exercise.goal}\n\n${t.exercise.steps.map((s, n) => `${n + 1}. ${s}`).join('\n')}\n\nExpected: ${t.exercise.expected}`
      : '';
    return [
      `## ${i + 1}. ${t.title}`,
      `URL: ${absoluteUrl(`/learn/${t.id}`)}`,
      t.summary,
      `Takeaway: ${t.takeaway}`,
      sections,
      comparison,
      exercise,
    ]
      .filter(Boolean)
      .join('\n\n');
  });
  return [header, ...chapters].join('\n\n') + '\n';
}
