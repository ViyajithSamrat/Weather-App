import type { NextRequest } from "next/server";

/**
 * In-memory fixed-window rate limiter.
 *
 * Why in-memory: the app runs as a SINGLE long-lived Node process on one EC2
 * instance (no ALB, no horizontal scaling yet), so a process-local Map is the
 * correct, zero-dependency fit. When the app moves to multiple instances behind
 * an ALB, swap `store` for a shared backend (Redis/ElastiCache) — the public
 * `rateLimit()` signature stays identical.
 *
 * Goal: stop a single client from looping the public proxy routes
 * (/api/geocode, /api/weather/...) to exhaust the upstream OpenWeather quota
 * (free tier: 60 calls/min) or inflate cost. This is abuse prevention, not
 * global quota accounting.
 */

interface Bucket {
  count: number;
  /** Epoch ms at which this window resets. */
  resetAt: number;
}

const store = new Map<string, Bucket>();

/** Sweep expired buckets at most once per minute to bound memory growth. */
let lastSweep = Date.now();
function maybeSweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of store) {
    if (now >= bucket.resetAt) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
  /** Seconds until the window resets — use for the Retry-After header. */
  retryAfterSec: number;
}

/**
 * Record one hit for `key` and report whether it is within `limit` per
 * `windowMs`. Counting happens on every call (the hit that crosses the limit
 * is itself rejected).
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  maybeSweep(now);

  let bucket = store.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    store.set(key, bucket);
  }

  bucket.count += 1;

  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSec: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * Best-effort client identifier for rate-limit bucketing.
 *
 * Prefers proxy-supplied forwarding headers (set once an ALB/CDN is in front).
 * With the current direct-to-EC2 setup these headers are usually absent, so all
 * traffic shares the "unknown" bucket — the limiter then acts as a global
 * safety cap, which still protects the upstream quota. Once an ALB is added,
 * X-Forwarded-For yields true per-client limiting with no code change here.
 */
export function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/** Standard rate-limit headers for a response. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(result.retryAfterSec);
  }
  return headers;
}

/** Per-route limits (requests per 60s window). Centralised for easy tuning. */
export const RATE_LIMITS = {
  /** Search is debounced client-side; 30/min/client is generous for humans. */
  geocode: { limit: 30, windowMs: 60_000 },
  /** A single map view loads many tiles, so this ceiling is higher. */
  tile: { limit: 120, windowMs: 60_000 },
} as const;

/** Test-only: clear all buckets so unit tests start from a clean slate. */
export function __resetRateLimitStore(): void {
  store.clear();
  lastSweep = Date.now();
}
