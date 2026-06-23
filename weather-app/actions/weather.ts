"use server";

import { SavedCity } from "@/types/city";
import type {
  OpenWeatherAirPollutionResponse,
  OpenWeatherCurrentWeatherResponse,
  OpenWeatherDailyForecast16DaysResponse,
  OpenWeatherDailyForecastListItem,
  OpenWeatherHourlyForecast4DaysResponse,
} from "@/types/openweather";

const BASE_URL = "https://api.openweathermap.org/data/2.5";

function getApiKey() {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) throw new Error("Missing OpenWeather API Key.");
  return key;
}

export async function getCurrentWeather(
  lat: number,
  lon: number,
): Promise<OpenWeatherCurrentWeatherResponse> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    appid: getApiKey(),
    units: "metric",
  });

  const res = await fetch(`${BASE_URL}/weather?${params}`, {
    next: { revalidate: 1800, tags: ["weather"] },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch weather data: ${res.statusText}`);
  }

  return res.json() as Promise<OpenWeatherCurrentWeatherResponse>;
}

// Single source of truth for the 3-hourly /forecast endpoint (free tier:
// 3-hourly, 5 days, max 40 items — the paid /forecast/hourly is not available
// on free keys). Both the hourly card and the daily card derive from this ONE
// call. Fetching with a STABLE URL (fixed param order) lets Next dedupe + cache
// it, so a page rendering both cards makes a single forecast request instead of
// two near-identical ones — halving forecast quota usage.
async function getForecastRaw(
  lat: number,
  lon: number,
): Promise<OpenWeatherHourlyForecast4DaysResponse> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    cnt: "40",
    units: "metric",
    appid: getApiKey(),
  });

  const res = await fetch(`${BASE_URL}/forecast?${params}`, {
    next: { revalidate: 1800, tags: ["forecast"] },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch forecast data: ${res.statusText}`);
  }

  return res.json() as Promise<OpenWeatherHourlyForecast4DaysResponse>;
}

export async function getHourlyForecast4Days(
  lat: number,
  lon: number,
  cnt: number = 40,
): Promise<OpenWeatherHourlyForecast4DaysResponse> {
  const forecast = await getForecastRaw(lat, lon);
  const limit = Math.min(cnt, 40);
  // Same response shape, trimmed to the requested number of 3-hour slots.
  return {
    ...forecast,
    list: forecast.list.slice(0, limit),
    cnt: Math.min(limit, forecast.list.length),
  };
}

export async function getCurrentWeatherBatch(cities: SavedCity[]): Promise<
  Array<{
    city: SavedCity;
    weather: OpenWeatherCurrentWeatherResponse | null;
    error: string | null;
  }>
> {
  const promises = cities.map(async (city) => {
    try {
      const weather = await getCurrentWeather(city.coord.lat, city.coord.lon);
      return { city, weather, error: null };
    } catch (error) {
      return {
        city,
        weather: null,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch weather data.",
      };
    }
  });

  return Promise.all(promises);
}

export async function getAirPollution(
  lat: number,
  lon: number,
): Promise<OpenWeatherAirPollutionResponse> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    appid: getApiKey(),
  });

  const res = await fetch(`${BASE_URL}/air_pollution?${params}`, {
    next: { revalidate: 1800 },
  });

  if (!res.ok) throw new Error("Failed to fetch air pollution data.");

  return res.json();
}

export async function getUVIndex(lat: number, lon: number): Promise<number> {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=uv_index`,
    { next: { revalidate: 1800 } },
  );

  if (!res.ok) throw new Error("Failed to fetch UV index.");
  const data = await res.json();
  return data.current.uv_index;
}

// Free tier does not have /forecast/daily (Pro endpoint).
// We fetch /forecast (3-hourly) and aggregate into daily summaries so all
// existing components receive the same OpenWeatherDailyForecast16DaysResponse
// shape without any changes to the UI layer.
export async function getDailyForecast16Days(
  lat: number,
  lon: number,
  days: number = 10,
): Promise<OpenWeatherDailyForecast16DaysResponse> {
  // Reuse the shared, deduped/cached forecast fetch instead of a 2nd upstream
  // call — this is the same data the hourly card already requested.
  const hourly = await getForecastRaw(lat, lon);

  // Group 3-hour slots by calendar date
  const byDate = new Map<string, typeof hourly.list>();
  for (const item of hourly.list) {
    const date = item.dt_txt.split(" ")[0];
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(item);
  }

  const dailyList: OpenWeatherDailyForecastListItem[] = Array.from(
    byDate.entries(),
  )
    .slice(0, days)
    .map(([, items]) => {
      const temps = items.map((i) => i.main.temp);
      // Pick the slot closest to solar noon for the "daytime" reading
      const daySlot =
        items.find((i) => i.dt_txt.includes("12:00")) ??
        items[Math.floor(items.length / 2)];
      const nightSlot =
        items.find((i) => i.dt_txt.includes("00:00")) ?? items[0];
      const eveSlot =
        items.find((i) => i.dt_txt.includes("18:00")) ??
        items[items.length - 1];
      const mornSlot =
        items.find((i) => i.dt_txt.includes("06:00")) ?? items[0];

      const rainTotal = items.reduce(
        (sum, i) => sum + (i.rain?.["1h"] ?? 0),
        0,
      );
      const snowTotal = items.reduce(
        (sum, i) => sum + (i.snow?.["1h"] ?? 0),
        0,
      );

      return {
        dt: daySlot.dt,
        temp: {
          day: daySlot.main.temp,
          min: Math.min(...temps),
          max: Math.max(...temps),
          night: nightSlot.main.temp,
          eve: eveSlot.main.temp,
          morn: mornSlot.main.temp,
        },
        feels_like: {
          day: daySlot.main.feels_like,
          night: nightSlot.main.feels_like,
          eve: eveSlot.main.feels_like,
          morn: mornSlot.main.feels_like,
        },
        pressure: daySlot.main.pressure,
        humidity: daySlot.main.humidity,
        weather: daySlot.weather,
        speed: daySlot.wind?.speed ?? 0,
        deg: daySlot.wind?.deg ?? 0,
        gust: daySlot.wind?.gust,
        clouds: daySlot.clouds?.all ?? 0,
        rain: rainTotal > 0 ? rainTotal : undefined,
        snow: snowTotal > 0 ? snowTotal : undefined,
        pop: Math.max(...items.map((i) => i.pop)),
      };
    });

  return {
    cod: hourly.cod,
    message: hourly.message,
    cnt: dailyList.length,
    list: dailyList,
    city: {
      id: hourly.city.id,
      name: hourly.city.name,
      coord: hourly.city.coord,
      country: hourly.city.country,
      population: hourly.city.population,
      timezone: hourly.city.timezone,
    },
  };
}
