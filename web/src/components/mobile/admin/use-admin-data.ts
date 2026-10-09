"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminListedUser, AdminTimeOverview } from "@/lib/admin-queries";
import { toDateKey, getMonday } from "@/lib/date";

/**
 * The two admin reads the phone shows: the team's week and the user list.
 * Same endpoints as the desktop Admin panel (which keeps its own fetch code
 * so its behaviour stays exactly as it is); read-only here — roles are
 * changed on desktop.
 */
export function useAdminTimeOverview(initial: AdminTimeOverview | null) {
  const [weekStart, setWeekStart] = useState(() => toDateKey(getMonday()));
  const [overview, setOverview] = useState<AdminTimeOverview | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (week: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/time-overview?week=${encodeURIComponent(week)}`);
      const payload = (await response.json()) as AdminTimeOverview | { error: string };
      if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load overview.");
      setOverview(payload as AdminTimeOverview);
    } catch (err) {
      setError((err as Error).message || "Failed to load overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (overview?.week_start === weekStart) return;
    void load(weekStart);
    // `overview` is deliberately not a dependency: it is what the load sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, load]);

  return { weekStart, setWeekStart, overview, loading, error, reload: () => load(weekStart) };
}

export function useAdminUsers(initial: AdminListedUser[] | null, enabled: boolean) {
  const [users, setUsers] = useState<AdminListedUser[]>(initial ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/users");
      const payload = (await response.json()) as { users: AdminListedUser[] } | { error: string };
      if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load users.");
      setUsers((payload as { users: AdminListedUser[] }).users);
    } catch (err) {
      setError((err as Error).message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || initial) return;
    void load();
  }, [enabled, initial, load]);

  return { users, loading, error, reload: load };
}
