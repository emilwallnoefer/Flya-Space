import type { ModuleKey } from "@/lib/dashboard-modules";

/**
 * The desktop's one-time walkthrough of the phone app: which screens it
 * shows, in what order, and what each callout says. Pure data so the order
 * and the role clamp are testable; `components/phone-tour.tsx` draws it.
 */

/** What the mock iPhone shows for a step. */
export type PhoneScreen = "home" | "time" | "mail" | "fleet" | "chat" | "day-empty" | "day-filled" | "safari" | "share-sheet" | "home-screen";

/**
 * Which part of the screen the spotlight ring points at. Several elements
 * may carry the same spot (the Google tiles); the ring wraps them all.
 */
export type PhoneSpot =
  | "greeting"
  | "avatar"
  | "tile-overtime"
  | "tile-today"
  | "card-with-you"
  | "tile-mail"
  | "tiles-sheets"
  | "tabbar"
  | "tab-time"
  | "tab-mail"
  | "tab-fleet"
  | "tab-chat"
  | "today-row"
  | "start-stop"
  | "quick-fill"
  | "day-type"
  | "share-button"
  | "add-to-home"
  | "app-icon";

export type PhoneTourStep = {
  key: string;
  /** Short heading in the callout. */
  title: string;
  /** One to three sentences. */
  body: string;
  screen: PhoneScreen;
  spot: PhoneSpot;
  /** Which tab reads as active in the mock tab bar. */
  activeTab: "time" | "mail" | "fleet" | "chat" | null;
};

export const PHONE_TOUR_SEEN_KEY = "ma_phone_tour_seen_v1";

/**
 * The steps for a role. Only the modules this role has on the desktop are
 * on its phone too, so Mail, Fleet and the Google tiles drop out of both
 * the drawing and the steps when the role lacks them.
 */
