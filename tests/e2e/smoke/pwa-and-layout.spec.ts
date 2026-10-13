import { expect, test } from "@playwright/test";
import { chromiumDevice } from "../support/stack";

test.describe("PWA assets", () => {
  test("serves an installable manifest with icons", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest).toMatchObject({ name: "KJ Chat", start_url: "/chats", display: "standalone" });
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.status()).toBe(200);
      expect(iconResponse.headers()["content-type"]).toBe("image/png");
    }
  });

  test("serves the service worker uncached and in scope", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
    expect(response.headers()["cache-control"]).toContain("no-cache");
    expect(response.headers()["service-worker-allowed"]).toBe("/");
    const source = await response.text();
    expect(source).toContain('addEventListener("push"');
    expect(source).toContain('addEventListener("notificationclick"');
  });

  test("offline fallback page renders", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  });
});

test.describe("responsive layout", () => {
  test.use(chromiumDevice("iPhone 13"));

  test("auth pages fit a phone screen without horizontal scrolling", async ({ page }) => {
    for (const path of ["/login", "/register", "/forgot-password"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);
      const button = page.getByRole("button").last();
      const box = await button.boundingBox();
      expect(box?.height ?? 0, `${path} primary button is too small to tap`).toBeGreaterThanOrEqual(40);
    }
  });

  test("inputs use a 16px font so iOS doesn't zoom on focus", async ({ page }) => {
    await page.goto("/login");
    const size = await page.getByLabel("Email").evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });
});

test.describe("theming", () => {
  test("follows the system dark preference", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page.locator("html")).toHaveClass(/dark/);
    // Rasterise the computed colour (it may be oklch) and check every RGB channel is dark.
    const channels = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
    });
    expect(Math.max(...channels)).toBeLessThan(80);
    await context.close();
  });
});
