import { describe, expect, it } from "vitest";
import {
  NOTIFICATIONS_PROMPT_DISMISSED_KEY,
  PROMPT_SNOOZE_MS,
  readDismissedAt,
  shouldOfferNotifications,
  shouldResubscribeQuietly,
} from "./first-launch";

const now = Date.UTC(2026, 9, 12, 8, 0, 0);
const fresh = { supported: true, permission: "default" as const, registered: false, dismissedAt: null, now };

describe("shouldOfferNotifications", () => {
  it("offers on a supported device that was never asked", () => {
    expect(shouldOfferNotifications(fresh)).toBe(true);
  });
  it("stays quiet where push is unsupported (e.g. iOS Safari tab)", () => {
    expect(shouldOfferNotifications({ ...fresh, supported: false })).toBe(false);
  });
  it("never re-asks once the user answered the browser prompt either way", () => {
    expect(shouldOfferNotifications({ ...fresh, permission: "granted" })).toBe(false);
    expect(shouldOfferNotifications({ ...fresh, permission: "denied" })).toBe(false);
  });
  it("stays quiet when the device is already registered", () => {
    expect(shouldOfferNotifications({ ...fresh, registered: true })).toBe(false);
  });
  it("snoozes after Not now, then offers again", () => {
    expect(shouldOfferNotifications({ ...fresh, dismissedAt: now - 1000 })).toBe(false);
    expect(shouldOfferNotifications({ ...fresh, dismissedAt: now - PROMPT_SNOOZE_MS + 1 })).toBe(false);
    expect(shouldOfferNotifications({ ...fresh, dismissedAt: now - PROMPT_SNOOZE_MS })).toBe(true);
  });
});

describe("shouldResubscribeQuietly", () => {
  it("re-subscribes when permission is granted but the server lost the device", () => {
    expect(shouldResubscribeQuietly({ supported: true, permission: "granted", registered: false })).toBe(true);
  });
  it("does nothing when registered, not granted, or unsupported", () => {
    expect(shouldResubscribeQuietly({ supported: true, permission: "granted", registered: true })).toBe(false);
    expect(shouldResubscribeQuietly({ supported: true, permission: "default", registered: false })).toBe(false);
    expect(shouldResubscribeQuietly({ supported: false, permission: "granted", registered: false })).toBe(false);
  });
});

describe("readDismissedAt", () => {
  it("parses a stored timestamp and ignores junk or a throwing storage", () => {
    expect(readDismissedAt({ getItem: () => "1760000000000" })).toBe(1760000000000);
    expect(readDismissedAt({ getItem: () => null })).toBeNull();
    expect(readDismissedAt({ getItem: () => "nope" })).toBeNull();
    expect(
      readDismissedAt({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBeNull();
    expect(NOTIFICATIONS_PROMPT_DISMISSED_KEY).toMatch(/^fs-/);
  });
});
