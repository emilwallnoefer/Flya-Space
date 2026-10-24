"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { NoticeTone } from "@/components/ui";
import { subscribeToFleetChanges } from "@/lib/fleet-live";
import { addDays, isBookable, mondayOf, toDateKey } from "@/lib/fleet-rules";
import type {
  FleetAsset,
  FleetAssetCategory,
  FleetBoardResponse,
  FleetReservation,
} from "./types";

/**
 * Everything the Fleet panel knows, in one hook.
 *
 * Split out of `fleet-panel.tsx` so the components below it are presentational:
 * this owns the board, the request lifecycle and every derived list, and the
 * panel owns the layout. It follows the same shape as the Time Tracker and
 * Mail Tracking modules — `use-*.ts` returning one state object.
 */

/** Four weeks of day columns: a month of planning that still fits a laptop. */
export const WINDOW_DAYS = 28;
/**
 * How far the ← / → buttons jump. The window always starts on a Monday, so the
 * current week stays whole until the next one begins.
 */
export const WINDOW_STEP_DAYS = 7;

/**
 * How long to wait after a "something changed" ping before refetching, so one
 * write that touches three tables (three pings) costs one request.
 */
export const LIVE_REFRESH_DEBOUNCE_MS = 300;

/** Where the "show finished bookings" preference is remembered, per browser. */
const SHOW_PAST_KEY = "fleet:show-past";

export type FleetTab = "calendar" | "mine" | "material" | "manage";
export type FleetNotice = { tone: NoticeTone; text: string } | null;
/**
 * A unit of the same model the server offers with a refusal: free to book when
 * `assigned` is false; otherwise assigned to `holder`, and booking it files a
 * request they approve.
 */
export type FleetAlternative = {
  asset_id: string;
  name: string;
  location: string | null;
  assigned: boolean;
  holder: string | null;
};

/** Holder filter: everyone. */
export const HOLDER_ANY = "__any__";
/** Holder filter: the units nobody is holding. */
export const HOLDER_NOBODY = "__nobody__";

async function requestBoard(start: string): Promise<FleetBoardResponse> {
  const response = await fetch(`/api/fleet?start=${encodeURIComponent(start)}&days=${WINDOW_DAYS}`);
  if (!response.ok) {
    throw new Error((await response.json().catch(() => null))?.error ?? "Request failed");
  }
  return (await response.json()) as FleetBoardResponse;
}

/** "Show finished bookings": remembered per browser, kept in memory when storage is blocked. */
const showPastListeners = new Set<() => void>();
let showPastInMemory: boolean | null = null;
function subscribeShowPast(listener: () => void) {
  showPastListeners.add(listener);
  return () => {
    showPastListeners.delete(listener);
  };
}
function readShowPast(): boolean {
  if (showPastInMemory !== null) return showPastInMemory;
  try {
    return window.localStorage.getItem(SHOW_PAST_KEY) !== "0";
  } catch {
    // Private window, or storage blocked. The default stands.
    return true;
  }
}
function writeShowPast(next: boolean) {
  showPastInMemory = next;
  try {
    window.localStorage.setItem(SHOW_PAST_KEY, next ? "1" : "0");
  } catch {
    // Not being able to remember it is not a reason to refuse the toggle.
  }
  for (const listener of showPastListeners) listener();
}

