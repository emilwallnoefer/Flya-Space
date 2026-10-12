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
    __doneState?: { zoom: boolean; settle: boolean; splash: boolean; transform: string };
  }
}

async function armTrace(page: Page, warm: boolean) {
  await page.addInitScript((isWarm) => {
    window.addEventListener("flya:launch-trace", (e) => {
      window.__trace = (e as CustomEvent<Trace>).detail;
    });
    window.addEventListener("flya:launch-done", () => {
      const html = document.documentElement;
      window.__doneState = {
        zoom: html.hasAttribute("data-launch-zoom"),
        settle: html.hasAttribute("data-launch-settle"),
        splash: Boolean(document.querySelector(".launch-splash")),
        transform: (document.querySelector(".launch-stage") as HTMLElement).style.transform,
      };
    });
    if (isWarm) sessionStorage.setItem("ma_launch", String(Date.now()));
  }, warm);
}

for (const warm of [false, true]) {
  test(`the header title sits exactly under the splash title at the swap (${warm ? "from the launch page" : "cold"})`, async ({ page }) => {
    await armTrace(page, warm);
    await page.goto("/login");
    if (warm) {
      // Marked while the overlay is up (it is cleared when the overlay goes).
      await expect(page.locator("html")).toHaveAttribute("data-launch-warm", "1");
    }
    await page.waitForFunction(() => Boolean(window.__trace), null, { timeout: 10_000 });
    const trace = (await page.evaluate(() => window.__trace)) as Trace;
    expect(trace.s).toBeGreaterThan(1.05);
    expect(trace.off).toBeLessThanOrEqual(1);
    for (const k of ["left", "top", "width", "height"] as const) {
      expect(Math.abs(trace.targetAtT0[k] - trace.overlay[k])).toBeLessThanOrEqual(1);
    }
  });
}

test("from the launch page, the splash title resumes its entrance where the launch page left it", async ({ page }) => {
  // The launch page stamped its entrance 400 ms before this document starts.
  await page.addInitScript(() => {
    sessionStorage.setItem("ma_launch", String(Date.now() - 400));
    window.addEventListener("flya:launch-trace", () => {
      (window as unknown as { __traced: boolean }).__traced = true;
    });
  });
  await page.goto("/login", { waitUntil: "commit" });
  await page.waitForSelector(".launch-splash-word", { state: "attached" });
  const state = await page.evaluate(() => {
    const word = document.querySelector(".launch-splash-word") as HTMLElement;
    const anim = word.getAnimations()[0] as CSSAnimation | undefined;
    // The negative delay is in the effect's progress, not in currentTime.
    const progress = anim?.effect?.getComputedTiming().progress ?? null;
    return {
      elapsed: getComputedStyle(document.documentElement).getPropertyValue("--launch-elapsed").trim(),
      name: anim?.animationName ?? null,
      progress,
      // scaleX of the computed matrix: matrix(a, b, c, d, tx, ty).
      scaleX: parseFloat(getComputedStyle(word).transform.replace("matrix(", "")),
    };
  });
  // Resumed, not restarted (the time already lived on the launch page is
  // counted) and not at rest (scaleX(1.28) is where it ends).
  expect(state.name).toBe("launchSplashWord");
  expect(parseFloat(state.elapsed)).toBeGreaterThanOrEqual(400);
  expect(state.progress).toBeGreaterThanOrEqual(400 / 900);
  expect(state.progress).toBeLessThan(1);
  expect(state.scaleX).toBeGreaterThan(1.28);
  expect(state.scaleX).toBeLessThanOrEqual(1.44);
  // And the marks are gone once the overlay is.
  await page.waitForFunction(() => !document.querySelector(".launch-splash"), null, { timeout: 8_000 });
  const after = await page.evaluate(() => ({
    warm: document.documentElement.hasAttribute("data-launch-warm"),
    elapsed: document.documentElement.style.getPropertyValue("--launch-elapsed"),
  }));
  expect(after).toEqual({ warm: false, elapsed: "" });
});

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
  // The "opening is over" signal (what first-load popups wait for) fired
  // only once every attribute and the overlay were gone.
  await page.waitForFunction(() => Boolean(window.__doneState), null, { timeout: 3_000 });
  const doneState = await page.evaluate(() => window.__doneState);
  expect(doneState).toEqual({ zoom: false, settle: false, splash: false, transform: "" });
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
