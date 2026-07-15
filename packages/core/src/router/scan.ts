import fs from 'node:fs';
import path from 'node:path';
import type { RouteEntry } from '../types.js';

const ROUTE_FILE_RE = /\.(ts|js|mts|mjs|cts|cjs)$/;
const DYNAMIC_SEGMENT_RE = /\[([^\]]+)\]/g;

/** Maximum directory depth scanDir will recurse into by default. */
const DEFAULT_MAX_DEPTH = 10;

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

/** Count how many dynamic (`:param`) segments a URL path has. */
function dynamicSegmentCount(urlPath: string): number {
  return (urlPath.match(/:/g) ?? []).length;
}

/**
 * Recursively scans `dir` for route files and returns a sorted list of
 * `RouteEntry` objects. Static routes are always placed before dynamic ones;
 * within the same dynamic-segment count routes are sorted alphabetically.
 *
 * @param dir      - Root directory to scan (must exist).
 * @param base     - Base directory used to derive relative URL paths; defaults to `dir`.
 * @param maxDepth - Maximum recursion depth (default: 10). Guards against
 *                   circular symlinks or unexpectedly deep directory trees.
 * @param _depth   - Internal current depth counter — do not pass externally.
 */
export function scanDir(
  dir: string,
  base: string = dir,
  maxDepth: number = DEFAULT_MAX_DEPTH,
  _depth: number = 0,
): RouteEntry[] {
  if (!fs.existsSync(dir)) return [];
  if (_depth > maxDepth) {
    console.warn(`[EFC] scanDir: max depth (${maxDepth}) reached at ${dir}, skipping subtree`);
    return [];
  }

  const entries: RouteEntry[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...scanDir(fullPath, base, maxDepth, _depth + 1));
    } else if (ROUTE_FILE_RE.test(item.name)) {
      const relative = '/' + path.relative(base, fullPath).replace(/\\/g, '/');
      entries.push({
        urlPath: filePathToUrlPath(relative),
        filePath: fullPath,
        params: extractParams(relative),
      });
    }
  }

  // Sort: fewer dynamic segments first; ties broken alphabetically.
  return entries.sort((a, b) => {
    const diff = dynamicSegmentCount(a.urlPath) - dynamicSegmentCount(b.urlPath);
    return diff !== 0 ? diff : a.urlPath.localeCompare(b.urlPath);
  });
}

export { filePathToUrlPath };
