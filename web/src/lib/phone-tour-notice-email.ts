/**
 * The "somebody finished the phone walkthrough" push, as the admins' phones
 * show it. Pure so the exact strings can be asserted in a unit test;
 * `lib/phone-tour-notice.ts` is the "server-only" side that claims the
 * send-once row and delivers.
 */

/** Where a tap lands: Admin → Users & roles. */
export const PHONE_TOUR_NOTICE_DEEP_LINK = "/dashboard?module=admin&section=users";

export function renderPhoneTourPush(input: { userId: string; email: string; name?: string | null }) {
  const name = (input.name ?? "").trim() || input.email.trim();
  return {
    title: "Phone walkthrough done",
    body: `${name} clicked through the phone app tour.`,
    url: PHONE_TOUR_NOTICE_DEEP_LINK,
    tag: `phone-tour-${input.userId}`,
  };
}
