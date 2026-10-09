import { describe, expect, it } from "vitest";
import { isPhoneUserAgent } from "./device";

// Every UA below is one a real request can carry. The point of pinning them:
// the phone/desktop split is decided here and nowhere else, so "a desktop
// browser in a narrow window still gets the desktop UI" and "an iPad gets the
// desktop UI" are facts this file proves, not hopes.

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_HOME_SCREEN =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const PLAYWRIGHT_IPHONE_14 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPAD_SAFARI_DESKTOP_UA = MAC_SAFARI; // iPadOS asks for desktop sites with a Mac UA
const IPAD_SAFARI_MOBILE_UA =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const PLAYWRIGHT_DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("isPhoneUserAgent", () => {
  it.each([
    ["iPhone Safari", IPHONE_SAFARI],
    ["iPhone home-screen app", IPHONE_HOME_SCREEN],
    ["Android Chrome", ANDROID_CHROME],
    ["Playwright iPhone 14", PLAYWRIGHT_IPHONE_14],
  ])("%s is a phone", (_label, ua) => {
    expect(isPhoneUserAgent(ua)).toBe(true);
  });

  it.each([
    ["Mac Safari", MAC_SAFARI],
    ["iPad with desktop UA", IPAD_SAFARI_DESKTOP_UA],
    ["iPad with mobile UA (a tablet)", IPAD_SAFARI_MOBILE_UA],
    ["Windows Chrome", WINDOWS_CHROME],
    ["Playwright Desktop Chrome", PLAYWRIGHT_DESKTOP_CHROME],
  ])("%s gets the desktop UI", (_label, ua) => {
    expect(isPhoneUserAgent(ua)).toBe(false);
  });

  it("treats a missing User-Agent as desktop", () => {
    expect(isPhoneUserAgent(null)).toBe(false);
    expect(isPhoneUserAgent("")).toBe(false);
  });
});
