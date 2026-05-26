import { NextRequest, NextResponse } from "next/server";
import type { OWMGeocodingResult } from "@/types/openweather";

export async function GET(request: NextRequest) {
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
