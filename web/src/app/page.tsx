import { isSupabaseConfigured } from "@/lib/supabase/env";
import { redirect } from "next/navigation";

// No session check here: `/dashboard` is gated by the proxy (which sends a
// signed-out visitor to /login) and re-checked by the page itself. Verifying
// the user here too cost a full Auth-server round trip on every launch, only
// for the proxy to repeat it one redirect later.
export default function Home() {
  if (!isSupabaseConfigured()) redirect("/login");
  redirect("/dashboard");
}
