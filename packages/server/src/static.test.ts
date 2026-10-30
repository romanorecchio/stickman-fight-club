import { describe, expect, it } from 'vitest';
import { staticCacheControl } from './server.js';

describe('static cache headers', () => {
  it('makes index.html revalidate so a deploy ships the new bundle', () => {
    expect(staticCacheControl('/app/dist', '/app/dist/index.html')).toBe('no-cache');
  });
  it('lets hashed assets cache forever', () => {
    expect(staticCacheControl('/app/dist', '/app/dist/assets/index-abc123.js')).toContain('immutable');
  });
});
