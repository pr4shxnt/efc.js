export interface RouteSegmentRank {
  raw: string;
  type: 'static' | 'dynamic' | 'optional' | 'catch-all' | 'optional-catch-all';
  rank: number; // 0: static, 1: [id], 2: [[id]], 3: [...slug], 4: [[...slug]]
  paramName?: string;
}

export interface CompiledRoute {
  filePath: string;
  urlPattern: string;
  segments: RouteSegmentRank[];
  methods: string[];
  code: string;
  description: string;
}

export interface MatchResult {
  matched: boolean;
  route?: CompiledRoute;
  params: Record<string, string | string[]>;
  status: number;
  statusText: string;
  allowHeader?: string;
  explanation: string;
}

export function parseSegments(rawPath: string): RouteSegmentRank[] {
  // Strip relative prefix and extension
  let clean = rawPath.replace(/^src\/api\//, '').replace(/^\/+/, '');
  clean = clean.replace(/\.(ts|js|mts|mjs|cts|cjs)$/, '');
  clean = clean.replace(/\/index$/, '');
  if (clean === 'index' || clean === '') {
    return [{ raw: '', type: 'static', rank: 0 }];
  }

  const parts = clean.split('/').filter(Boolean);
  return parts.map((part) => {
    if (part.startsWith('[[...') && part.endsWith(']]')) {
      return {
        raw: part,
        type: 'optional-catch-all',
        rank: 4,
        paramName: part.slice(5, -2),
      };
    }
    if (part.startsWith('[...') && part.endsWith(']')) {
      return {
        raw: part,
        type: 'catch-all',
        rank: 3,
        paramName: part.slice(4, -1),
      };
    }
    if (part.startsWith('[[') && part.endsWith(']]')) {
      return {
        raw: part,
        type: 'optional',
        rank: 2,
        paramName: part.slice(2, -2),
      };
    }
    if (part.startsWith('[') && part.endsWith(']')) {
      return {
        raw: part,
        type: 'dynamic',
        rank: 1,
        paramName: part.slice(1, -1),
      };
    }
    return {
      raw: part,
      type: 'static',
      rank: 0,
    };
  });
}

export function compileRoute(
  filePath: string,
  methods: string[],
  code: string,
  description: string,
): CompiledRoute {
  const segments = parseSegments(filePath);
  let urlPattern =
    '/' +
    segments
      .map((s) => {
        if (s.type === 'static') return s.raw;
        if (s.type === 'dynamic') return `:${s.paramName}`;
        if (s.type === 'optional') return `:${s.paramName}?`;
        if (s.type === 'catch-all') return `:${s.paramName}*`;
        if (s.type === 'optional-catch-all') return `:${s.paramName}*?`;
        return s.raw;
      })
      .filter(Boolean)
      .join('/');

  if (urlPattern === '') urlPattern = '/';

  return {
    filePath,
    urlPattern,
    segments,
    methods: methods.map((m) => m.toUpperCase()),
    code,
    description,
  };
}

export function sortRoutes(routes: CompiledRoute[]): CompiledRoute[] {
  return [...routes].sort((a, b) => {
    const maxLen = Math.max(a.segments.length, b.segments.length);
    for (let i = 0; i < maxLen; i++) {
      const segA = a.segments[i];
      const segB = b.segments[i];
      if (!segA) return -1;
      if (!segB) return 1;
      if (segA.rank !== segB.rank) {
        return segA.rank - segB.rank;
      }
      if (segA.type === 'static' && segB.type === 'static') {
        const cmp = segA.raw.localeCompare(segB.raw);
        if (cmp !== 0) return cmp;
      }
    }
    return a.urlPattern.localeCompare(b.urlPattern);
  });
}

export function matchRoute(
  routes: CompiledRoute[],
  requestMethod: string,
  requestUrl: string,
): MatchResult {
  const method = requestMethod.toUpperCase();
  // Normalize request url (strip query and trailing slash unless '/')
  const cleanPath = requestUrl.split('?')[0].replace(/\/+$/, '') || '/';
  const reqParts = cleanPath === '/' ? [] : cleanPath.slice(1).split('/');

  const sorted = sortRoutes(routes);

  for (const route of sorted) {
    const params: Record<string, string | string[]> = {};
    let matched = true;
    let reqIndex = 0;

    for (let sIdx = 0; sIdx < route.segments.length; sIdx++) {
      const seg = route.segments[sIdx];

      if (seg.type === 'catch-all') {
        // >= 1 segment remainder
        const remainder = reqParts.slice(reqIndex);
        if (remainder.length === 0) {
          matched = false;
          break;
        }
        params[seg.paramName!] = remainder;
        reqIndex = reqParts.length;
        break;
      } else if (seg.type === 'optional-catch-all') {
        // >= 0 segment remainder
        const remainder = reqParts.slice(reqIndex);
        params[seg.paramName!] = remainder;
        reqIndex = reqParts.length;
        break;
      } else if (seg.type === 'optional') {
        // 0 or 1 segment
        if (reqIndex < reqParts.length) {
          params[seg.paramName!] = reqParts[reqIndex];
          reqIndex++;
        }
      } else if (seg.type === 'dynamic') {
        if (reqIndex >= reqParts.length) {
          matched = false;
          break;
        }
        params[seg.paramName!] = reqParts[reqIndex];
        reqIndex++;
      } else {
        // Static
        if (reqIndex >= reqParts.length || reqParts[reqIndex] !== seg.raw) {
          matched = false;
          break;
        }
        reqIndex++;
      }
    }

    // Must consume all request parts
    if (matched && reqIndex === reqParts.length) {
      if (route.methods.includes(method)) {
        return {
          matched: true,
          route,
          params,
          status: 200,
          statusText: 'OK',
          explanation: `Matched route "${route.filePath}" via pattern "${route.urlPattern}". Method ${method} is exported and handled.`,
        };
      } else {
        const allowHeader = route.methods.join(', ');
        return {
          matched: true,
          route,
          params,
          status: 405,
          statusText: 'Method Not Allowed',
          allowHeader,
          explanation: `Matched route "${route.filePath}", but HTTP method ${method} is not implemented! EFC automatically returns 405 with header "Allow: ${allowHeader}".`,
        };
      }
    }
  }

  return {
    matched: false,
    params: {},
    status: 404,
    statusText: 'Not Found',
    explanation: `No route in src/api matched "${cleanPath}". Express forwards to standard 404 handler.`,
  };
}
