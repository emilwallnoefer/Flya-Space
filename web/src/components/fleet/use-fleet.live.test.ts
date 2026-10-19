// @vitest-environment jsdom
/**
 * The live board: a "something changed" ping refetches the board quietly, a
 * burst of pings costs one request, and a refresh that was in flight when the
 * viewer's own write started never paints the pre-write board over it.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_REFRESH_DEBOUNCE_MS, useFleet } from "./use-fleet";
import type { FleetBoardResponse } from "./types";

let ping: (() => void) | null = null;
vi.mock("@/lib/fleet-live", () => ({
  subscribeToFleetChanges: (onChange: () => void) => {
    ping = onChange;
    return () => {
      ping = null;
    };
  },
}));

const START = "2026-10-19";

function boardNamed(tag: string): FleetBoardResponse {
  return {
    window_start: START,
    today: START,
    assets: [],
    reservations: [],
    standings: [],
    unclaimed_holders: [],
    me: { user_id: "u1" },
    tag,
  } as unknown as FleetBoardResponse;
}

/** What the server returns for the next GET; tests change it to model writes. */
let serverTag: string;
let getCount: number;
let pendingGets: Array<() => void>;
let holdGets: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  ping = null;
  serverTag = "initial";
  getCount = 0;
  pendingGets = [];
  holdGets = false;
  vi.stubGlobal("fetch", (_input: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      serverTag = "after-my-write";
      return Promise.resolve(
        new Response(JSON.stringify({ board: boardNamed(serverTag) }), { status: 200 }),
      );
    }
    getCount += 1;
    const snapshot = boardNamed(serverTag);
    const respond = () => new Response(JSON.stringify(snapshot), { status: 200 });
    if (!holdGets) return Promise.resolve(respond());
    return new Promise<Response>((resolve) => pendingGets.push(() => resolve(respond())));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tagOf = (board: FleetBoardResponse | null) => (board as unknown as { tag: string } | null)?.tag;

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_DEBOUNCE_MS + 1);
  });
}

describe("useFleet live board", () => {
  it("swaps in someone else's change without a loading state", async () => {
    const { result } = renderHook(() => useFleet(boardNamed("initial")));
    expect(ping).not.toBeNull();

    serverTag = "colleague-booked";
    act(() => ping!());
    expect(result.current.loading).toBe(false);
    await flush();

    expect(tagOf(result.current.board)).toBe("colleague-booked");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("collapses a burst of pings into one request", async () => {
    renderHook(() => useFleet(boardNamed("initial")));
    act(() => {
      ping!();
      ping!();
      ping!();
    });
    await flush();
    expect(getCount).toBe(1);
  });

  it("drops a refresh that predates the viewer's own write", async () => {
    const { result } = renderHook(() => useFleet(boardNamed("initial")));

    holdGets = true;
    serverTag = "stale-before-write";
    act(() => ping!());
    await flush();
    expect(pendingGets).toHaveLength(1);

    await act(async () => {
      await result.current.post({ action: "reserve" });
    });
    expect(tagOf(result.current.board)).toBe("after-my-write");

    // The refresh sent before the write answers now, with the old board.
    await act(async () => {
      pendingGets.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(tagOf(result.current.board)).toBe("after-my-write");
  });

  it("does not subscribe on the sample board", () => {
    renderHook(() => useFleet({ ...boardNamed("demo"), demo: true } as FleetBoardResponse));
    expect(ping).toBeNull();
  });
});
