import { vi } from "vitest";
import { createFakeSupabase, resetFakeIds, type FakeUser, type Tables } from "./fake-supabase";

/**
 * Runs the real `/api/fleet` route handlers against an in-memory database.
 *
 * What is real: the route module, its zod validation, the dispatch switch,
 * every authorization check, every handler, `lib/fleet-queries`, and the whole
 * board assembly. What is faked: the Supabase client (see `fake-supabase.ts`)
 * and the signed-in user.
 *
 * Each call re-imports the route with `vi.resetModules()`, which matters for
 * more than hygiene: the route's rate limiter and the user-name cache both keep
 * module-level state, and without a reset one test's writes would count against
 * the next test's rate limit and one test's users would leak into another's
 * board.
 */

export type HarnessOptions = {
  /** The signed-in user. `null` means nobody is signed in. */
  viewer: FakeUser | null;
  /** Seed rows, by table name. Any table a handler touches must be present. */
  tables: Tables;
  /** Every user the board can resolve a display name for. Defaults to [viewer]. */
  users?: FakeUser[];
  /** Emails treated as admins (ADMIN_EMAILS). */
  adminEmails?: string[];
  /** Tables whose every query fails, for exercising error paths. */
  failTables?: string[];
  /**
   * What the server thinks "now" is. Defaults to a fixed date so that
   * date-sensitive rules — the booking horizon, "that day is already past",
   * overdue — assert the same thing forever. Without this the suite would
   * quietly start failing the day the fixtures drift into the past.
   */
  now?: string;
};

/** The frozen clock every test runs against unless it says otherwise. */
export const NOW = "2026-09-14T09:00:00.000Z";
/** `NOW` as a date key, for building fixtures relative to it. */
export const TODAY = "2026-09-14";

export type HarnessResult = {
  status: number;
  body: Record<string, unknown>;
  /** Final state of the in-memory tables, for asserting on what was written. */
  tables: Tables;
  /** Every query the handlers ran, as `table:verb`, in order. */
  queries: string[];
};

const EMPTY_TABLES: Tables = {
  fleet_assets: [],
  fleet_reservations: [],
  fleet_asset_events: [],
  fleet_holder_aliases: [],
  fleet_holder_directory: [],
  fleet_settings: [],
};

/** Seeds every table the module reads, so an unseeded table is a real bug. */
export function withDefaultTables(tables: Tables): Tables {
  return { ...structuredClone(EMPTY_TABLES), ...tables };
}

async function call(
  method: "GET" | "POST",
  url: string,
  body: unknown,
  options: HarnessOptions,
): Promise<HarnessResult> {
  const queries: string[] = [];
  const fake = createFakeSupabase(withDefaultTables(options.tables), {
    users: options.users ?? (options.viewer ? [options.viewer] : []),
    failTables: options.failTables,
    onQuery: (table, verb) => queries.push(`${table}:${verb}`),
  });

  vi.resetModules();
  resetFakeIds();

  // Only Date is faked: faking timers wholesale would stall the awaits below.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(options.now ?? NOW));

  process.env.ADMIN_EMAILS = (options.adminEmails ?? []).join(",");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key";

  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: options.viewer ?? null },
          error: options.viewer ? null : { message: "no session" },
        }),
      },
    }),
  }));

  const route = await import("@/app/api/fleet/route");
  const request = new Request(`https://fleet.test${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  try {
    const response = method === "GET" ? await route.GET(request) : await route.POST(request);
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body: parsed, tables: fake.__tables, queries };
  } finally {
    vi.useRealTimers();
  }
}

/** `GET /api/fleet`. `query` is appended verbatim, e.g. `?start=2026-09-14`. */
export function get(options: HarnessOptions, query = ""): Promise<HarnessResult> {
  return call("GET", `/api/fleet${query}`, undefined, options);
}

/** `POST /api/fleet` with one action payload. */
export function post(
  options: HarnessOptions,
  body: Record<string, unknown>,
  query = "",
): Promise<HarnessResult> {
  return call("POST", `/api/fleet${query}`, body, options);
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

export const ADMIN: FakeUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@flyability.com",
  user_metadata: { full_name: "Ada Admin" },
  identities: [{ provider: "google", identity_data: { full_name: "Ada Admin" } }],
  app_metadata: { role: "sales" },
};

export const MEMBER: FakeUser = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "member@flyability.com",
  user_metadata: { full_name: "Mel Member" },
  identities: [{ provider: "google", identity_data: { full_name: "Mel Member" } }],
  app_metadata: { role: "eu_pilot" },
};

export const OTHER: FakeUser = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "other@flyability.com",
  user_metadata: { full_name: "Otto Other" },
  identities: [{ provider: "google", identity_data: { full_name: "Otto Other" } }],
  app_metadata: { role: "us_pilot" },
};

/** Signed in, but no admin has assigned a role yet: sees only the role gate. */
export const HELD: FakeUser = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "new@flyability.com",
  user_metadata: { full_name: "Nia New" },
  identities: [{ provider: "google", identity_data: { full_name: "Nia New" } }],
  app_metadata: {},
};

export const ASSET_ID = "aaaaaaaa-0000-4000-8000-000000000001";
/** Must be a real UUID: the route validates ids with zod before doing anything. */
export const RESERVATION_ID = "bbbbbbbb-0000-4000-8000-000000000001";

/** One bookable unit in the shared pool. */
export function pooledAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    name: "SVA-257",
    serial_number: null,
    category: "drone",
    model: "Elios 3",
    owner_group: "EMEA",
    status: "available",
    pooled: true,
    active: true,
    home_location: "EMEA",
    current_location: "EMEA",
    current_holder_user_id: null,
    current_holder_label: null,
    location_confirmed_at: null,
    notes: null,
    ...overrides,
  };
}

/** One reservation. Defaults to a live booking held by MEMBER. */
export function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: RESERVATION_ID,
    asset_id: ASSET_ID,
    user_id: MEMBER.id,
    holder_label: null,
    source: "app",
    start_date: "2026-09-14",
    end_date: "2026-09-16",
    status: "reserved",
    purpose: null,
    destination: null,
    picked_up_at: null,
    returned_at: null,
    returned_on: null,
    created_at: "2026-09-10T08:00:00.000Z",
    ...overrides,
  };
}
