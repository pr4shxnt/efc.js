import type { ReactNode } from 'react';

// A deliberately small tokenizer: enough to make JS/TS, SQL, JSON and shell examples
// readable without shipping a full grammar. Output is React text nodes only.
const KEYWORDS = new Set(
  (
    'import export from as default const let var function async await return if else for of in ' +
    'new class extends type interface throw try catch finally while switch case break continue ' +
    'typeof instanceof void null undefined true false this declare module ' +
    'select from where join left inner on group by order limit insert into values update set ' +
    'delete returning begin commit and or not null is as distinct having conflict do nothing desc asc filter'
  ).split(' '),
);

const TOKEN =
  /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;

export type Lang = 'code' | 'shell';

export function highlight(source: string, lang: Lang = 'code'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of source.matchAll(TOKEN)) {
    const [text, comment, string, number, call, word] = match;
    const index = match.index ?? 0;
    // `#` starts a comment only in shell snippets; `--` only at the start of a SQL line.
    if (comment?.startsWith('#')) {
      const before = source[index - 1];
      if (lang !== 'shell' || (index > 0 && before !== '\n' && before !== ' ')) continue;
    } else if (comment?.startsWith('--')) {
      const lineStart = source.lastIndexOf('\n', index - 1) + 1;
      if (lang !== 'code' || source.slice(lineStart, index).trim()) continue;
    }
    if (index > last) out.push(source.slice(last, index));
    let cls: string | null = null;
    if (comment) cls = 'tk-comment';
    else if (string) cls = 'tk-string';
    else if (number) cls = 'tk-number';
    else if (call) cls = KEYWORDS.has(call.toLowerCase()) ? 'tk-keyword' : 'tk-fn';
    else if (word) {
      if (KEYWORDS.has(word) || (KEYWORDS.has(word.toLowerCase()) && word === word.toUpperCase()))
        cls = 'tk-keyword';
      else if (/^[A-Z]/.test(word)) cls = 'tk-type';
    }
    out.push(
      cls ? (
        <span className={cls} key={key++}>
          {text}
        </span>
      ) : (
        text
      ),
    );
    last = index + text.length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}
