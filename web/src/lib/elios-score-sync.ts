/**
 * Browser side of the offline leaderboard queue: posting a finished run, and
 * holding on to it when that cannot happen yet.
 *
 * The rules — what is worth keeping, when to let go — are in
 * `lib/elios-pending-score.ts`. This module is the storage and the fetch, and
 * a tiny external store so `useSyncExternalStore` can show "waiting to sync".
 *
 * A caveat that follows from where the score is kept: localStorage belongs to
 * the browser, not the account. A score flown on the (public) offline page is
 * posted under whoever is signed in when the app next comes online. On a shared
 * machine that could be the wrong colleague — acceptable for a bragging board
 * the server already cannot verify, and not worth an identity check that the
 * offline page, having no session, could never make.
 */
import {
  PENDING_SCORE_KEY,
  mergePendingScore,
  parsePendingScore,
  pendingOutcome,
} from "@/lib/elios-pending-score";
import { ELIOS_RULES_VERSION } from "@/lib/elios-leaderboard";

let pendingCache: number | null | undefined;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function readPendingScore(): number | null {
  if (pendingCache === undefined) {
    try {
      pendingCache = parsePendingScore(window.localStorage.getItem(PENDING_SCORE_KEY));
    } catch {
      // Private windows and blocked site data both throw here.
      pendingCache = null;
    }
  }
  return pendingCache;
}

function writePendingScore(value: number | null) {
  pendingCache = value;
  try {
    if (value === null) window.localStorage.removeItem(PENDING_SCORE_KEY);
    else window.localStorage.setItem(PENDING_SCORE_KEY, String(value));
  } catch {
    // Without storage the score only survives as long as this tab does.
  }
  notify();
}

/** Another tab queued or posted a score — drop the cache so the next read sees it. */
function onStorage(e: StorageEvent) {
  if (e.key !== PENDING_SCORE_KEY && e.key !== null) return;
  pendingCache = undefined;
  notify();
}

export function subscribePendingScore(onChange: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function queuePendingScore(score: number) {
  const next = mergePendingScore(readPendingScore(), score);
  if (next !== readPendingScore()) writePendingScore(next);
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Post a finished run, or keep it for later if that fails.
 *
 * Resolves to true when the board changed, so the caller knows to reload it.
 * Never throws: a lost score is not worth an error on screen.
 */
export async function submitEliosScore(score: number): Promise<boolean> {
  if (isOffline()) {
    queuePendingScore(score);
    return false;
  }
  try {
    const res = await fetch("/api/elios-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, rules: ELIOS_RULES_VERSION }),
    });
    if (pendingOutcome(res.status) === "keep") {
      queuePendingScore(score);
      return false;
    }
    if (!res.ok) return false;
    const json = (await res.json()) as { recorded?: boolean };
    return json.recorded === true;
  } catch {
    // The request never reached us — the connection is gone even if
    // `navigator.onLine` has not noticed yet.
    queuePendingScore(score);
    return false;
  }
}

let inFlight: Promise<boolean> | null = null;

/**
 * Post the score that is waiting, if there is one.
 *
 * Shared across every caller in the tab, so the game and the dashboard both
 * reacting to the same `online` event send one request, not two. Two TABS can
 * still both send it; the server only records an improvement, so the second
 * is a no-op.
 */
export function flushPendingScore(): Promise<boolean> {
  if (inFlight) return inFlight;
  const score = readPendingScore();
  if (score === null || isOffline()) return Promise.resolve(false);

  inFlight = (async () => {
    try {
      const res = await fetch("/api/elios-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, rules: ELIOS_RULES_VERSION }),
      });
      const outcome = pendingOutcome(res.status);
      if (outcome === "keep") return false;
      // Only let go of what was sent: a better run may have been queued while
      // this request was out, and that one still has to go.
      if (readPendingScore() === score) writePendingScore(null);
      if (outcome === "drop") return false;
      const json = (await res.json()) as { recorded?: boolean };
      return json.recorded === true;
    } catch {
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
