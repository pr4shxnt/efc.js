import fs from 'node:fs';
import path from 'node:path';
import type { RouteEntry } from '../types.js';

const ROUTE_FILE_RE = /\.(ts|js|mts|mjs|cts|cjs)$/;
const DYNAMIC_SEGMENT_RE = /\[([^\]]+)\]/g;

function filePathToUrlPath(relativePath: string): string {
  let p = relativePath.replace(ROUTE_FILE_RE, '');
  // index files map to parent path
  p = p.replace(/\/index$/, '');
  // [param] → :param
  p = p.replace(DYNAMIC_SEGMENT_RE, ':$1');
  return p === '' ? '/' : p.startsWith('/') ? p : `/${p}`;
}

function extractParams(relativePath: string): string[] {
  const params: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(DYNAMIC_SEGMENT_RE.source, 'g');
  while ((match = re.exec(relativePath)) !== null) {
    if (match[1]) params.push(match[1]);
  }
  return params;
}

export function scanDir(dir: string, base: string = dir): RouteEntry[] {
  if (!fs.existsSync(dir)) return [];

  const entries: RouteEntry[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...scanDir(fullPath, base));
    } else if (ROUTE_FILE_RE.test(item.name)) {
      const relative = '/' + path.relative(base, fullPath).replace(/\\/g, '/');
      entries.push({
        urlPath: filePathToUrlPath(relative),
        filePath: fullPath,
        params: extractParams(relative),
      });
    }
  }

  // Sort: static routes before dynamic ones at each segment level
  return entries.sort((a, b) => {
    const aDynamic = a.urlPath.includes(':') ? 1 : 0;
    const bDynamic = b.urlPath.includes(':') ? 1 : 0;
    return aDynamic - bDynamic || a.urlPath.localeCompare(b.urlPath);
  });
}

export { filePathToUrlPath };
