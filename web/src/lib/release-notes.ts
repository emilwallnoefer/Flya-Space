/**
 * Curated, human-readable release notes shown in the dashboard "What's new"
 * popup. Returning users see the latest entry once per version; the popup is
 * keyed by `version` in localStorage, so bumping `version` is what re-triggers
 * it. Brand-new users never see it (the first-launch prompt covers them).
 *
 * Newest first — the first entry is treated as the current release. Keep
 * `highlights` short (a few words each); this is a glance, not a changelog.
 */
export type ReleaseNote = {
  /** Stable id for this release; bump it to re-show the popup. */
  version: string;
  /** Human date for the header. */
  date: string;
  /** One short headline. */
  title: string;
  /** A few words per change. */
  highlights: string[];
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "2026-10-09-home-screen",
    date: "Oct 9, 2026",
    title: "Flya Space on your phone",
    highlights: [
      "Add it to your iPhone home screen: in Safari, tap Share → Add to Home Screen.",
      "It opens full screen with its own icon, like an app. Sign in once inside it.",
      "On phones, a tab bar along the bottom switches modules, and swiping back returns home.",
      "Team chat fills the screen on phones and stays above the keyboard.",
      "Typing no longer zooms the page in, and nothing hides behind the home bar.",
    ],
  },
  {
    version: "2026-10-09-faster-sheets",
    date: "Oct 9, 2026",
    title: "Faster sheets, today stands out",
    highlights: [
      "Mission planning and Fleet management start loading sooner.",
      "They open on today's row or column even on the first load.",
      "Today's day card in the Time Tracker has a red outline and a Today badge.",
    ],
  },
  {
    version: "2026-10-06-flya-space",
    date: "Oct 6, 2026",
    title: "We're now Flya Space",
    highlights: [
      "Flya Allrounder is now called Flya Space — same app, same address.",
      "Nothing to do on your side: your data, links and bookmarks all keep working.",
    ],
  },
  {
    version: "2026-10-06-sheets-today",
    date: "Oct 6, 2026",
    title: "Planning sheets open on today",
    highlights: [
      "Mission planning and Fleet management jump straight to today.",
      "Both sheets are shown at 80%, so more of the grid fits.",
    ],
  },
  {
    version: "2026-10-05-mission-planning",
    date: "Oct 5, 2026",
    title: "Mission planning, Fleet management and Road Days, inside the app",
    highlights: [
      "Pilots and admins: new Mission planning, Fleet management and Road Days cards on the workspace home.",
      "The live Google Sheets and the Road Days form, full screen — saved to Google under your name.",
      "Blank? Tap \"Not loading?\" at the top right to sign in to Google or open it in a new tab.",
    ],
  },
  {
    version: "2026-10-05-field-stats",
    date: "Oct 5, 2026",
    title: "Field stats, and Fleet on the home screen",
    highlights: [
      "Scroll down on the workspace home: live charts from the mission planning sheet.",
      "Regions, POCs and trainings per pilot, and travel days.",
      "All of 2026 or one month at a time; click a name to see what it counts.",
      "Fleet also gets its own card on the workspace home.",
      "Team chat is back as the pill in the bottom-right corner; Settings stays in the menu.",
    ],
  },
  {
    version: "2026-10-02-elios-flight-modes",
    date: "Oct 2, 2026",
    title: "The drone game, reworked — fresh leaderboard",
    highlights: [
      "Tight spaces fly in Assist, open voids in ATTI — and dust can force ATTI on you.",
      "Things go wrong like on a real inspection: drafts, lost signal with Return-to-Signal, dust, darkness, swinging cables, gas, radiation.",
      "Grab ↻ Repeat Flight for a few seconds of autopilot, ✦ the dust-proof light to see through.",
      "One touch ends the run — only a rope in the motors can be shaken off. New rules, new board.",
    ],
  },
  {
    version: "2026-10-02-elios-harder",
    date: "Oct 2, 2026",
    title: "The drone game got harder — fresh leaderboard",
    highlights: [
      "The run speeds up faster and keeps getting quicker the longer you survive.",
      "Until 2 m/s the cage bounces off whatever it hits. After that, contact is a crash.",
      "New rules, new board: the leaderboard starts from zero.",
    ],
  },
  {
    version: "2026-10-02-idle-energy",
    date: "Oct 2, 2026",
    title: "Easier on your battery",
    highlights: [
      "Leaving the dashboard open no longer keeps your computer busy.",
      "The underwater background now holds still — same look, no drifting or bubbles.",
      "The drone game rests while you're not flying, and stops when it's scrolled out of view.",
    ],
  },
  {
    version: "2026-10-02-flight-data-drive",
    date: "Oct 2, 2026",
    title: "Flight data links go through Google Drive",
    highlights: [
      "Paste a Google Drive link in the flight-data field — the field now says so.",
      "Mail tracking counts training links and Drive flight-data links. Other links still work in the mail but aren't counted.",
      "Tracked links you've already sent keep working.",
    ],
  },
  {
    version: "2026-09-28-faster-launch",
    date: "Sep 28, 2026",
    title: "The dashboard opens faster",
    highlights: [
      "Team chat has moved into the ☰ menu — open it from there. It only connects while it's open.",
      "Your home screen appears first; Fleet and Admin load their data when you open them.",
      "A first visit downloads less than half the code it used to.",
    ],
  },
  {
    version: "2026-09-28-fleet-weeks",
    date: "Sep 28, 2026",
    title: "The Fleet calendar shows whole weeks",
    highlights: [
      "The calendar always starts on Monday, so on a Friday you still see the whole week.",
      "It moves on to the next week when Monday comes, and ← / → step one week at a time.",
      "Every day column is the same width again.",
    ],
  },
  {
    version: "2026-09-23-elios-offline",
    date: "Sep 23, 2026",
    title: "Lost your connection? Fly instead",
    highlights: [
      "When a page can't load offline, you get the drone game instead of the browser's error.",
      "If the connection drops while the dashboard is open, the game pops up in the corner.",
      "Scores flown offline are saved and go on the leaderboard as soon as you're back online.",
    ],
  },
  {
    version: "2026-09-23-elios-speed",
    date: "Sep 23, 2026",
    title: "The game speeds up the longer you last",
    highlights: [
      "The drone accelerates as a run goes on — same gaps, less time to read them.",
      "It starts at the old pace, so the first obstacles are what they always were, and tops out a little over a minute in.",
      "Ground speed now shows in the corner, next to the clearance readout.",
      "The pair of web frames in a ballast tank is a slalom again rather than a wall: the second hole now sits within a flap of the first, and the bay between them is wider.",
    ],
  },
  {
    version: "2026-09-22-elios-confined-spaces",
    date: "Sep 22, 2026",
    title: "The game now flies real confined spaces",
    highlights: [
      "Five spaces the Elios 3 actually inspects — boiler, ballast tank, mine stope, sewer, storage tank — each behind a real photograph from flyability.com.",
      "You dodge what a pilot meets in them: superheater pendants, web frames, hang-ups in an ore pass, root intrusions, agitators.",
      "The drone is the only light down there — it throws a beam, casts shadows and catches every edge it passes.",
      "Each space is sealed off by a bulkhead; fly the manhole and you are in the next one.",
      "Crash and it tells you what you hit, and where.",
    ],
  },
  {
    version: "2026-09-15-elios-game",
    date: "Sep 15, 2026",
    title: "Something to do while the draft writes",
    highlights: [
      "Generating a mail now shows a small game — fly the Elios 3 through gates, spikes and saw blades while you wait.",
      "There is a workspace leaderboard: first name and best score, everyone in one list.",
      "Same game greets a brand-new account that is still waiting for an admin to assign it a role.",
    ],
  },
  {
    // Shares 2026-09-15 with the fleet-location release below, so the id
    // carries its own suffix — reusing that one would hide this popup from
    // everyone who already dismissed it.
    version: "2026-09-15-role-assignment",
    date: "Sep 15, 2026",
    title: "New accounts are set up for you",
    highlights: [
      "Signing in for the first time no longer asks you to pick your own profile — you land on a short screen saying your account is waiting for access.",
      "An admin is told the moment you arrive, and once they set your role the workspace opens on your next sign-in.",
      "Nobody can put themselves in the wrong profile any more, so the modules you see are the ones you are meant to have.",
    ],
  },
  {
    version: "2026-09-15-holder-claims",
    date: "Sep 15, 2026",
    title: "Every claimed name, in one table",
    highlights: [
      "Admin → Holder claims lists who claimed which fleet name, when, and how much material came with it.",
      "A claim under a name that does not look like the claimant is flagged in the table and mailed to admins — the claim still goes through, because the old sheet spelled everyone differently.",
      "Admins can reassign a name to the right person, or release it back to unclaimed; the bookings and assigned units follow either way.",
      "Every correction is written into the unit's history and the audit log.",
    ],
  },
  {
    version: "2026-09-15-fleet-lausanne",
    date: "Sep 15, 2026",
    title: "The pool has an address",
    highlights: [
      "Material that used to sit at “EMEA” now says Pilots HQ Lausanne — a place you can actually go and pick it up.",
      "The old label is gone from every unit, so it is no longer offered when you set a location.",
    ],
  },
  {
    // Several releases share 2026-09-14, so every id carries a suffix: the
    // popup is keyed by this string in localStorage, and a reused one would
    // hide the release from everyone who already saw the other.
    version: "2026-09-14-fleet-material",
    date: "Sep 14, 2026",
    title: "See who has what, at a glance",
    highlights: [
      "Material is now a card per unit, each carrying the colour of the person holding it — the same colour they have in the calendar.",
      "New filter next to the type filter: show only one person’s material, or only what nobody has.",
      "Adding and editing material is one dialog, with the same fields both times.",
      "Type, status, location, owner group and “assigned to” are now chosen from what the fleet already uses, instead of typed out.",
      "Admins can set where a unit actually is, from Manage.",
      "Everyone now has a colour of their own — no two people share one, and the similar-looking pairs are gone.",
      "Material assigned to one person no longer asks for a location, since it travels with them.",
      "Reminders, unclaimed names, standings and removed units fold away under the fleet list.",
    ],
  },
  {
    version: "2026-09-14-stay-put",
    date: "Sep 14, 2026",
    title: "Reloading keeps you where you were",
    highlights: [
      "Refresh no longer drops you back on the workspace home.",
      "The open module — and the section inside Admin or Settings — comes back with the page.",
      "The address bar now shows the view, so you can bookmark or share it.",
    ],
  },
  {
    version: "2026-09-14-fleet-ui",
    date: "Sep 14, 2026",
    title: "Fleet, tidied up",
    highlights: [
      "Clicking a booking now opens it as a dialog, instead of far below the calendar.",
      "Today and the weekends are shaded down the whole board.",
      "The type filter and search now sit above both the calendar and the material list, so a filter is always visible.",
      "Your material leads with “due back tomorrow” rather than a date to work out.",
      "Admins can set a unit to in repair or retired from Manage → Edit.",
    ],
  },
  {
    // Distinct from the "2026-09-14" Bunker entry below: the popup is keyed by
    // this string in localStorage, so reusing it would hide this release from
    // everyone who already saw that one.
    version: "2026-09-14-fleet",
    date: "Sep 14, 2026",
    title: "Fleet is faster, and the calendar can hide old bookings",
    highlights: [
      "Booking, picking up and bringing back material is roughly four times quicker.",
      "New “Past bookings” tick box above the calendar — untick it to hide finished bookings.",
      "Your choice is remembered on this device.",
      "Material returned early now ends on the day it came back, instead of running to the booked date.",
    ],
  },
  {
    version: "2026-09-14",
    date: "Sep 14, 2026",
    title: "Bunker is now a Lausanne flight site",
    highlights: [
      "Pre-mail: pick “Bunker” as the asset for any training day.",
      "The agenda reads “Bunker in Lausanne”; no extra safety gear is requested.",
    ],
  },
  {
    version: "2026-09-02",
    date: "Sep 2, 2026",
    title: "Fleet (beta): book material by the day",
    highlights: [
      "New “Fleet” tab in the menu — replaces the fleet-management spreadsheet.",
      "Click days in the calendar to reserve a drone, payload or tether — a two-day job books two days.",
      "Calendar shows only the shared pool; assigned units are listed under Material.",
      "Each person has their own colour, so you can see at a glance who has what.",
      "Every unit shows where it is now and how long since anyone confirmed it.",
      "Automatic reminders the day before it is due, and while it is overdue.",
      "Returning on time builds a reliability score; it sets your booking range and queue position.",
    ],
  },
  {
    version: "2026-09-01",
    date: "Sep 1, 2026",
    title: "Draft links are clickable again",
    highlights: [
      "Resource links in generated drafts render as real links, not raw markdown.",
      "Affects every link block: slide decks, use-case trainings, software & learning resources, add-ons.",
    ],
  },
  {
    version: "2026-08-07",
    date: "Aug 7, 2026",
    title: "Request certificates from Team Chat",
    highlights: [
      "“Changes” in Team Chat is now “Certificate”.",
      "Opens a short form: customer account, participants, training date, Intro/AIIM, and location.",
      "The trainer is filled in from whoever sends it.",
      "Admins get an email with a copy-ready summary; the request also lands in chat.",
    ],
  },
  {
    version: "2026-07-30",
    date: "Jul 30, 2026",
    title: "AI brief mails greet you once",
    highlights: [
      "Fixed the duplicated welcome line in AI brief drafts.",
      "A greeting written by the AI is now dropped, whether on its own line or inside the first sentence.",
    ],
  },
  {
    version: "2026-07-26-mail-tracking-post-only",
    date: "Jul 26, 2026",
    title: "Mail Tracking ignores pre-training mails",
    highlights: [
      "Pre-training mails no longer appear in Mail Tracking — they carry no links to track.",
      "Send counts, recipients, timeline and the type donut now reflect trackable mails only.",
      "Click rates read true instead of being diluted by untrackable sends.",
    ],
  },
  {
    version: "2026-07-25-flya-space-domain",
    date: "Jul 25, 2026",
    title: "New home: flya.space",
    highlights: [
      "The dashboard now lives at flya.space — update your bookmarks.",
      "You were signed out once during the move; the old address still works.",
      "Tracked links in new emails use flya.space; links in already-sent emails keep working.",
      "Reminder emails now come from noreply@flya.space.",
    ],
  },
  {
    version: "2026-07-20-ui-completion-pass",
    date: "Jul 20, 2026",
    title: "Cleaner notifications, mobile tables & CSV export",
    highlights: [
      "Unified, consistent toast notifications across the day logger and team chat, keeping chat's Undo.",
      "Admin time and users tables, plus mail-tracking recipients, now read cleanly on phones.",
      "Better keyboard access: focus stays inside the day editor and chat popup, and returns where it started on close.",
      "Export admin time overview, mail recipients, and clicks to CSV with one tap.",
    ],
  },
  {
    version: "2026-07-17-ui-polish",
    date: "Jul 17, 2026",
    title: "Snappier, cleaner interface",
    highlights: [
      "Modules open noticeably faster, with a crisper shared motion curve across buttons and cards.",
      "The navigation menu pops in smoothly, and its icon morphs open and closed.",
      "Module cards get a layered, machined look with a kinetic Continue affordance.",
      "Smooth scrolling, a proper “page not found” screen, and a keyboard skip-to-content link.",
      "Small copy and icon cleanups throughout the dashboard.",
    ],
  },
  {
    version: "2026-07-16-travel-personal-columns",
    date: "Jul 16, 2026",
    title: "Travel info: set your own columns",
    highlights: [
      "The travel sheet has one column group per person, so travel info now needs your personal columns.",
      "Settings → Travel mapping: enter your name's column and the two right of it, save — it applies immediately.",
      "Until then, the day editor shows exactly what's missing.",
    ],
  },
  {
    version: "2026-07-16-travel-mapping-reset",
    date: "Jul 16, 2026",
    title: "Travel mapping: reset & clearer diagnostics",
    highlights: [
      "Settings → Travel mapping has a “Reset to defaults” button — clears your personal mapping (never touches the Google Sheet).",
      "The travel debug box now shows exactly which columns, range, and tab your account reads.",
    ],
  },
  {
    version: "2026-07-16-day-card-fade-in",
    date: "Jul 16, 2026",
    title: "Smoother week open",
    highlights: [
      "Day cards now fade in and drop into place when the Time Tracker opens.",
    ],
  },
  {
    version: "2026-07-16-travel-info-diagnostics",
    date: "Jul 16, 2026",
    title: "Travel info now explains itself",
    highlights: [
      "If travel data can't be loaded, the day editor now says why.",
      "Shows the connected Google account and a concrete fix (reconnect, share the sheet, …).",
    ],
  },
  {
    version: "2026-07-16-public-holiday-day-type",
    date: "Jul 16, 2026",
    title: "New day type: Public Holiday",
    highlights: [
      "The Day Logger now has four day types: Normal, Vacation, Public Holiday, and Sick leave.",
      "“Holiday” is now called Vacation — existing entries keep working as before.",
      "Both Vacation and Public Holiday are excused from your target; hours logged count as overtime.",
    ],
  },
  {
    version: "2026-07-16-composer-mode-switch",
    date: "Jul 16, 2026",
    title: "Mail mode switch, right in the composer",
    highlights: [
      "Switch between Guided and AI brief at the top of the Mail Composer.",
      "The old Settings → Mail generation page is gone — one less detour.",
      "Your choice still saves to your account, like before.",
    ],
  },
  {
    version: "2026-07-02-security-events",
    date: "Jul 2, 2026",
    title: "Security event log & breach alerts",
    highlights: [
      "New Admin → Security tab logs blocked admin-access attempts and other security events.",
      "Admins get an email when someone repeatedly probes admin-only areas.",
      "Toggle the alerts and tune the threshold right from the Security tab.",
    ],
  },
  {
    version: "2026-07-02-chat-unread",
    date: "Jul 2, 2026",
    title: "Team chat: unread badge + popup fix",
    highlights: [
      "A red badge on the chat button now also counts messages received while you were away.",
      "The chat button no longer covers this popup — it moves out of the way.",
    ],
  },
  {
    version: "2026-07-02-ui-polish",
    date: "Jul 2, 2026",
    title: "A faster, more consistent interface",
    highlights: [
      "Keyboard focus is now clearly visible on every button and field.",
      "Ambient underwater motion pauses if your system prefers reduced motion.",
      "Settings and Admin load on demand — the dashboard starts lighter.",
      "Small labels are slightly larger and spacing is more uniform throughout.",
    ],
  },
  {
    version: "2026-07-01-admin",
    date: "Jul 1, 2026",
    title: "Admin panel, reorganised",
    highlights: [
      "New left-nav layout matching Settings — one section per job.",
      "Overview adds a mail click-through stat; Users & roles gains search.",
      "Reminder controls and the Mail brief model moved to clearer homes.",
      "New Audit log: who changed roles, paused reminders, or switched the model.",
    ],
  },
  {
    version: "2026-07-01",
    date: "Jul 1, 2026",
    title: "New: AI brief mode for emails",
    highlights: [
      "Settings → Mail generation: switch the composer to AI brief mode.",
      "Write a short brief; Claude drafts the email in your voice.",
      "After generating, “Edit assets” to add/remove links without re-running the AI.",
      "Asset links stay exact and click-tracked. Guided mode unchanged.",
    ],
  },
  {
    version: "2026-06-30",
    date: "Jun 30, 2026",
    title: "Post-training Add-ons + refreshed resources",
    highlights: [
      "New “Add on’s” section: paste a link to the collected flight data.",
      "Cleaner after-training asset titles and descriptions (EN/DE/FR).",
    ],
  },
  {
    version: "2026-06-25",
    date: "Jun 25, 2026",
    title: "Cleaner compensation copy",
    highlights: [
      "Time Tracker “Copy Text” now copies plain date / travel / hours lines.",
    ],
  },
];

/** The current release — what the "What's new" popup describes. */
export const LATEST_RELEASE: ReleaseNote = RELEASE_NOTES[0];
