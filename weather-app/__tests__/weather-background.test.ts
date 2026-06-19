import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getWeatherBackground } from "@/lib/weather/weather-background";

// Fixed unix timestamps (seconds)
const SUNRISE = 1700031600; // ~06:00 local
const SUNSET = SUNRISE + 43200; // 12 hours later ~18:00
const NOON = SUNRISE + 21600; // 6 hours after sunrise
const NIGHT = SUNSET + 3600; // 1 hour after sunset

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getWeatherBackground — icon fallback (no sunrise/sunset)", () => {
  it("clear day via icon", () => {
    const result = getWeatherBackground(800, "01d");
    expect(result).toContain("sky-300");
  });

  it("clear night via icon", () => {
    const result = getWeatherBackground(800, "01n");
    expect(result).toContain("indigo-900");
  });

  it("thunderstorm day via icon", () => {
    const result = getWeatherBackground(200, "11d");
    expect(result).toContain("slate-600");
  });

  it("thunderstorm night via icon", () => {
    const result = getWeatherBackground(200, "11n");
    expect(result).toContain("slate-800");
  });
});

describe("getWeatherBackground — sunrise/sunset time check", () => {
  it("returns day gradient when time is between sunrise and sunset", () => {
    vi.setSystemTime(NOON * 1000);
    const result = getWeatherBackground(800, undefined, SUNRISE, SUNSET);
    expect(result).toContain("sky-300"); // clear day
  });

  it("returns night gradient when time is after sunset", () => {
    vi.setSystemTime(NIGHT * 1000);
    const result = getWeatherBackground(800, undefined, SUNRISE, SUNSET);
    expect(result).toContain("indigo-900"); // clear night
  });

  it("returns night gradient when time is before sunrise", () => {
    vi.setSystemTime((SUNRISE - 3600) * 1000); // 1 hour before sunrise
    const result = getWeatherBackground(800, undefined, SUNRISE, SUNSET);
    expect(result).toContain("indigo-900");
  });
});

describe("getWeatherBackground — all weather groups", () => {
  beforeEach(() => {
    vi.setSystemTime(NOON * 1000);
  });

  it("drizzle", () => {
    const result = getWeatherBackground(300, "09d", SUNRISE, SUNSET);
    expect(result).toContain("sky-400");
  });

  it("rain", () => {
    const result = getWeatherBackground(500, "10d", SUNRISE, SUNSET);
    expect(result).toContain("sky-500");
  });

  it("snow", () => {
    const result = getWeatherBackground(600, "13d", SUNRISE, SUNSET);
    expect(result).toContain("sky-400");
  });

  it("atmosphere (fog)", () => {
    const result = getWeatherBackground(701, "50d", SUNRISE, SUNSET);
    expect(result).toContain("stone-300");
  });

  it("clouds", () => {
    const result = getWeatherBackground(801, "02d", SUNRISE, SUNSET);
    expect(result).toContain("slate-400");
  });
});
