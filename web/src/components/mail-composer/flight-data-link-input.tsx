"use client";

import { Input } from "@/components/ui";
import { isFlightDataLink } from "@/lib/flight-data-link";

/**
 * The "Add-ons" flight-data link field, shared by the guided and brief modes.
 *
 * Only Google Drive links are tracked in Mail tracking (security audit run-4
 * F6, `lib/flight-data-link.ts`), so the field says so up front, and warns when
 * a pasted link is somewhere else. It does not block one: the link still goes
 * into the mail and still works, it just is not counted.
 */
export function FlightDataLinkInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const trimmed = value.trim();
  const notDrive = trimmed !== "" && !isFlightDataLink(trimmed);

  return (
    <>
      <Input
        type="url"
        inputMode="url"
        placeholder="Google Drive link to the flight data (Optional)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby="flight-data-link-hint"
      />
      <p
        id="flight-data-link-hint"
        className={`text-[11px] leading-4 ${notDrive ? "text-danger" : "text-ink-4/80"}`}
      >
        {notDrive
          ? "This isn't a Google Drive link. It will still be in the mail, but its clicks won't be tracked."
          : "Google Drive links only. Other links are not tracked."}
      </p>
    </>
  );
}
