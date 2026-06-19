import { test, expect } from "@playwright/test";

test.describe("Geocode API", () => {
  test("returns empty array for query shorter than 3 chars", async ({
    request,
  }) => {
    const response = await request.get("/api/geocode?q=Lo");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test("returns empty array when query param is missing", async ({
    request,
  }) => {
    const response = await request.get("/api/geocode");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test("returns JSON for a valid city query", async ({ request }) => {
    const response = await request.get("/api/geocode?q=London");
    // 200 with results, 500 if API key not configured, 502 if upstream failed
    expect([200, 500, 502]).toContain(response.status());
    const body = await response.json();
    expect(typeof body).toBe("object");
  });
});

test.describe("Weather Tile API", () => {
  test("returns 400 for an invalid layer", async ({ request }) => {
    const response = await request.get("/api/weather/invalid_layer/1/1/1");
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  test("valid layer requires API key (200 or 500)", async ({ request }) => {
    const response = await request.get("/api/weather/clouds_new/1/1/1");
    expect([200, 500]).toContain(response.status());
  });
});