export function phoneTourSteps(availableModules: ModuleKey[]): PhoneTourStep[] {
  const has = (key: ModuleKey) => availableModules.includes(key);
  const hasMail = has("mail");
  const hasFleet = has("fleet");
  const hasTime = has("time");
  const sheetCount = (["planning", "fleetsheet", "roaddays"] as const).filter(has).length;
  const tabCount = 1 + (hasTime ? 1 : 0) + (hasMail ? 1 : 0) + (hasFleet ? 1 : 0);
  const steps: Array<PhoneTourStep | null> = [
    {
      key: "welcome",
      title: "Flya Space on your iPhone",
      body: "The same account and the same data, laid out for one hand. This home board is what opens first; here is what each part does.",
      screen: "home",
      spot: "greeting",
      activeTab: null,
    },
    {
      key: "avatar",
      title: "Account and More",
      body: "Your initial opens Settings, Team in the field, What's new and sign out. It sits in the top right of every screen.",
      screen: "home",
      spot: "avatar",
      activeTab: null,
    },
    hasTime
      ? {
          key: "tile-overtime",
          title: "Overtime",
          body: "Your overtime bank, through the last day you logged. Tap it to open the Time tracker.",
          screen: "home",
          spot: "tile-overtime",
          activeTab: null,
        }
      : null,
    hasTime
      ? {
          key: "tile-today",
          title: "Today",
          body: "The hours logged today, or Weekend, Vacation, Holiday or Sick when there is nothing to log. Tap it to log today straight away.",
          screen: "home",
          spot: "tile-today",
          activeTab: null,
        }
      : null,
    hasFleet
      ? {
          key: "card-with-you",
          title: "With you",
          body: "The material booked to you and the day it is due back. Book material starts a new booking.",
          screen: "home",
          spot: "card-with-you",
          activeTab: null,
        }
      : null,
    hasMail
      ? {
          key: "tile-mail",
          title: "New mail",
          body: "Starts a training mail: pick the type, fill the brief, and it lands as a Gmail draft. Nothing is ever sent on its own.",
          screen: "home",
          spot: "tile-mail",
          activeTab: null,
        }
      : null,
    sheetCount > 0
      ? {
          key: "tiles-sheets",
          title: sheetCount === 1 ? "Your Google sheet" : "Your Google sheets",
          body: "The left part opens the sheet inside the app. The ↗ opens it in the Google app with your work account, which is the way in when the sheet stays blank in Safari.",
          screen: "home",
          spot: "tiles-sheets",
          activeTab: null,
        }
      : null,
    {
      key: "tabs",
      title: tabCount === 1 ? "One button along the bottom" : `${tabCount === 4 ? "Four" : tabCount === 3 ? "Three" : "Two"} buttons along the bottom`,
      body: "Every module is one tap away, in thumb reach. The back chevron at the top left returns to the home board.",
      screen: "home",
      spot: "tabbar",
      activeTab: null,
    },
    hasTime
      ? {
          key: "tab-time",
          title: "Time",
          body: "Your week as a plain list, with this week's hours and your overtime bank on top. Open a day to log it.",
          screen: "time",
          spot: "tab-time",
          activeTab: "time",
        }
      : null,
    hasMail
      ? {
          key: "tab-mail",
          title: "Mail",
          body: "Write a training mail from your phone: type, industry, customer, recipients, then a Gmail draft.",
          screen: "mail",
          spot: "tab-mail",
          activeTab: "mail",
        }
      : null,
    hasFleet
      ? {
          key: "tab-fleet",
          title: "Fleet",
          body: "What is with you, what is free, and a booking in a few taps.",
          screen: "fleet",
          spot: "tab-fleet",
          activeTab: "fleet",
        }
      : null,
    {
      key: "tab-chat",
      title: "Chat",
      body: "The team chat, with attachments and certificate requests, same as on the desktop.",
      screen: "chat",
      spot: "tab-chat",
      activeTab: "chat",
    },
    hasTime
      ? {
          key: "log-pick",
          title: "Logging a day: tap it",
          body: "In Time, each row is a day. Today is marked; tap any day to open it.",
          screen: "time",
          spot: "today-row",
          activeTab: "time",
        }
      : null,
    hasTime
      ? {
          key: "log-fill",
          title: "Start and Stop",
          body: "Tap a box for the time picker, set the break below, then Save at the bottom. The button shows the net hours before you commit.",
          screen: "day-empty",
          spot: "start-stop",
          activeTab: "time",
        }
      : null,
    hasTime
      ? {
          key: "log-quick",
          title: "Or fill the day with one tap",
          body: "Standard day sets 09:00 to 17:54 with a 30 minute break. Compensate day tops up a short day from your overtime bank. Both save on their own.",
          screen: "day-filled",
          spot: "quick-fill",
          activeTab: "time",
        }
      : null,
    hasTime
      ? {
          key: "log-type",
          title: "Vacation, holiday, sick",
          body: "Mark the day as vacation, a public holiday or sick leave instead. Those days need no times.",
          screen: "day-filled",
          spot: "day-type",
          activeTab: "time",
        }
      : null,
    {
      key: "install-safari",
      title: "Install it: open flya.space in Safari",
      body: "On your iPhone, open flya.space in Safari and sign in. Then tap the Share button in the bottom bar.",
      screen: "safari",
      spot: "share-button",
      activeTab: null,
    },
    {
      key: "install-add",
      title: "Add to Home Screen",
      body: "Scroll the share sheet a little, tap \"Add to Home Screen\", then Add in the top right.",
      screen: "share-sheet",
      spot: "add-to-home",
      activeTab: null,
    },
    {
      key: "install-done",
      title: "Open it from the Home Screen",
      body: "Flya Space now opens full screen like a native app. Notifications only work from this icon, not from a Safari tab.",
      screen: "home-screen",
      spot: "app-icon",
      activeTab: null,
    },
  ];
  return steps.filter((step): step is PhoneTourStep => step !== null);
}
