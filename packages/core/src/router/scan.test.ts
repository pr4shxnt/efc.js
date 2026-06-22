import { describe, it, expect } from 'vitest';
import { filePathToUrlPath } from './scan.js';

describe('filePathToUrlPath', () => {
  it('maps static files to their path', () => {
    expect(filePathToUrlPath('/health.ts')).toBe('/health');
    expect(filePathToUrlPath('/users/profile.ts')).toBe('/users/profile');
  });

  it('maps index files to parent path', () => {
    expect(filePathToUrlPath('/index.ts')).toBe('/');
    expect(filePathToUrlPath('/users/index.ts')).toBe('/users');
  });

  it('maps dynamic segments', () => {
    expect(filePathToUrlPath('/users/[id].ts')).toBe('/users/:id');
    expect(filePathToUrlPath('/posts/[slug]/comments.ts')).toBe('/posts/:slug/comments');
  });

  it('handles nested dynamic', () => {
    expect(filePathToUrlPath('/a/[b]/c/[d].ts')).toBe('/a/:b/c/:d');
  });
});
