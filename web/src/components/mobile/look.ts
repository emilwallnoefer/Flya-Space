/**
 * Which look the phone UI wears. Both are the same components; the value
 * lands on the mobile root as `data-mobile-look`, and app/mobile.css keys
 * the difference on it:
 *
 *   "native" — flat surfaces, hairlines, no aurora: a native-app look that
 *              follows the chosen skin's colours and accent only.
 *   "skin"   — the chosen skin's own decorations (glass, paper, neu) on the
 *              tiles, groups, sheets and tab bar, plus the aurora behind.
 *
 * One constant so the two can be compared on the same build by flipping it.
 */
export const MOBILE_LOOK: "native" | "skin" = "skin";
