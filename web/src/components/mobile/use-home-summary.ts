"use client";

import { useEffect, useState } from "react";
import type { FleetBoardResponse } from "@/components/fleet/types";
import type { WeekResponse } from "@/components/time-tracker/types";
import { toDateKey } from "@/lib/date";

/**
 * The numbers on the phone's home tiles: this week's time log and the
 * user's live material bookings. Same endpoints the modules use, read once
 * on load and again whenever the shell says the data may have changed
 * (`refreshKey`), so a day logged in the Time screen shows on the tile
 * when the user comes back to Home.
 */
export function useHomeSummary({
  initialWeek,
  wantsTime,
  wantsFleet,
  refreshKey,
}: {
  initialWeek: WeekResponse | null;
  wantsTime: boolean;
  wantsFleet: boolean;
  refreshKey: number;
}) {
  const [week, setWeek] = useState<WeekResponse | null>(initialWeek);
  const [board, setBoard] = useState<FleetBoardResponse | null>(null);

  useEffect(() => {
    if (!wantsTime) return;
    const weekKey = toDateKey(mondayOfToday());
    if (refreshKey === 0 && initialWeek?.week_start === weekKey) return;
    let cancelled = false;
    fetch(`/api/time-tracker?weekStart=${encodeURIComponent(weekKey)}&includeTravel=0`)
      .then((res) => (res.ok ? (res.json() as Promise<WeekResponse>) : null))
      .then((data) => {
        if (!cancelled && data?.week_start) setWeek(data);
      })
      .catch(() => {
        // The tile just keeps what it had.
      });
    return () => {
      cancelled = true;
    };
  }, [wantsTime, initialWeek, refreshKey]);

  useEffect(() => {
    if (!wantsFleet) return;
    let cancelled = false;
    fetch(`/api/fleet?start=${encodeURIComponent(toDateKey(new Date()))}&days=7`)
      .then((res) => (res.ok ? (res.json() as Promise<FleetBoardResponse>) : null))
      .then((data) => {
        if (!cancelled && data?.reservations) setBoard(data);
      })
      .catch(() => {
        // Best effort.
      });
    return () => {
      cancelled = true;
    };
  }, [wantsFleet, refreshKey]);

  const todayKey = toDateKey(new Date());
  const today = week?.days.find((day) => day.date === todayKey) ?? null;
  const myLive = board?.reservations.filter((r) => r.is_mine && (r.status === "reserved" || r.status === "picked_up")) ?? [];
  const myOut = myLive.filter((r) => r.status === "picked_up");

  return { week, today, board, myLive, myOut };
}

function mondayOfToday(): Date {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return monday;
}
