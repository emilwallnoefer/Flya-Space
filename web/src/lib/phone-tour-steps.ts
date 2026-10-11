import type { ModuleKey } from "@/lib/dashboard-modules";

/**
 * The desktop's one-time walkthrough of the phone app: which screens it
 * shows, in what order, and what each caption says. Pure data so the order
 * and the role clamp are testable; `components/phone-tour.tsx` draws it.
 */

/** What the mock iPhone shows for a step. */
export type PhoneScreen =
  | "home"
  | "time"
  | "mail"
  | "fleet"
  | "chat"
  | "day-empty"
  | "day-filled"
  | "safari"
  | "share-sheet"
  | "home-screen";

/** Which part of the screen the spotlight ring and the arrow point at. */
export type PhoneSpot =
  | "greeting"
  | "tabbar"
  | "tab-time"
  | "tab-mail"
  | "tab-fleet"
  | "tab-chat"
  | "today-row"
  | "start-stop"
  | "quick-fill"
  | "save"
  | "share-button"
  | "add-to-home"
  | "app-icon";

export type PhoneTourStep = {
  key: string;
  /** Short heading in the caption panel. */
  title: string;
  /** One or two sentences. */
  body: string;
  /** Two or three words next to the arrow on the phone. */
  hint: string;
  screen: PhoneScreen;
  spot: PhoneSpot | null;
  /** Which tab reads as active in the mock tab bar. */
  activeTab: "time" | "mail" | "fleet" | "chat" | null;
};

export const PHONE_TOUR_SEEN_KEY = "ma_phone_tour_seen_v1";

/**
 * The steps for a role. Mail is only on the phone for roles that have it on
 * the desktop, so its tab step (and the tab itself) drop out for sales/HR.
 */
export function phoneTourSteps(availableModules: ModuleKey[]): PhoneTourStep[] {
  const hasMail = availableModules.includes("mail");
  const hasFleet = availableModules.includes("fleet");
  const tabCount = 2 + (hasMail ? 1 : 0) + (hasFleet ? 1 : 0);
  const steps: Array<PhoneTourStep | null> = [
    {
      key: "welcome",
      title: "Flya Space fits in your pocket",
      body: "The same account and the same data, laid out for one hand. This is what it looks like on your iPhone.",
      hint: "That's you",
      screen: "home",
      spot: "greeting",
      activeTab: null,
    },
    {
      key: "tabs",
      title: `${tabCount === 4 ? "Four" : tabCount === 3 ? "Three" : "Two"} buttons along the bottom`,
      body: "Every module is one tap away, always in thumb reach. The back chevron at the top left returns to this home board.",
      hint: "Your modules",
      screen: "home",
      spot: "tabbar",
      activeTab: null,
    },
    {
      key: "tab-time",
      title: "Time",
      body: "Your week as a plain list, with this week's hours and your overtime bank on top. Open a day to log it.",
      hint: "Time",
      screen: "time",
      spot: "tab-time",
      activeTab: "time",
    },
    hasMail
      ? {
          key: "tab-mail",
          title: "Mail",
          body: "Write a training mail from your phone: pick the type, fill the brief, and it lands as a Gmail draft, never sent on its own.",
          hint: "Mail",
          screen: "mail",
          spot: "tab-mail",
          activeTab: "mail",
        }
      : null,
    hasFleet
      ? {
          key: "tab-fleet",
          title: "Fleet",
          body: "What is with you, what is free, and a booking in a few taps. Hand material over with a scan or a search.",
          hint: "Fleet",
          screen: "fleet",
          spot: "tab-fleet",
          activeTab: "fleet",
        }
      : null,
    {
      key: "tab-chat",
      title: "Chat",
      body: "The team chat, with attachments and certificate requests, same as on the desktop.",
      hint: "Chat",
      screen: "chat",
      spot: "tab-chat",
      activeTab: "chat",
    },
    {
      key: "log-pick",
      title: "Logging a day: tap it",
      body: "In Time, each row is a day. Today is marked; tap any day to open it. The Today tile on the home board jumps straight here.",
      hint: "Tap a day",
      screen: "time",
      spot: "today-row",
      activeTab: "time",
    },
    {
      key: "log-fill",
      title: "Set Start and Stop",
      body: "Tap a box for the time picker. In a hurry? Standard day fills 09:00 to 17:54 with a 30 minute break, and Compensate day tops up a short day from your bank.",
      hint: "Tap to set",
      screen: "day-empty",
      spot: "start-stop",
      activeTab: "time",
    },
    {
      key: "log-type",
      title: "Vacation, holiday, sick",
      body: "Below the quick fills, mark the day as vacation, a public holiday or sick leave instead. Those days need no times.",
      hint: "Quick fills",
      screen: "day-filled",
      spot: "quick-fill",
      activeTab: "time",
    },
    {
      key: "log-save",
      title: "Save",
      body: "The Save button shows the net hours before you commit. Your week total and overtime bank update right away.",
      hint: "Done",
      screen: "day-filled",
      spot: "save",
      activeTab: "time",
    },
    {
      key: "install-safari",
      title: "Install it: open flya.space in Safari",
      body: "On your iPhone, open flya.space in Safari and sign in. Then tap the Share button in the bottom bar.",
      hint: "Share",
      screen: "safari",
      spot: "share-button",
      activeTab: null,
    },
    {
      key: "install-add",
      title: "Add to Home Screen",
      body: "Scroll the share sheet a little and tap \"Add to Home Screen\", then Add in the top right.",
      hint: "Tap this",
      screen: "share-sheet",
      spot: "add-to-home",
      activeTab: null,
    },
    {
      key: "install-done",
      title: "Open it from the Home Screen",
      body: "Flya Space now opens full screen like a native app. Notifications only work from this icon, not from a Safari tab.",
      hint: "Your app",
      screen: "home-screen",
      spot: "app-icon",
      activeTab: null,
    },
  ];
  return steps.filter((step): step is PhoneTourStep => step !== null);
}
