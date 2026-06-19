import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("returns a single class unchanged", () => {
    expect(cn("px-4")).toBe("px-4");
  });

  it("merges multiple classes", () => {
    const result = cn("px-4", "py-2", "text-sm");
    expect(result).toContain("px-4");
    expect(result).toContain("py-2");
    expect(result).toContain("text-sm");
  });

  it("resolves Tailwind conflicts (last padding wins)", () => {
    const result = cn("p-4", "p-8");
    expect(result).not.toContain("p-4");
    expect(result).toContain("p-8");
  });

  it("ignores falsy values", () => {
    const result = cn("px-4", undefined, null, false, "py-2");
    expect(result).toContain("px-4");
    expect(result).toContain("py-2");
    expect(result).not.toContain("undefined");
    expect(result).not.toContain("null");
    expect(result).not.toContain("false");
  });

  it("handles conditional classes", () => {
    const active = true;
    const result = cn("base", active && "active", !active && "inactive");
    expect(result).toContain("base");
    expect(result).toContain("active");
    expect(result).not.toContain("inactive");
  });

  it("returns empty string when no classes provided", () => {
    expect(cn()).toBe("");
  });
});
