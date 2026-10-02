/**
 * A small in-memory stand-in for the Supabase client, good enough to run the
 * Fleet route handlers end to end in a unit test.
 *
 * ## Why a fake rather than a mock
 *
 * The route's behaviour lives in the *sequence* of queries it runs — load the
 * reservation, check who owns it, write two rows, re-read the board. Stubbing
 * individual calls with canned answers tests the stub. Keeping real rows in
 * memory and running the real handlers against them tests the handler.
 *
 * ## The rule that makes it trustworthy
 *
 * **It throws on anything it does not implement.** A fake that quietly ignores
 * a filter it has never heard of is worse than no test at all: it reports
 * success while production returns the wrong rows. Every unsupported operator,
 * table or option is a loud failure, so the day someone adds `.gte()` to a
 * fleet query, the tests say so instead of silently passing.
 *
 * It is deliberately NOT a general PostgREST implementation. It supports
 * exactly what `api/fleet` and `lib/fleet-queries` use.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export type FakeUser = {
  id: string;
  email: string | null;
  user_metadata?: Record<string, unknown> | null;
  /** Where the role lives (service-role writable only). See lib/app-access.ts. */
  app_metadata?: Record<string, unknown> | null;
  /** Provider identities: where display names come from (lib/fleet-queries displayNameFor). */
  identities?: Array<{ provider: string; identity_data: Record<string, unknown> }>;
};

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "is"; column: string; value: null }
  | { kind: "not-is"; column: string; value: null };

type Result<T> = { data: T; error: { message: string; code?: string } | null };

/** Foreign keys the fake knows how to resolve for an embedded select. */
const EMBEDS: Record<string, { table: string; localKey: string }> = {
  fleet_assets: { table: "fleet_assets", localKey: "asset_id" },
};

function unsupported(what: string): never {
  throw new Error(
    `fake-supabase: ${what} is not implemented. Add it here (and a test for it) ` +
      `rather than letting the suite pass on behaviour the fake does not model.`,
  );
}

