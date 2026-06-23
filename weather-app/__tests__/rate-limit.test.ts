import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  rateLimit,
  clientIp,
  rateLimitHeaders,
  RATE_LIMITS,
  __resetRateLimitStore,
} from "@/lib/rate-limit";
import type { NextRequest } from "next/server";

/** Build a minimal NextRequest-like object with just the headers we read. */
function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe("rateLimit", () => {
  beforeEach(() => {
    __resetRateLimitStore();
  });

  it("allows requests up to the limit", () => {
    for (let i = 1; i <= 5; i++) {
      const r = rateLimit("k", 5, 60_000);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(5 - i);
    }
  });

  it("blocks the request that exceeds the limit", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 60_000);
    const blocked = rateLimit("k", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("isolates buckets by key", () => {
    rateLimit("a", 1, 60_000);
    const a = rateLimit("a", 1, 60_000);
    const b = rateLimit("b", 1, 60_000);
    expect(a.allowed).toBe(false);
    expect(b.allowed).toBe(true);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    try {
      rateLimit("k", 1, 1_000);
      expect(rateLimit("k", 1, 1_000).allowed).toBe(false);
      vi.advanceTimersByTime(1_001);
      expect(rateLimit("k", 1, 1_000).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry", () => {
    const req = reqWithHeaders({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const req = reqWithHeaders({ "x-real-ip": "5.6.7.8" });
    expect(clientIp(req)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when no forwarding headers are present", () => {
    expect(clientIp(reqWithHeaders({}))).toBe("unknown");
  });
});

describe("rateLimitHeaders", () => {
  afterEach(() => __resetRateLimitStore());

  it("includes Retry-After only when blocked", () => {
    const ok = rateLimit("h", 1, 60_000);
    const okHeaders = rateLimitHeaders(ok);
    expect(okHeaders["X-RateLimit-Limit"]).toBe("1");
    expect(okHeaders["Retry-After"]).toBeUndefined();

    const blocked = rateLimit("h", 1, 60_000);
    const blockedHeaders = rateLimitHeaders(blocked);
    expect(blockedHeaders["Retry-After"]).toBeDefined();
    expect(blockedHeaders["X-RateLimit-Remaining"]).toBe("0");
  });
});

describe("RATE_LIMITS config", () => {
  it("tile ceiling is higher than geocode (many tiles per map view)", () => {
    expect(RATE_LIMITS.tile.limit).toBeGreaterThan(RATE_LIMITS.geocode.limit);
  });
});
