import type { OWMGeocodingResult } from "@/types/openweather";

export const DEFAULT_CITIES: OWMGeocodingResult[] = [
  {
    name: "Copenhagen",
    lat: 55.6761,
    lon: 12.5683,
    country: "DK",
    state: "Capital Region of Denmark",
  },
  {
    name: "London",
    lat: 51.5074,
    lon: -0.1276,
    country: "GB",
    state: "England",
  },
  {
    name: "New York",
    lat: 40.7128,
    lon: -74.006,
    country: "US",
    state: "New York",
  },
];
