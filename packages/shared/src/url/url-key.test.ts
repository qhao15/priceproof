import { describe, expect, it } from 'vitest';
import { parseHttpUrl, urlKey } from './url-key.js';

describe('urlKey (beyond the §18 vectors)', () => {
  it('keeps a non-default port', () => {
    expect(urlKey('https://example.vn:8443/p/x')).toBe('example.vn:8443/p/x');
  });

  it('drops the default http port', () => {
    expect(urlKey('http://WWW.example.vn:80/p/x/')).toBe('example.vn/p/x');
  });

  it('only strips a leading "www."', () => {
    expect(urlKey('https://shop.www.example.vn/p')).toBe('shop.www.example.vn/p');
  });

  it.each(['not a url', '/relative/path', 'ftp://example.vn/file', 'javascript:alert(1)'])(
    'throws for %s',
    (input) => {
      expect(() => urlKey(input)).toThrow(TypeError);
    },
  );
});

describe('parseHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(parseHttpUrl(' https://example.vn/p ')?.hostname).toBe('example.vn');
    expect(parseHttpUrl('http://localhost:4000')?.port).toBe('4000');
  });

  it('rejects other schemes and garbage', () => {
    expect(parseHttpUrl('mailto:a@example.vn')).toBeNull();
    expect(parseHttpUrl('')).toBeNull();
  });
});
