import { test, expect } from "@playwright/test";

test.describe("Homepage", () => {
  test("returns HTTP 200", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("serves HTML content", async ({ page }) => {
    const response = await page.goto("/");
    const contentType = response?.headers()["content-type"] ?? "";
    expect(contentType).toContain("text/html");
  });

  test("page contains app name", async ({ page }) => {
    await page.goto("/");
    const html = await page.content();
    expect(html.toLowerCase()).toContain("vertex");
  });

  test("lat/lon search params are accepted without error", async ({ page }) => {
    // Default Cupertino coordinates — should not 500
    const response = await page.goto(
      "/?lat=37.319321&lon=-122.029283&location=Cupertino&country=US",
    );
    expect(response?.status()).toBe(200);
  });
});
