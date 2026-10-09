/** "emil.wallnoefer@…" → "Emil". Shared by the desktop home and the mobile home. */
export function greetingFromEmail(addr: string): string {
  const local = addr.split("@")[0]?.trim() ?? "";
  const first = local.split(/[._-]/)[0] ?? local;
  if (!first) return "there";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Time-of-day greeting in the viewer's local clock. */
export function timeGreeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
