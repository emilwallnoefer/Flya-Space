import { userAgent } from "next/server";

/**
 * Is this request from a phone?
 *
 * The one place that decides which UI a request gets: phones receive the
 * dedicated mobile shell (`components/mobile/`), everything else the desktop
 * shell, byte-for-byte as before. It is decided on the server from the
 * User-Agent so the first paint is already the right layout — no flash, no
 * second DOM for CSS to hide.
 *
 * "Phone" is `device.type === "mobile"` as ua-parser-js sees it: iPhone,
 * Android phones. Tablets (`"tablet"`) and desktops (`undefined`) get the
 * desktop UI; iPadOS Safari reports a Mac UA and lands there too, which is
 * the intent — a tablet has the room for the full layout.
 */
export function isPhoneRequest(headers: Headers): boolean {
  return userAgent({ headers }).device.type === "mobile";
}

/** Same rule for a raw User-Agent string (tests, logs). */
export function isPhoneUserAgent(ua: string | null | undefined): boolean {
  return isPhoneRequest(new Headers(ua ? { "user-agent": ua } : {}));
}
