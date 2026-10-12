/**
 * "The real page is on screen": the signal the launch camera waits for
 * before it pulls back, so what materialises is the dashboard, not its
 * loading skeleton. `markLaunchReady()` is called from a mount effect of the
 * desktop and phone shells and the login page; everything else never calls
 * it, and the splash falls back to a plain fade there.
 *
 * A module flag plus a window event: the shells may mount before or after
 * the splash's effect runs, and both orders work. Idempotent.
 */
export const LAUNCH_READY_EVENT = "flya:launch-ready";

let ready = false;

export function markLaunchReady(): void {
  if (ready || typeof window === "undefined") return;
  ready = true;
  window.dispatchEvent(new Event(LAUNCH_READY_EVENT));
}

export function isLaunchReady(): boolean {
  return ready;
}

/** Resolves now if the page is already up, else when it says so. */
export function whenLaunchReady(): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener(LAUNCH_READY_EVENT, () => resolve(), { once: true });
  });
}

/** Test seam. */
export function resetLaunchReadyForTests(): void {
  ready = false;
}
