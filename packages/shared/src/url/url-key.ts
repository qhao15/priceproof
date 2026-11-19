/**
 * Builds the key used to recognize the same store page across URL variants (SPEC §18.1).
 *
 * Lowercase the host and drop a leading "www."; keep the port only when it is not the scheme's
 * default; drop the query and fragment; collapse repeated slashes; drop a trailing slash; keep the
 * path's case. Output: `host[:port]path`.
 *
 * @throws TypeError when the input is not an absolute http(s) URL.
 */
export function urlKey(input: string): string {
  const url = parseHttpUrl(input);
  if (!url) {
    throw new TypeError(`Not an absolute http(s) URL: ${input}`);
  }
  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) {
    host = host.slice(4);
  }
  // The WHATWG URL parser already empties `port` when it is the scheme's default.
  const port = url.port ? `:${url.port}` : '';
  let path = url.pathname.replace(/\/{2,}/g, '/');
  if (path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return `${host}${port}${path}`;
}

/** Parses an absolute http(s) URL, or returns null. */
export function parseHttpUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}
