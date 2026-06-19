import { describe, it, expect } from "vitest";
import {
  convertTemp,
  convertWindSpeed,
  convertPressure,
  convertDistance,
  convertPrecipitation,
} from "@/lib/weather/units";

describe("convertTemp", () => {
  it("returns celsius unchanged", () => {
    expect(convertTemp(20, "celsius")).toBe(20);
  });

  it("converts 0°C to 32°F", () => {
    expect(convertTemp(0, "fahrenheit")).toBe(32);
  });

  it("converts 100°C to 212°F", () => {
    expect(convertTemp(100, "fahrenheit")).toBe(212);
  });

  it("handles -40 edge case (same in both scales)", () => {
    expect(convertTemp(-40, "fahrenheit")).toBe(-40);
  });
});

describe("convertWindSpeed", () => {
  it("returns m/s unchanged", () => {
    expect(convertWindSpeed(10, "m/s")).toBe(10);
  });

  it("converts m/s to km/h", () => {
    expect(convertWindSpeed(10, "km/h")).toBeCloseTo(36, 1);
  });

  it("converts m/s to mph", () => {
    expect(convertWindSpeed(10, "mph")).toBeCloseTo(22.37, 1);
  });

  it("converts m/s to knots", () => {
    expect(convertWindSpeed(10, "knots")).toBeCloseTo(19.44, 1);
  });
});

describe("convertPressure", () => {
  it("returns hPa unchanged", () => {
    expect(convertPressure(1013, "hPa")).toBe(1013);
  });

  it("converts 1013 hPa to approx 29.92 inHg (standard atmosphere)", () => {
    expect(convertPressure(1013, "inHg")).toBeCloseTo(29.91, 1);
  });
});

describe("convertDistance", () => {
  it("converts meters to km", () => {
    expect(convertDistance(10000, "km")).toBeCloseTo(10, 1);
  });

  it("converts meters to miles", () => {
    expect(convertDistance(10000, "mi")).toBeCloseTo(6.21, 1);
  });
});

describe("convertPrecipitation", () => {
  it("returns mm unchanged", () => {
    expect(convertPrecipitation(25.4, "mm")).toBe(25.4);
  });

  it("converts 25.4 mm to 1 inch", () => {
    expect(convertPrecipitation(25.4, "in")).toBeCloseTo(1, 5);
  });
});
