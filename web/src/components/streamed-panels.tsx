"use client";

import dynamic from "next/dynamic";
import { use } from "react";
import { PanelLoading } from "@/components/panel-loading";
import type { AdminListedUser, AdminTimeOverview } from "@/lib/admin-queries";
import type { FleetBoardResponse } from "@/components/fleet/types";

/**
 * The two panels whose initial data streams in from the server as a promise.
 * `use()` suspends until it lands, so each shell wraps these in a `Suspense`
 * with its own placeholder. Lazy: Fleet and Admin sit behind a click for
 * every user, so their code stays out of the dashboard's first bundle.
 */
const FleetPanel = dynamic(() => import("@/components/fleet/fleet-panel").then((m) => m.FleetPanel), {
  ssr: false,
  loading: PanelLoading,
});
const AdminPanel = dynamic(() => import("@/components/admin-panel").then((m) => m.AdminPanel), {
  ssr: false,
  loading: PanelLoading,
});

export function StreamedFleetPanel({ board }: { board: Promise<FleetBoardResponse | null> }) {
  return <FleetPanel initialBoard={use(board)} />;
}

export function StreamedAdminPanel({
  canManageUsers,
  users,
  overview,
}: {
  canManageUsers: boolean;
  users: Promise<AdminListedUser[] | null>;
  overview: Promise<AdminTimeOverview | null>;
}) {
  return <AdminPanel canManageUsers={canManageUsers} initialUsers={use(users)} initialOverview={use(overview)} />;
}
