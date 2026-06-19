import { describe, it, expect } from "vitest";
import { getWeatherEmoji } from "@/lib/constants/weather-emoji";

describe("getWeatherEmoji — clear sky (id 800) day/night", () => {
  it("day icon returns sun", () => {
    expect(getWeatherEmoji(800, "01d")).toBe("☀️");
  });

  it("night icon returns moon", () => {
    expect(getWeatherEmoji(800, "01n")).toBe("🌙");
  });

  it("no icon defaults to sun", () => {
    expect(getWeatherEmoji(800)).toBe("☀️");
  });
});

describe("getWeatherEmoji — thunderstorm group (200-232)", () => {
  it("200 → ⛈️", () => expect(getWeatherEmoji(200)).toBe("⛈️"));
  it("210 → 🌩️", () => expect(getWeatherEmoji(210)).toBe("🌩️"));
  it("232 → ⛈️", () => expect(getWeatherEmoji(232)).toBe("⛈️"));
});

describe("getWeatherEmoji — drizzle/rain group (300-531)", () => {
  it("300 → 🌧️", () => expect(getWeatherEmoji(300)).toBe("🌧️"));
  it("511 → 🌨️ (freezing rain)", () => expect(getWeatherEmoji(511)).toBe("🌨️"));
  it("500 → 🌧️", () => expect(getWeatherEmoji(500)).toBe("🌧️"));
});

describe("getWeatherEmoji — snow group (600-622)", () => {
  it("600 → ❄️", () => expect(getWeatherEmoji(600)).toBe("❄️"));
  it("602 → 🌨️ (heavy snow)", () => expect(getWeatherEmoji(602)).toBe("🌨️"));
});

describe("getWeatherEmoji — atmosphere group (701-781)", () => {
  it("701 (mist) → 🌫️", () => expect(getWeatherEmoji(701)).toBe("🌫️"));
  it("771 (squall) → 💨", () => expect(getWeatherEmoji(771)).toBe("💨"));
  it("781 (tornado) → 🌪️", () => expect(getWeatherEmoji(781)).toBe("🌪️"));
});

describe("getWeatherEmoji — clouds group (801-804)", () => {
  it("801 → ⛅", () => expect(getWeatherEmoji(801)).toBe("⛅"));
  it("804 → ☁️", () => expect(getWeatherEmoji(804)).toBe("☁️"));
});

describe("getWeatherEmoji — unknown id fallback", () => {
  it("unknown id returns thermometer emoji", () => {
    expect(getWeatherEmoji(9999)).toBe("🌡️");
  });
});
