import { expect, test } from "@playwright/test";

/**
 * The launch camera with a scrollbar that takes width, as Windows Chrome
 * draws it (headless Chromium hides scrollbars, macOS overlays them). On a
 * screen wider than the content's max-width the page is centred; the zoom
 * clips overflow, and if that took the scrollbar away the page would move
 * sideways by half its width under the camera, which then gave up for a
 * plain fade. Its own file because the launch option forces a new worker.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("a wide screen with a classic scrollbar keeps the title under the splash", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "classic scrollbars are a desktop thing");
  await page.setViewportSize({ width: 1920, height: 800 });
  await page.addInitScript(() => {
    window.addEventListener("flya:launch-trace", (e) => {
      (window as unknown as { __off: number }).__off = (e as CustomEvent<{ off: number }>).detail.off;
    });
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "::-webkit-scrollbar { width: 17px; } body { min-height: 200vh; }";
      document.head.append(style);
    });
  });
  await page.goto("/login");
  await page.waitForFunction(() => "__off" in window, null, { timeout: 10_000 });
  const off = await page.evaluate(() => (window as unknown as { __off: number }).__off);
  expect(off).toBeLessThanOrEqual(1);
  // Once the opening is over the scrollbar is back (so it was there all
  // along) and the page carries nothing left over from the hold.
  await expect(page.locator("html")).not.toHaveAttribute("data-launch-zoom", "", { timeout: 6_000 });
  expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.style.paddingRight)).toBe("");
});
