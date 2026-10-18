import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { autoLinkHolder, fetchFleetBoard } from "@/lib/fleet-queries";
import type { BoardWindow } from "@/app/api/fleet/window";

/**
 * Building the Fleet board, shared by `/api/fleet` and the dashboard's
 * server-side prefetch.
 *
 * It lives here rather than in the route so the page can prefetch exactly what
 * the API would have returned. Two copies would drift, and the client treats
 * the prefetched board and the fetched one as the same thing.
 */

export type BoardViewer = {
  id: string;
  email: string | null;
  name: string;
  isAdmin: boolean;
};

/**
 * Builds the whole board for one viewer.
 *
 * `autoLink` is the onboarding step that matches a person to their legacy
 * holder name. It belongs on a page load — it is how a returning user or a
 * brand-new signup lands on a board that already knows them — but NOT on the
 * refresh that follows a booking: the answer cannot have changed because you
 * checked a drone back in, and it costs a round trip to ask.
 */
export async function buildFleetBoard(
  admin: SupabaseClient,
  viewer: BoardViewer,
  boardWindow: BoardWindow,
  opts: { autoLink: boolean },
) {
  const auto = opts.autoLink
    ? await autoLinkHolder(admin, { id: viewer.id, name: viewer.name, email: viewer.email })
    : null;

  const board = await fetchFleetBoard(admin, {
    viewerId: viewer.id,
    viewerName: viewer.name,
    viewerEmail: viewer.email,
    includeArchived: viewer.isAdmin,
    isAdmin: viewer.isAdmin,
    autoLinked:
      auto && auto.linked ? { label: auto.label, bookings: auto.bookings, assets: auto.assets } : null,
    windowStart: boardWindow.windowStart,
    windowDays: boardWindow.windowDays,
  });
  return { ...board, is_admin: viewer.isAdmin };
}

export type FleetBoardPayload = Awaited<ReturnType<typeof buildFleetBoard>>;
