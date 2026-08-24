// In-memory login rate limiter. Single-process deployment, so a Map is fine.
// 5 failed attempts per IP in 15 minutes locks that IP out for the window.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const failures = new Map<string, { count: number; windowStart: number }>();

function prune(now: number) {
  for (const [ip, entry] of failures) {
    if (now - entry.windowStart > WINDOW_MS) failures.delete(ip);
  }
}

export function clientIp(request: Request): string {
  // Caddy sets X-Forwarded-For; the first entry is the real client.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

export function isLockedOut(ip: string): boolean {
  const now = Date.now();
  prune(now);
  const entry = failures.get(ip);
  return !!entry && entry.count >= MAX_FAILURES;
}

export function recordFailure(ip: string) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    failures.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

export function recordSuccess(ip: string) {
  failures.delete(ip);
}
