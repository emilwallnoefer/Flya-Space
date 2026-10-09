import { expect, test } from "@playwright/test";

// The home-screen install surface: everything iOS and Android read before
// and after "Add to Home Screen". All of it is public, so no sign-in needed.

test("manifest describes a standalone app with its icons", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await response.json();
  expect(manifest.name).toBe("Flya Space");
  expect(manifest.display).toBe("standalone");
  expect(manifest.scope).toBe("/");
  expect(manifest.start_url).toBe("/dashboard");
  expect(Array.isArray(manifest.icons) && manifest.icons.length >= 3).toBe(true);
  for (const icon of manifest.icons as { src: string }[]) {
    const image = await request.get(icon.src);
    expect(image.ok(), icon.src).toBe(true);
    expect(image.headers()["content-type"]).toContain("image/png");
  }
});

test("pages carry the viewport and Apple home-screen tags", async ({ page }) => {
  await page.goto("/login");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).toContain("viewport-fit=cover");
  expect(viewport).toContain("width=device-width");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(appleIcon).toBeTruthy();
  const icon = await page.request.get(appleIcon as string);
  expect(icon.ok()).toBe(true);
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Flya Space");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
});

test("login fits the screen without sideways scroll and keeps a tappable button", async ({ page }) => {
  await page.goto("/login");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const button = page.getByRole("button", { name: /continue with google/i });
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

// Phone vs desktop is decided on the server from the User-Agent
// (lib/device.ts); the root layout marks phone requests with
// html[data-device="phone"]. The iphone-emulated project sends an iPhone UA,
// the desktop project a desktop one, so the same test proves both sides:
// a phone gets the mark, and a desktop browser never does — however narrow
// its window.
test("the server marks phone requests and only phone requests", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  const device = await page.locator("html").getAttribute("data-device");
  expect(device).toBe(isMobile ? "phone" : null);
});
