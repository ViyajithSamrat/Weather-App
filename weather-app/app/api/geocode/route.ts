import { NextRequest, NextResponse } from "next/server";
import type { OWMGeocodingResult } from "@/types/openweather";
import {
  rateLimit,
  clientIp,
  rateLimitHeaders,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  // Rate-limit before any work or upstream call (abuse / quota-exhaustion guard)
  const rl = rateLimit(
    `geocode:${clientIp(request)}`,
    RATE_LIMITS.geocode.limit,
    RATE_LIMITS.geocode.windowMs,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 3) {
    return NextResponse.json([]);
  }

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Geocoding API key not configured" },
      { status: 500 },
    );
  }

  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=5&appid=${apiKey}`;

  const res = await fetch(url, {
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Geocoding request failed" },
      { status: 502 },
    );
  }

  const data: OWMGeocodingResult[] = await res.json();
  return NextResponse.json(data);
}
