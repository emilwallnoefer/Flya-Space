import { NextResponse } from "next/server";

/**
 * A 500 for a failed database or upstream call: the details go to the server
 * log, and the client gets a generic message. Raw Postgres/PostgREST errors name
 * tables, columns, constraints and policies, which callers have no use for
 * (security audit run-4/5 hardening note).
 */
export function serverError(where: string, error: { message?: string } | null | undefined) {
  console.error(`[${where}]`, error?.message ?? error);
  return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
}
