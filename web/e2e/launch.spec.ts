import { expect, test, type Page } from "@playwright/test";

/**
 * The launch camera (components/launch-splash.tsx) on the one signed-out page
 * that takes the opening shot: /login runs the identical code path as the
 * dashboard (same wordmark, same target, same reveals). The component emits
 * `flya:launch-trace` on the swap frame with both rects, which is what the
 * geometry assertions read.
 */
type Trace = {
  overlay: { left: number; top: number; width: number; height: number };
  target: { left: number; top: number; width: number; height: number };
  targetAtT0: { left: number; top: number; width: number; height: number };
  s: number;
  off: number;
};

declare global {
  interface Window {
    __trace?: Trace;
  }
}

async function armTrace(page: Page, warm: boolean) {
  await page.addInitScript((isWarm) => {
    window.addEventListener("flya:launch-trace", (e) => {
      window.__trace = (e as CustomEvent<Trace>).detail;
    });
    if (isWarm) sessionStorage.setItem("ma_launch", String(Date.now()));
  }, warm);
}

for (const warm of [false, true]) {
  test(`the header title sits exactly under the splash title at the swap (${warm ? "from the launch page" : "cold"})`, async ({ page }) => {
    await armTrace(page, warm);
    await page.goto("/login");
    await page.waitForFunction(() => Boolean(window.__trace), null, { timeout: 10_000 });
    const trace = (await page.evaluate(() => window.__trace)) as Trace;
    expect(trace.s).toBeGreaterThan(1.05);
    expect(trace.off).toBeLessThanOrEqual(1);
    for (const k of ["left", "top", "width", "height"] as const) {
      expect(Math.abs(trace.targetAtT0[k] - trace.overlay[k])).toBeLessThanOrEqual(1);
    }
    if (warm) {
      await expect(page.locator("html")).toHaveAttribute("data-launch-warm", "1");
    }
  });
}

test("the stage transform runs and leaves nothing behind", async ({ page }) => {
  await armTrace(page, false);
  await page.goto("/login");
  await page.waitForFunction(() => Boolean(window.__trace), null, { timeout: 10_000 });
  // Opening frame: inline camera transform, zoom attribute on.
  const atStart = await page.evaluate(() => ({
    inline: (document.querySelector(".launch-stage") as HTMLElement).style.transform,
    zoom: document.documentElement.hasAttribute("data-launch-zoom"),
  }));
  expect(atStart.inline.startsWith("translate(")).toBe(true);
  expect(atStart.zoom).toBe(true);

  await page.waitForFunction(
    () =>
      !document.documentElement.hasAttribute("data-launch-zoom") &&
      !document.documentElement.hasAttribute("data-launch-settle") &&
      !document.querySelector(".launch-splash"),
    null,
    { timeout: 6_000 },
  );
  const atEnd = await page.evaluate(() => {
    const stage = document.querySelector(".launch-stage") as HTMLElement;
    const html = document.documentElement;
    const leftovers = [...document.querySelectorAll<HTMLElement>("[data-launch-reveal], [data-launch-late]")].filter(
      (el) => getComputedStyle(el).opacity !== "1" || el.style.opacity !== "" || el.style.transform !== "",
    ).length;
    return {
      computed: getComputedStyle(stage).transform,
      inline: stage.style.transform,
      animations: stage.getAnimations().length,
      revealStart: html.style.getPropertyValue("--launch-reveal-start"),
      overflowHtml: getComputedStyle(html).overflow,
      overflowBody: getComputedStyle(document.body).overflow,
      wide: html.scrollWidth > window.innerWidth,
      leftovers,
    };
  });
  expect(atEnd.computed).toBe("none");
  expect(atEnd.inline).toBe("");
  expect(atEnd.animations).toBe(0);
  expect(atEnd.revealStart).toBe("");
  expect(atEnd.overflowHtml).not.toBe("hidden");
  expect(atEnd.overflowBody).not.toBe("hidden");
  expect(atEnd.wide).toBe(false);
  expect(atEnd.leftovers).toBe(0);
});

test("mid-move frames", async ({ page }, testInfo) => {
  await armTrace(page, false);
  await page.goto("/login");
  await page.waitForFunction(() => Boolean(window.__trace), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector(".launch-stage")!.getAnimations().length > 0, null, { timeout: 2_000 });
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  for (const t of [0, 300, 700, 1100, 1500]) {
    await page.evaluate((time) => document.getAnimations().forEach((a) => (a.currentTime = time)), t);
    await page.screenshot({ path: testInfo.outputPath(`frame-${t}.png`) });
  }
});

test("reduced motion: no camera, just a fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await armTrace(page, false);
  await page.goto("/login");
  await page.waitForFunction(() => !document.querySelector(".launch-splash"), null, { timeout: 6_000 });
  const traced = await page.evaluate(() => Boolean(window.__trace));
  expect(traced).toBe(false);
  const inline = await page.evaluate(() => (document.querySelector(".launch-stage") as HTMLElement).style.transform);
  expect(inline).toBe("");
});

test("a page without a title target fades at the hold", async ({ page }) => {
  await armTrace(page, false);
  await page.goto("/offline");
  await page.waitForFunction(() => !document.querySelector(".launch-splash"), null, { timeout: 6_000 });
  const traced = await page.evaluate(() => Boolean(window.__trace));
  expect(traced).toBe(false);
  await expect(page.locator("html")).not.toHaveAttribute("data-launch-zoom", "");
});
