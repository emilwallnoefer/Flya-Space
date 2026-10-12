import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The appearance route must do two things after writing user_metadata: reissue
 * the session (the root layout reads the appearance from the access token's
 * claims, which `updateUser` leaves stale) and put the reissued cookies on its
 * response (a route handler's `cookies()` writes are what reach the browser).
 * Without either, the next page load SSRs the old skin and the pre-hydration
 * bootstrap copies it back over localStorage — the setting "doesn't save".
 */

const auth = {
  getUser: vi.fn(),
  updateUser: vi.fn(),
  refreshSession: vi.fn(),
};
let setAllHook: ((c: { name: string; value: string; options?: object }[]) => void) | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: typeof setAllHook } }) => {
    setAllHook = opts.cookies.setAll;
    return { auth };
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));

const { POST } = await import("./route");

const member = { id: "u1", app_metadata: { role: "sales" }, user_metadata: {} };

function post(body: unknown) {
  return POST(new Request("http://x/api/settings/appearance", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: member } });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.refreshSession.mockImplementation(async () => {
    setAllHook?.([{ name: "sb-token", value: "fresh", options: { path: "/" } }]);
    return { error: null };
  });
});

describe("POST /api/settings/appearance", () => {
  it("saves the skin, reissues the session and sends the new cookie back", async () => {
    const res = await post({ theme: "dark" });
    expect(res.status).toBe(200);
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { appearance_theme: "dark" } });
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(res.headers.get("set-cookie")).toContain("sb-token=fresh");
  });

  it("still reports success when the refresh fails — the metadata is saved", async () => {
    auth.refreshSession.mockResolvedValue({ error: { message: "refresh_token_not_found" } });
    const res = await post({ theme: "light", accent: "blue" });
    expect(res.status).toBe(200);
    expect(auth.updateUser).toHaveBeenCalledWith({
      data: { appearance_theme: "light", appearance_accent: "blue" },
    });
  });

  it("rejects an unknown skin without touching the account", async () => {
    const res = await post({ theme: "neon" });
    expect(res.status).toBe(400);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request and a held account", async () => {
    auth.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await post({ theme: "dark" })).status).toBe(401);
    auth.getUser.mockResolvedValueOnce({ data: { user: { ...member, app_metadata: {} } } });
    expect((await post({ theme: "dark" })).status).toBe(403);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
