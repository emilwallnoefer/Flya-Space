/**
 * The per-mail "Download your flight data" link must point at Google Drive.
 *
 * Shared by the link tracker (server: only links the app itself put in a mail
 * are wrapped in a `/r/<id>` redirect, and Drive is the one host it accepts
 * without a template naming the exact URL) and the composer's datasets field
 * (client: warns when a pasted link is not on Drive, because it would not be
 * tracked). One rule, so the warning and the tracker cannot disagree.
 *
 * Exact hostname over https only: `drive.google.com.evil.example`,
 * `evil.example/drive.google.com` and `http://drive.google.com` all fail.
 */
export const FLIGHT_DATA_HOSTS: ReadonlySet<string> = new Set(["drive.google.com"]);

export function isFlightDataLink(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" && FLIGHT_DATA_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}
