import "server-only";

import { readGmailConnection } from "@/lib/gmail-tokens";
import { sanitizeColumnLetter } from "@/lib/security/input-sanitize";

/**
 * Server-side initial data for the Settings panel, mirroring the two fetches
 * the panel fires on mount (`/api/gmail/status`, `/api/settings/travel-mapping`). Prefetching this on the dashboard SSR lets
 * the panel render seeded instead of waterfalling requests on open.
 *
 * The travel-mapping value comes straight from the user's JWT
 * metadata (already resolved for the request — no extra query); only the Gmail
 * connection needs a service-role read of `gmail_tokens`. Callers must have
 * verified the acting user's session before invoking this (it reads that user's
 * own token via the service-role client).
 */

export type SettingsTravelMapping = {
  clientColumn: string;
  locationColumn: string;
  responsibleColumn: string;
};

export type InitialSettingsData = {
  gmail: { connected: boolean; gmail_email: string | null };
  travelMapping: SettingsTravelMapping;
};

function readTravelMapping(rawMetadata: unknown): SettingsTravelMapping {
  const empty: SettingsTravelMapping = { clientColumn: "", locationColumn: "", responsibleColumn: "" };
  if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) return empty;
  const metadata = rawMetadata as Record<string, unknown>;
  const mappingRaw = metadata.travel_sheet_mapping;
  if (!mappingRaw || typeof mappingRaw !== "object" || Array.isArray(mappingRaw)) return empty;
  const mapping = mappingRaw as Record<string, unknown>;
  return {
    clientColumn: sanitizeColumnLetter(mapping.clientColumn),
    locationColumn: sanitizeColumnLetter(mapping.locationColumn),
    responsibleColumn: sanitizeColumnLetter(mapping.responsibleColumn),
  };
}

export async function fetchInitialSettings(
  userId: string,
  userMetadata: unknown,
): Promise<InitialSettingsData> {
  const connection = await readGmailConnection(userId);
  // Match `/api/gmail/status`: the connected email comes from user metadata.
  const metadataGmailEmail =
    userMetadata && typeof userMetadata === "object" && !Array.isArray(userMetadata)
      ? (userMetadata as Record<string, unknown>).gmail_email
      : null;
  return {
    gmail: {
      connected: Boolean(connection?.refreshToken),
      gmail_email: typeof metadataGmailEmail === "string" ? metadataGmailEmail : null,
    },
    travelMapping: readTravelMapping(userMetadata),
  };
}