let idCounter = 0;
/** Deterministic, uuid-shaped ids so assertions can be exact. */
function nextId(): string {
  idCounter += 1;
  const n = idCounter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${n}`;
}

export function resetFakeIds() {
  idCounter = 0;
}

export type FakeSupabaseOptions = {
  users?: FakeUser[];
  /** Force a failure for every query against these tables, to test error paths. */
  failTables?: string[];
  /** Called with (table, verb) on every query, so tests can count round trips. */
  onQuery?: (table: string, verb: string) => void;
};

export function createFakeSupabase(seed: Tables, options: FakeSupabaseOptions = {}) {
  // Deep-copy so a test cannot mutate its own fixture through the client.
  const tables: Tables = JSON.parse(JSON.stringify(seed));
  const users = options.users ?? [];
  const failTables = new Set(options.failTables ?? []);

  function rowsOf(table: string): Row[] {
    if (!(table in tables)) {
      unsupported(`table "${table}" was queried but not seeded`);
    }
    return tables[table];
  }

  function matches(row: Row, filters: Filter[]): boolean {
    return filters.every((f) => {
      switch (f.kind) {
        case "eq":
          return row[f.column] === f.value;
        case "in":
          return f.values.includes(row[f.column]);
        case "is":
          return row[f.column] === null || row[f.column] === undefined;
        case "not-is":
          return row[f.column] !== null && row[f.column] !== undefined;
      }
    });
  }

  /**
   * Applies a select list. Supports plain columns, `*`, and a single level of
   * `table(cols)` embedding through a known foreign key.
   */
  function project(table: string, row: Row, select: string): Row {
    const trimmed = select.trim();
    if (trimmed === "*") return { ...row };

    const out: Row = {};
    for (const part of splitSelect(trimmed)) {
      const embed = /^(\w+)\s*\((.*)\)$/.exec(part);
      if (embed) {
        const [, name, cols] = embed;
        const rel = EMBEDS[name];
        if (!rel) unsupported(`embedded relation "${name}" (from table "${table}")`);
        const parent = rowsOf(rel.table).find((r) => r.id === row[rel.localKey]) ?? null;
        out[name] = parent ? project(rel.table, parent, cols) : null;
        continue;
      }
      if (!(part in row)) {
        // A column the seed does not carry reads as null, exactly as it would
        // from a nullable database column.
        out[part] = null;
        continue;
      }
      out[part] = row[part];
    }
    return out;
  }

  /** Splits "a, b, rel(c, d)" without breaking inside the parentheses. */
  function splitSelect(select: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of select) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  /**
   * Stands in for `fleet_reservations_no_double_booking`, the gist EXCLUDE
   * constraint. The route has a branch that only runs when Postgres rejects an
   * overlapping insert, and without this the fake could never reach it.
   */
  function violatesNoDoubleBooking(candidate: Row): boolean {
    const blocking = (s: unknown) => s === "reserved" || s === "picked_up";
    if (!blocking(candidate.status)) return false;
    return rowsOf("fleet_reservations").some(
      (r) =>
        r.id !== candidate.id &&
        r.asset_id === candidate.asset_id &&
        blocking(r.status) &&
        String(r.start_date) <= String(candidate.end_date) &&
        String(candidate.start_date) <= String(r.end_date),
    );
  }

  class Query implements PromiseLike<Result<unknown>> {
    private filters: Filter[] = [];
    private selectList: string | null = null;
    private limitCount: number | null = null;
    private orderBy: { column: string; ascending: boolean } | null = null;
    private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    private payload: Row[] = [];
    private onConflict: string | null = null;
    private singleMode: "one" | "maybe" | null = null;

    constructor(private table: string) {}

    select(list = "*") {
      if (this.mode === "select") this.mode = "select";
      this.selectList = list;
      return this;
    }
    insert(values: Row | Row[]) {
      this.mode = "insert";
      this.payload = Array.isArray(values) ? values : [values];
      return this;
    }
    update(patch: Row) {
      this.mode = "update";
      this.payload = [patch];
      return this;
    }
    upsert(values: Row | Row[], opts?: { onConflict?: string }) {
      this.mode = "upsert";
      this.payload = Array.isArray(values) ? values : [values];
      this.onConflict = opts?.onConflict ?? null;
      if (!this.onConflict) unsupported("upsert without onConflict");
      return this;
    }
    delete() {
      this.mode = "delete";
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push({ kind: "eq", column, value });
      return this;
    }
    in(column: string, values: unknown[]) {
      this.filters.push({ kind: "in", column, values });
      return this;
    }
    is(column: string, value: null) {
      if (value !== null) unsupported(`.is("${column}", ${String(value)})`);
      this.filters.push({ kind: "is", column, value });
      return this;
    }
    not(column: string, operator: string, value: unknown) {
      if (operator !== "is" || value !== null) {
        unsupported(`.not("${column}", "${operator}", ${String(value)})`);
      }
      this.filters.push({ kind: "not-is", column, value: null });
      return this;
    }
    order(column: string, opts?: { ascending?: boolean }) {
      this.orderBy = { column, ascending: opts?.ascending ?? true };
      return this;
    }
    limit(count: number) {
      this.limitCount = count;
      return this;
    }
    maybeSingle() {
      this.singleMode = "maybe";
      return this;
    }
    single() {
      this.singleMode = "one";
      return this;
    }

    private run(): Result<unknown> {
      options.onQuery?.(this.table, this.mode);
      if (failTables.has(this.table)) {
        return { data: null, error: { message: `relation "${this.table}" does not exist`, code: "42P01" } };
      }

      const rows = rowsOf(this.table);
      let affected: Row[];

      switch (this.mode) {
        case "insert":
        case "upsert": {
          const written: Row[] = [];
          for (const value of this.payload) {
            const record: Row = { id: nextId(), created_at: new Date().toISOString(), ...value };
            if (this.mode === "upsert") {
              const key = this.onConflict!;
              const existing = rows.findIndex((r) => r[key] === record[key]);
              if (existing >= 0) {
                rows[existing] = { ...rows[existing], ...value };
                written.push(rows[existing]);
                continue;
              }
            }
            if (this.table === "fleet_reservations" && violatesNoDoubleBooking(record)) {
              return {
                data: null,
                error: {
                  message: "conflicting key value violates exclusion constraint",
                  code: "23P01",
                },
              };
            }
            rows.push(record);
            written.push(record);
          }
          affected = written;
          break;
        }
        case "update": {
          affected = rows.filter((r) => matches(r, this.filters));
          for (const row of affected) Object.assign(row, this.payload[0]);
          break;
        }
        case "delete": {
          affected = rows.filter((r) => matches(r, this.filters));
          for (const row of affected) rows.splice(rows.indexOf(row), 1);
          break;
        }
        case "select": {
          affected = rows.filter((r) => matches(r, this.filters));
          if (this.orderBy) {
            const { column, ascending } = this.orderBy;
            affected = [...affected].sort((a, b) => {
              const av = a[column] as string | number;
              const bv = b[column] as string | number;
              if (av === bv) return 0;
              return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
            });
          }
          if (this.limitCount !== null) affected = affected.slice(0, this.limitCount);
          break;
        }
      }

      // A write without .select() returns no rows, matching PostgREST.
      if (this.selectList === null && this.mode !== "select") return { data: null, error: null };

      const projected = affected.map((r) => project(this.table, r, this.selectList ?? "*"));

      if (this.singleMode === "maybe") return { data: projected[0] ?? null, error: null };
      if (this.singleMode === "one") {
        if (projected.length !== 1) {
          return {
            data: null,
            error: { message: `expected exactly one row, got ${projected.length}`, code: "PGRST116" },
          };
        }
        return { data: projected[0], error: null };
      }
      return { data: projected, error: null };
    }

    then<TResult1 = Result<unknown>, TResult2 = never>(
      onfulfilled?: ((value: Result<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      let result: Result<unknown>;
      try {
        result = this.run();
      } catch (error) {
        return Promise.reject(error).then(onfulfilled, onrejected);
      }
      return Promise.resolve(result).then(onfulfilled, onrejected);
    }
  }

  const client = {
    from(table: string) {
      return new Query(table);
    },
    auth: {
      admin: {
        listUsers: async ({ perPage }: { page?: number; perPage?: number } = {}) => ({
          data: { users: users.slice(0, perPage ?? users.length) },
          error: null,
        }),
      },
    },
    /** Test-only escape hatch for asserting on final state. */
    __tables: tables,
  };

  return client;
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
