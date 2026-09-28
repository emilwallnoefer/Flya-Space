"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoticeTone } from "@/components/ui";
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

/** Where the "show finished bookings" preference is remembered, per browser. */
const SHOW_PAST_KEY = "fleet:show-past";

export type FleetTab = "calendar" | "mine" | "material" | "manage";
export type FleetNotice = { tone: NoticeTone; text: string } | null;

/** Holder filter: everyone. */
export const HOLDER_ANY = "__any__";
/** Holder filter: the units nobody is holding. */
export const HOLDER_NOBODY = "__nobody__";

export function useFleet(initialBoard: FleetBoardResponse | null) {
  const [board, setBoard] = useState<FleetBoardResponse | null>(initialBoard);
  const [loading, setLoading] = useState(!initialBoard);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<FleetNotice>(null);
  const [busy, setBusy] = useState(false);

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
  const [showPast, setShowPast] = useState(true);

  // Guards against a slow response for an earlier window overwriting a newer one
  // (the same staleness rule the Time Tracker follows for its week fetches).
  const requestSeq = useRef(0);

  const load = useCallback(async (start: string) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/fleet?start=${encodeURIComponent(start)}&days=${WINDOW_DAYS}`,
      );
      if (!response.ok) {
        throw new Error((await response.json().catch(() => null))?.error ?? "Request failed");
      }
      const data = (await response.json()) as FleetBoardResponse;
      if (seq !== requestSeq.current) return;
      setBoard(data);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError((err as Error).message || "Could not load the fleet.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Read after mount rather than in the initial state: this panel can be
    // server-rendered, where localStorage does not exist, and seeding state
    // from it directly would mismatch the first client render.
    try {
      if (window.localStorage.getItem(SHOW_PAST_KEY) === "0") setShowPast(false);
    } catch {
      // Private window, or storage blocked. The default stands.
    }
  }, []);

  const toggleShowPast = useCallback((next: boolean) => {
    setShowPast(next);
    try {
      window.localStorage.setItem(SHOW_PAST_KEY, next ? "1" : "0");
    } catch {
      // Not being able to remember it is not a reason to refuse the toggle.
    }
  }, []);

  useEffect(() => {
    if (initialBoard && initialBoard.window_start === windowStart) return;
    void load(windowStart);
  }, [windowStart, load, initialBoard]);

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
        } | null;
        if (!response.ok) {
          setNotice({ tone: "warn", text: data?.error ?? "That did not go through." });
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
      }
    },
    [board?.demo, windowStart, load],
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