export function useFleet(initialBoard: FleetBoardResponse | null) {
  const [board, setBoard] = useState<FleetBoardResponse | null>(initialBoard);
  const [loading, setLoading] = useState(!initialBoard);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<FleetNotice>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Free units of the same kind the server offered with its last refusal
   * ("SVA-257 is taken — SVA-330 is free"). Cleared by the next write, so an
   * offer never outlives the situation it answered.
   */
  const [alternatives, setAlternatives] = useState<FleetAlternative[]>([]);

  const [tab, setTab] = useState<FleetTab>("calendar");
  const [windowStart, setWindowStart] = useState<string>(
    () => initialBoard?.window_start ?? mondayOf(toDateKey(new Date())),
  );
  const [categoryFilter, setCategoryFilter] = useState<FleetAssetCategory | "all">("all");
  /**
   * Whose material to show. A holder NAME rather than a user id, because a unit
   * can be against a name from the old sheet that no account has claimed yet —
   * filtering by account would make exactly those units unfindable.
   */
  const [holderFilter, setHolderFilter] = useState<string>(HOLDER_ANY);
  const [search, setSearch] = useState("");
  // Finished bookings are shown by default — the calendar answering "who had
  // this in March" is deliberate. The preference is remembered per browser
  // because re-hiding them on every visit is the kind of small friction that
  // makes people stop using a filter.
  // Read through useSyncExternalStore: the server (and the first client render)
  // use the default, so this panel can be server-rendered without a mismatch.
  const showPast = useSyncExternalStore(subscribeShowPast, readShowPast, () => true);

  // Guards against a slow response for an earlier window overwriting a newer one
  // (the same staleness rule the Time Tracker follows for its week fetches).
  const requestSeq = useRef(0);
  /** Writes still waiting on the server; a ping is held until they are done. */
  const writesInFlight = useRef(0);
  /** A ping arrived mid-write; refresh once the write is done. */
  const refreshAfterWrite = useRef(false);
  const windowStartRef = useRef(windowStart);
  useEffect(() => {
    windowStartRef.current = windowStart;
  }, [windowStart]);

  // State changes only in the promise callbacks, so the window effect below can
  // start it; `load` adds the synchronous loading reset for everyone else.
  const fetchBoard = useCallback((start: string) => {
    const seq = ++requestSeq.current;
    return requestBoard(start)
      .then(
        (data) => {
          if (seq === requestSeq.current) setBoard(data);
        },
        (err: Error) => {
          if (seq === requestSeq.current) setError(err.message || "Could not load the fleet.");
        },
      )
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, []);

  const load = useCallback(
    (start: string) => {
      setLoading(true);
      setError(null);
      return fetchBoard(start);
    },
    [fetchBoard],
  );

  /**
   * Refetch the board someone else just changed, without the loading state:
   * the screen stays as it is and the new board simply replaces it. Failures
   * are silent too — the board on screen is still the last good one.
   */
  const refreshQuietly = useCallback(async () => {
    if (writesInFlight.current > 0) {
      refreshAfterWrite.current = true;
      return;
    }
    const seq = requestSeq.current;
    const start = windowStartRef.current;
    let data: FleetBoardResponse;
    try {
      const response = await fetch(
        `/api/fleet?start=${encodeURIComponent(start)}&days=${WINDOW_DAYS}`,
      );
      if (!response.ok) return;
      data = (await response.json()) as FleetBoardResponse;
    } catch {
      return;
    }
    // A newer load (another window) or a write's board landed meanwhile: both
    // bump the sequence, and this response predates them.
    if (seq !== requestSeq.current) return;
    // Retire any load still in flight: it was sent before this one.
    requestSeq.current += 1;
    setBoard(data);
    setLoading(false);
  }, []);

  const isDemo = board?.demo === true;
  useEffect(() => {
    if (isDemo) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToFleetChanges(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshQuietly();
      }, LIVE_REFRESH_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [isDemo, refreshQuietly]);

  const toggleShowPast = useCallback((next: boolean) => writeShowPast(next), []);

  // A new window shows the loading state from its first render; the effect
  // then fetches it. The server-prefetched window is never refetched.
  const isPrefetchedWindow = Boolean(initialBoard && initialBoard.window_start === windowStart);
  const [seenWindowStart, setSeenWindowStart] = useState(windowStart);
  if (seenWindowStart !== windowStart) {
    setSeenWindowStart(windowStart);
    if (!isPrefetchedWindow) {
      setLoading(true);
      setError(null);
    }
  }
  useEffect(() => {
    if (isPrefetchedWindow) return;
    void fetchBoard(windowStart);
  }, [windowStart, fetchBoard, isPrefetchedWindow]);

  /**
   * Every write goes through here, so the staleness rule and the board handed
   * back by the write are honoured in exactly one place.
   */
  const post = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      if (board?.demo) {
        setNotice({
          tone: "warn",
          text: "This is sample data — apply the fleet migration to make bookings real.",
        });
        return false;
      }
      setBusy(true);
      setNotice(null);
      setAlternatives([]);
      writesInFlight.current += 1;
      try {
        // The window travels with the write so the server can hand back the
        // board for the days actually on screen.
        const response = await fetch(
          `/api/fleet?start=${encodeURIComponent(windowStart)}&days=${WINDOW_DAYS}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
          board?: FleetBoardResponse;
          alternatives?: FleetAlternative[];
        } | null;
        if (!response.ok) {
          setNotice({ tone: "warn", text: data?.error ?? "That did not go through." });
          if (Array.isArray(data?.alternatives)) setAlternatives(data.alternatives);
          return false;
        }
        if (data?.message) setNotice({ tone: "neutral", text: data.message });

        if (data?.board) {
          // The write already came back with the refreshed board, so there is no
          // second request to make. Bumping the sequence first retires any load
          // still in flight: its response predates this write, and applying it
          // afterwards would put the pre-write board back on screen.
          requestSeq.current += 1;
          setBoard(data.board);
          setLoading(false);
        } else {
          // Older response, or the board refresh failed server-side. Fall back
          // to fetching it ourselves so the screen still catches up.
          await load(windowStart);
        }
        return true;
      } catch (err) {
        setNotice({ tone: "danger", text: (err as Error).message || "Network error." });
        return false;
      } finally {
        setBusy(false);
        writesInFlight.current -= 1;
        if (writesInFlight.current === 0 && refreshAfterWrite.current) {
          refreshAfterWrite.current = false;
          void refreshQuietly();
        }
      }
    },
    [board?.demo, windowStart, load, refreshQuietly],
  );

  // Memoised so the `?? []` fallback does not hand every downstream useMemo a
  // fresh array identity on each render.
  const assets = useMemo<FleetAsset[]>(() => board?.assets ?? [], [board]);
  const reservations = useMemo<FleetReservation[]>(() => board?.reservations ?? [], [board]);
  const today = board?.today ?? toDateKey(new Date());

  /**
   * The people with something in their hands right now, for the holder filter.
   *
   * Built from every asset rather than the filtered ones, so choosing a person
   * does not remove the other people from the list you chose them in.
   */
  const holderOptions = useMemo(() => {
    const names = new Set<string>();
    for (const asset of assets) if (asset.holder_name) names.add(asset.holder_name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [assets]);

  const visibleAssets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return assets.filter((asset) => {
      if (categoryFilter !== "all" && asset.category !== categoryFilter) return false;
      if (holderFilter === HOLDER_NOBODY) {
        if (asset.holder_name) return false;
      } else if (holderFilter !== HOLDER_ANY && asset.holder_name !== holderFilter) {
        return false;
      }
      if (!needle) return true;
      return [asset.name, asset.serial_number, asset.model, asset.current_location, asset.holder_name]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [assets, categoryFilter, holderFilter, search]);

  // The calendar is for material you can actually take: the shared pool, minus
  // anything retired or in repair. Units assigned to a person, region or
  // customer are fixed — a row of unbookable cells for each of them buried the
  // handful that are genuinely free, which is the question this screen answers.
  const bookableAssets = useMemo(() => visibleAssets.filter(isBookable), [visibleAssets]);

  const myReservations = useMemo(
    () =>
      reservations
        .filter((r) => r.is_mine && r.status !== "cancelled" && r.status !== "returned")
        .sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [reservations],
  );

  const unclaimedHolders = useMemo(() => board?.unclaimed_holders ?? [], [board]);
  /** The viewer's own name, for the "add me as ..." option in the setup prompt. */
  const myDisplayName = useMemo(
    () => board?.standings.find((s) => s.user_id === board?.me.user_id)?.name ?? "me",
    [board],
  );
  /** Names the viewer is allowed to claim for themselves, without an admin. */
  const claimableByMe = useMemo(() => unclaimedHolders.filter((h) => h.mine), [unclaimedHolders]);

  /**
   * Everyone the fleet knows a name for, for the "assigned to" picker.
   *
   * Three sources, because a person can be in any of them and in none of the
   * others: an account with a reliability score, a name from the old sheet
   * nobody has claimed, and a label already written on an assigned unit. Left
   * out, an admin would have to retype a name the fleet is already using.
   */
  /**
   * Every name that could be drawn in a colour anywhere in the module.
   *
   * Wider than `knownPeople`, because it has to include people who hold nothing
   * right now but appear in a booking on the visible board — colours are
   * allocated against this, and a name missing from it is a name with no
   * uniqueness guarantee.
   */
  const holderRoster = useMemo(() => {
    const names = new Set<string>();
    for (const entry of board?.standings ?? []) names.add(entry.name);
    for (const holder of unclaimedHolders) names.add(holder.label);
    for (const reservation of reservations) names.add(reservation.holder_name);
    for (const asset of assets) {
      if (asset.holder_name) names.add(asset.holder_name);
      if (asset.current_holder_label) names.add(asset.current_holder_label);
    }
    return [...names];
  }, [board, unclaimedHolders, reservations, assets]);

  const knownPeople = useMemo(() => {
    const names = new Set<string>();
    for (const entry of board?.standings ?? []) names.add(entry.name);
    for (const holder of unclaimedHolders) names.add(holder.label);
    for (const asset of assets) if (asset.current_holder_label) names.add(asset.current_holder_label);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [board, unclaimedHolders, assets]);

  // Legend entries: only the people with something in the rendered window, so a
  // 178-booking year does not print every name under every screen.
  const visibleHolders = useMemo(() => {
    const windowEnd = addDays(windowStart, WINDOW_DAYS - 1);
    const bookable = new Set(assets.filter(isBookable).map((a) => a.id));
    const names = new Set<string>();
    for (const r of reservations) {
      if (!bookable.has(r.asset_id)) continue;
      if (r.status === "cancelled" || r.status === "waitlisted") continue;
      if (r.end_date < windowStart || r.start_date > windowEnd) continue;
      names.add(r.holder_name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [reservations, assets, windowStart]);

  return {
    board,
    loading,
    error,
    notice,
    setNotice,
    busy,
    load,
    post,
    alternatives,

    tab,
    setTab,
    windowStart,
    setWindowStart,
    categoryFilter,
    setCategoryFilter,
    holderFilter,
    setHolderFilter,
    holderOptions,
    search,
    setSearch,
    showPast,
    toggleShowPast,

    today,
    assets,
    reservations,
    visibleAssets,
    bookableAssets,
    myReservations,
    unclaimedHolders,
    claimableByMe,
    knownPeople,
    holderRoster,
    myDisplayName,
    visibleHolders,
  };
}

export type FleetState = ReturnType<typeof useFleet>;
