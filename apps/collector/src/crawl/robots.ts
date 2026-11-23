import robotsParserModule from 'robots-parser';

// robots-parser is CommonJS: at runtime the default import is the function itself, while its
// typings describe it as `exports.default`.
type RobotsParserFn = typeof robotsParserModule.default;
const robotsParser = robotsParserModule as unknown as RobotsParserFn;

/** robots.txt rules of one store (SPEC §9.9). */
export interface RobotsRules {
  isAllowed(url: string): boolean;
  /** Crawl-delay in seconds for our user agent, or null. */
  crawlDelaySeconds: number | null;
}

export type RobotsResult =
  | { ok: true; rules: RobotsRules; status: number }
  /** 403 / 429 on robots.txt: the store blocks us; pause, never work around it. */
  | { ok: false; blocked: true; status: number; reason: string }
  /** Network error or 5xx: try again later, crawl nothing meanwhile. */
  | { ok: false; blocked: false; status: number | null; reason: string };

export function parseRobots(robotsUrl: string, body: string, userAgent: string): RobotsRules {
  const robot = robotsParser(robotsUrl, body);
  const delay = robot.getCrawlDelay(userAgent);
  return {
    isAllowed: (url) => robot.isAllowed(url, userAgent) !== false,
    crawlDelaySeconds: typeof delay === 'number' && delay > 0 ? delay : null,
  };
}

const ALLOW_ALL: RobotsRules = { isAllowed: () => true, crawlDelaySeconds: null };

/**
 * Fetches and parses `<origin>/robots.txt` with the honest bot user agent. A missing file (404,
 * 410) allows everything.
 */
export async function fetchRobots(
  origin: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RobotsResult> {
  const url = new URL('/robots.txt', origin).toString();
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { 'user-agent': userAgent, accept: 'text/plain' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      ok: false,
      blocked: false,
      status: null,
      reason: `robots.txt fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (res.status === 403 || res.status === 429) {
    return {
      ok: false,
      blocked: true,
      status: res.status,
      reason: `robots.txt answered ${res.status}`,
    };
  }
  if (res.status >= 500) {
    return {
      ok: false,
      blocked: false,
      status: res.status,
      reason: `robots.txt answered ${res.status}`,
    };
  }
  if (res.status >= 400) {
    return { ok: true, rules: ALLOW_ALL, status: res.status };
  }
  return { ok: true, rules: parseRobots(url, await res.text(), userAgent), status: res.status };
}

/** Requests per minute after applying a stricter Crawl-delay. */
export function effectiveRate(requestsPerMinute: number, crawlDelaySeconds: number | null): number {
  if (!crawlDelaySeconds) return requestsPerMinute;
  return Math.max(1, Math.min(requestsPerMinute, Math.floor(60 / crawlDelaySeconds)));
}
