"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A one-time heads-up in AI brief mode: every brief mail is a paid API call.
 * "Seen" lives in this browser only — it is a courtesy, not a rule, so a
 * cleared or blocked storage just shows the note once more.
 */
const BRIEF_COST_NOTICE_KEY = "flya.briefCostNoticeSeen";

const listeners = new Set<() => void>();
/** Covers blocked storage: once dismissed, stay hidden for this page load. */
let dismissedThisLoad = false;

function readSeen(): boolean {
  if (dismissedThisLoad) return true;
  try {
    return window.localStorage.getItem(BRIEF_COST_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether to show the note, and the "Got it" handler that hides it for good. */
export function useBriefCostNotice() {
  // The server renders it hidden, so the first paint never flashes it.
  const seen = useSyncExternalStore(subscribe, readSeen, () => true);
  const dismiss = useCallback(() => {
    dismissedThisLoad = true;
    try {
      window.localStorage.setItem(BRIEF_COST_NOTICE_KEY, "1");
    } catch {
      // Storage blocked: the note simply shows again next time.
    }
    listeners.forEach((l) => l());
  }, []);
  return { showBriefCostNotice: !seen, dismissBriefCostNotice: dismiss };
}
