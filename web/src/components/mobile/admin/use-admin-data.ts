"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminListedUser, AdminTimeOverview } from "@/lib/admin-queries";
import { toDateKey, getMonday } from "@/lib/date";

async function requestTimeOverview(week: string): Promise<AdminTimeOverview> {
  const response = await fetch(`/api/admin/time-overview?week=${encodeURIComponent(week)}`);
  const payload = (await response.json()) as AdminTimeOverview | { error: string };
  if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load overview.");
  return payload as AdminTimeOverview;
}

async function requestUsers(): Promise<AdminListedUser[]> {
  const response = await fetch("/api/admin/users");
  const payload = (await response.json()) as { users: AdminListedUser[] } | { error: string };
  if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load users.");
  return (payload as { users: AdminListedUser[] }).users;
}

/**
 * The two admin reads the phone shows: the team's week and the user list.
 * Same endpoints as the desktop Admin panel (which keeps its own fetch code
 * so its behaviour stays exactly as it is); read-only here — roles are
 * changed on desktop.
 */
export function useAdminTimeOverview(initial: AdminTimeOverview | null) {
  const [weekStart, setWeekStart] = useState(() => toDateKey(getMonday()));
  const [overview, setOverview] = useState<AdminTimeOverview | null>(initial);
  // The effect below may not set state itself, so the loading state for the
  // week it is about to fetch is set up front: at mount, and during render
  // when the week changes.
  const [loading, setLoading] = useState(() => initial?.week_start !== weekStart);
  const [error, setError] = useState<string | null>(null);
  const [shownWeek, setShownWeek] = useState(weekStart);
  if (shownWeek !== weekStart) {
    setShownWeek(weekStart);
    if (overview?.week_start !== weekStart) {
      setLoading(true);
      setError(null);
    }
  }

  const fetchOverview = useCallback(
    (week: string) =>
      requestTimeOverview(week)
        .then(setOverview, (err: Error) => setError(err.message || "Failed to load overview."))
        .finally(() => setLoading(false)),
    [],
  );

  const load = useCallback(
    (week: string) => {
      setLoading(true);
      setError(null);
      return fetchOverview(week);
    },
    [fetchOverview],
  );

  useEffect(() => {
    if (overview?.week_start === weekStart) return;
    void fetchOverview(weekStart);
    // `overview` is deliberately not a dependency: it is what the load sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, fetchOverview]);

  return { weekStart, setWeekStart, overview, loading, error, reload: () => load(weekStart) };
}

export function useAdminUsers(initial: AdminListedUser[] | null, enabled: boolean) {
  const [users, setUsers] = useState<AdminListedUser[]>(initial ?? []);
  // Same idea: the loading state is set up front, at mount and during render
  // whenever the effect's guard starts letting a fetch through.
  const wantsFetch = enabled && !initial;
  const [loading, setLoading] = useState(wantsFetch);
  const [error, setError] = useState<string | null>(null);
  const [wantedFetch, setWantedFetch] = useState(wantsFetch);
  if (wantedFetch !== wantsFetch) {
    setWantedFetch(wantsFetch);
    if (wantsFetch) {
      setLoading(true);
      setError(null);
    }
  }

  const fetchUsers = useCallback(
    () =>
      requestUsers()
        .then(setUsers, (err: Error) => setError(err.message || "Failed to load users."))
        .finally(() => setLoading(false)),
    [],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (!enabled || initial) return;
    void fetchUsers();
  }, [enabled, initial, fetchUsers]);

  return { users, loading, error, reload: load };
}
