import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeColumnLetter } from "@/lib/security/input-sanitize";
import { z } from "zod";
import { forbidHeldAccount } from "@/lib/app-access";

type TravelMapping = {
  clientColumn: string;
  locationColumn: string;
  responsibleColumn: string;
};

function readMappingFromUserMetadata(rawMetadata: unknown): TravelMapping {
  if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) {
    return { clientColumn: "", locationColumn: "", responsibleColumn: "" };
  }
  const metadata = rawMetadata as Record<string, unknown>;
  const mappingRaw = metadata.travel_sheet_mapping;
  if (!mappingRaw || typeof mappingRaw !== "object" || Array.isArray(mappingRaw)) {
    return { clientColumn: "", locationColumn: "", responsibleColumn: "" };
  }
  const mapping = mappingRaw as Record<string, unknown>;
  return {
    clientColumn: sanitizeColumnLetter(mapping.clientColumn),
    locationColumn: sanitizeColumnLetter(mapping.locationColumn),
    responsibleColumn: sanitizeColumnLetter(mapping.responsibleColumn),
  };
}

const travelMappingSchema = z.object({
  clientColumn: z.string().min(1).max(5),
  locationColumn: z.string().min(1).max(5),
  responsibleColumn: z.string().min(1).max(5),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;
  return NextResponse.json(readMappingFromUserMetadata(user.user_metadata));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const payload = await request.json();
  const parsed = travelMappingSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid mapping payload." }, { status: 400 });
  }
  const nextMapping: TravelMapping = {
    clientColumn: sanitizeColumnLetter(parsed.data.clientColumn),
    locationColumn: sanitizeColumnLetter(parsed.data.locationColumn),
    responsibleColumn: sanitizeColumnLetter(parsed.data.responsibleColumn),
  };

  if (!nextMapping.clientColumn || !nextMapping.locationColumn || !nextMapping.responsibleColumn) {
    return NextResponse.json(
      { error: "All mapping fields are required and must be valid column letters (A, B, AA...)." },
      { status: 400 },
    );
  }

  const previousMetadata =
    user.user_metadata && typeof user.user_metadata === "object" && !Array.isArray(user.user_metadata)
      ? (user.user_metadata as Record<string, unknown>)
      : {};
  const previousMapping =
    previousMetadata.travel_sheet_mapping &&
    typeof previousMetadata.travel_sheet_mapping === "object" &&
    !Array.isArray(previousMetadata.travel_sheet_mapping)
      ? (previousMetadata.travel_sheet_mapping as Record<string, unknown>)
      : {};

  const mergedMetadata = {
    ...previousMetadata,
    travel_sheet_mapping: {
      ...previousMapping,
      clientColumn: nextMapping.clientColumn,
      locationColumn: nextMapping.locationColumn,
      responsibleColumn: nextMapping.responsibleColumn,
    },
  };

  const { error } = await supabase.auth.updateUser({ data: mergedMetadata });
  if (error) return NextResponse.json({ error: "Could not save mapping." }, { status: 500 });

  return NextResponse.json({ ok: true, ...nextMapping });
}

/**
 * Clears the entire personal travel mapping — including fields the Settings
 * UI doesn't expose (range, gid, date columns) that may linger from older
 * saves — so the user falls back to the server-default sheet configuration.
 * Only touches user metadata; the Google Sheet itself is never written to.
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  // updateUser merges metadata shallowly, so overwrite the key with null —
  // the travel fetch treats a non-object mapping as "no personal mapping".
  const { error } = await supabase.auth.updateUser({ data: { travel_sheet_mapping: null } });
  if (error) return NextResponse.json({ error: "Could not reset mapping." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
