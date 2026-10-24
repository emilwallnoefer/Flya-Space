// @vitest-environment jsdom
/**
 * The phone's read-only data hooks: they show a loading state from the first
 * render that will fetch, land the data or the error, and refetch on a week
 * change or a reload — without ever fetching while disabled.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMonday, toDateKey } from "@/lib/date";
import type { AdminListedUser, AdminTimeOverview } from "@/lib/admin-queries";
import { useAdminTimeOverview, useAdminUsers } from "./admin/use-admin-data";
import { useFieldStats } from "./team/use-field-stats";

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
let calls: string[];

beforeEach(() => {
  replies = {};
  calls = [];
  vi.stubGlobal("fetch", (input: string) => {
    calls.push(input);
    const path = input.split("?")[0];
    const reply = replies[path] ?? { status: 500, body: { error: "no reply" } };
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const thisWeek = toDateKey(getMonday());
const overviewFor = (week: string) => ({ week_start: week, rows: [] }) as unknown as AdminTimeOverview;

describe("useFieldStats", () => {
  it("never fetches while disabled and is not loading", () => {
    const { result } = renderHook(() => useFieldStats(false));
    expect(result.current.loading).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("is loading on the first render, then lands the stats", async () => {
    replies["/api/field-stats"] = { status: 200, body: { stats: { regions: [] }, fetchedAt: "t", stale: false } };
    const { result } = renderHook(() => useFieldStats(true));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats).toEqual({ regions: [] });
    expect(result.current.error).toBeNull();
  });

  it("starts loading on the render that enables it", async () => {
    replies["/api/field-stats"] = { status: 200, body: { stats: {}, fetchedAt: "t", stale: false } };
    const { result, rerender } = renderHook(({ on }) => useFieldStats(on), { initialProps: { on: false } });
    rerender({ on: true });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(calls).toHaveLength(1);
  });

  it("shows the server's error and clears it on a successful reload", async () => {
    replies["/api/field-stats"] = { status: 503, body: { error: "Sheet unavailable" } };
    const { result } = renderHook(() => useFieldStats(true));
    await waitFor(() => expect(result.current.error).toBe("Sheet unavailable"));
    replies["/api/field-stats"] = { status: 200, body: { stats: {}, fetchedAt: "t", stale: false } };
    await act(() => result.current.reload());
    expect(result.current.error).toBeNull();
    expect(result.current.stats).toEqual({});
  });
});

describe("useAdminTimeOverview", () => {
  it("does not refetch the week the server already sent", () => {
    const { result } = renderHook(() => useAdminTimeOverview(overviewFor(thisWeek)));
    expect(result.current.loading).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("loads another week from the render that switches to it", async () => {
    const other = "2026-01-05";
    replies["/api/admin/time-overview"] = { status: 200, body: overviewFor(other) };
    const { result } = renderHook(() => useAdminTimeOverview(overviewFor(thisWeek)));
    act(() => result.current.setWeekStart(other));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.overview?.week_start).toBe(other);
    expect(calls).toEqual([`/api/admin/time-overview?week=${other}`]);
  });

  it("fetches at mount without a server week, and reports a failure", async () => {
    replies["/api/admin/time-overview"] = { status: 403, body: { error: "Forbidden" } };
    const { result } = renderHook(() => useAdminTimeOverview(null));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Forbidden");
  });
});

describe("useAdminUsers", () => {
  const users = [{ id: "u1" }] as unknown as AdminListedUser[];

  it("uses the server's list and never fetches", () => {
    const { result } = renderHook(() => useAdminUsers(users, true));
    expect(result.current.users).toBe(users);
    expect(result.current.loading).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("fetches once enabled when the server sent none", async () => {
    replies["/api/admin/users"] = { status: 200, body: { users } };
    const { result, rerender } = renderHook(({ on }) => useAdminUsers(null, on), { initialProps: { on: false } });
    expect(result.current.loading).toBe(false);
    expect(calls).toHaveLength(0);
    rerender({ on: true });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.users).toEqual(users);
  });
});
