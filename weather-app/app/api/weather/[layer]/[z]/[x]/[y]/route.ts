import { OpenWeatherWeatherMapLayer } from "@/types/openweather";
import { NextRequest, NextResponse } from "next/server";
import {
  rateLimit,
  clientIp,
  rateLimitHeaders,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const VALID_LAYERS: Set<string> = new Set<OpenWeatherWeatherMapLayer>([
  "clouds_new",
  "precipitation_new",
  "pressure_new",
  "wind_new",
  "temp_new",
]);

export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ layer: string; z: string; x: string; y: string }> },
) {
  // Rate-limit before any work or upstream call (abuse / quota-exhaustion guard)
  const rl = rateLimit(
    `tile:${clientIp(request)}`,
    RATE_LIMITS.tile.limit,
    RATE_LIMITS.tile.windowMs,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { layer, z, x, y } = await params;

  if (!VALID_LAYERS.has(layer)) {
    return NextResponse.json({ error: "Invalid layer" }, { status: 400 });
  }

  // SECURITY: z/x/y are interpolated into the upstream URL. Without validation,
  // a value like "1?evil=" or an encoded "/" would inject query/path segments
  // into the request sent to OpenWeather (parameter injection). Standard XYZ
  // tile coords are non-negative integers; zoom is capped at the OWM max (0–20).
  const zNum = Number(z);
  const xNum = Number(x);
  const yNum = Number(y);
  const isTileInt = (n: number) => Number.isInteger(n) && n >= 0;
  if (
    !/^\d+$/.test(z) ||
    !/^\d+$/.test(x) ||
    !/^\d+$/.test(y) ||
    !isTileInt(zNum) ||
    !isTileInt(xNum) ||
    !isTileInt(yNum) ||
    zNum > 20
  ) {
    return NextResponse.json(
      { error: "Invalid tile coordinates" },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Weather API key is not set" },
      { status: 500 },
    );
  }

  const tileUrl = `https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${apiKey}`;

  const res = await fetch(tileUrl);

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch weather tile" },
      { status: 500 },
    );
  }

  const buffer = await res.arrayBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=1800, s-maxage=1800",
    },
  });
}
