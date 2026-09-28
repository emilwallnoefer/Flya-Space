import { Button } from "@/components/ui";
import { LazyEliosGame } from "@/components/elios-game-lazy";

/**
 * The holding screen a signed-in account sees while it has no role.
 *
 * Roles are written by exactly one place — the guardAdmin()-protected
 * PATCH /api/admin/users — so there is nothing useful for the user to do here
 * and nothing to click except sign out. This replaced a first-login picker that
 * let people choose their own profile; that write landed in `user_metadata`,
 * which the user can rewrite themselves, and no reader ever looked there.
 *
 * It is a server component rendered INSTEAD of the dashboard shell, not an
 * overlay on top of it: no module code is sent, no panel is mounted and no
 * prefetch runs, so there is nothing to reach behind it. `RoleGateGame` is the
 * one client component here, and it is deliberately inert — no fetch, no
 * Supabase, no session props — so the gate still exposes nothing.
 *
 * The tone is deliberately light. This is somebody's first ever screen in the
 * app and nothing is wrong — they are waiting on a colleague, not looking at an
 * error, so it should not read like a permissions failure.
 */
export function RoleGate({ email }: { email: string }) {
  return (
    <main
      id="main-content"
      className="relative grid min-h-dvh place-items-center overflow-x-hidden bg-surface p-4 text-ink"
    >
      <div className="absolute inset-0 aurora-bg" />
      <div className="relative w-full max-w-md rounded-2xl border border-glass/20 bg-surface/95 p-6 shadow-xl">
        <p className="text-[11px] uppercase tracking-[0.15em] text-accent-soft/75">One last step</p>
        <h1 className="mt-2 text-lg font-semibold">You&rsquo;re in — almost</h1>
        <p className="mt-3 text-sm text-ink-3/85">
          You&rsquo;re signed in as <span className="font-medium text-ink-2">{email}</span>. An admin needs
          to give you a role before the workspace opens — they already know you&rsquo;re here.
        </p>
        <LazyEliosGame leaderboard />
        <form action="/logout" method="post" className="mt-5">
          <Button type="submit" variant="glass" size="md" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
