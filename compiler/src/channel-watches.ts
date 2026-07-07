/**
 * channel-watches.ts — shared front-end machinery for the §38.13 realtime
 * feed-over-external-DB-writes primitive (`<channel watches=<table>>`).
 *
 * PHASE 1 (front-end) scope: recognition + `RowChange` synthesis + the schema/
 * driver reads the diagnostics need. This module is the single home for the
 * `watches=` machinery so the SYM validation (symbol-table.ts) and the typer
 * synthesis (type-system.ts) share one implementation rather than duplicating
 * the schema read. It emits NO diagnostics itself — it is pure data derivation;
 * the callers decide which of the six §38.13.8 codes to fire.
 *
 * PHASE 2 (out of scope here): the trigger-DDL emission, the Postgres LISTEN
 * bridge + `__change` frame, and the client-side `<onchange>` dispatch codegen.
 *
 * SPEC: §38.13 (the primitive), §38.13.1 (`watches=` / `key=`), §38.13.2
 * (`RowChange` synthesis), §44.2 (driver resolution), §41.16 / §52 (the `id`-PK
 * convention).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { parseSchemaBlock } from "./schema-differ.js";
import { extractDbDriverFromValue } from "./idempotency-store-resolver.ts";
import { collectSchemaBodyText } from "./protect-analyzer.ts";

/** The three fixed variants of every synthesized `RowChange` (§38.13.2). */
export const ROWCHANGE_VARIANT_NAMES = ["Inserted", "Updated", "Deleted"] as const;

export interface WatchColumn {
  /** column identifier as declared in the `<schema>` table body. */
  name: string;
  /** the scrml type name as written in the schema (`int` / `string` / …). */
  scrmlType: string;
  /** true when the column carries a `primary key` constraint. */
  primaryKey: boolean;
}

export interface WatchTable {
  name: string;
  columns: WatchColumn[];
}

export interface RowChangeVariant {
  name: "Inserted" | "Updated" | "Deleted";
  /** the per-arm payload binding contract (positional). */
  payload: Array<{ name: string; type: unknown }>;
}

export interface RowChangeSynth {
  name: "RowChange";
  /** the watched table (lower-cased key is the caller's concern). */
  table: string;
  /** the full post-image row struct — `Inserted` / `Updated` carry this. */
  rowStruct: { kind: "struct"; fields: Record<string, string> };
  /** the primary-key column name, or null when none is derivable. */
  pkColumn: string | null;
  /** the primary-key scrml type, or null when no PK is derivable. */
  pkType: string | null;
  /** the three synthesized variants (§38.13.2). */
  variants: RowChangeVariant[];
}

// ---------------------------------------------------------------------------
// Attribute reads — `watches=` / `key=` are static literal identifiers
// (§38.13.1 — parallel to `name=`/`topic=` per §38.11; NO `${}` interpolation).
// ---------------------------------------------------------------------------

/**
 * Read a static literal identifier attribute (`watches`, `key`) off a
 * `<channel>` markup node. Bare-identifier attribute values arrive as
 * `{ kind: "variable-ref", name }` (the ast-builder ATTR_IDENT shape); a
 * quoted-string value arrives as `{ kind: "string-literal", value }`.
 * Returns the identifier text (leading `@` stripped) or null when absent.
 */
export function readLiteralIdentAttr(node: any, attrName: string): string | null {
  const attrs: any[] = node?.attrs ?? node?.attributes ?? [];
  if (!Array.isArray(attrs)) return null;
  const a = attrs.find((x: any) => x && x.name === attrName);
  if (!a) return null;
  const v = a.value;
  if (v == null) return null;
  if (typeof v === "string") return v.replace(/^@/, "").trim() || null;
  if (typeof v === "object") {
    if (v.kind === "variable-ref" || v.kind === "identifier" || v.kind === "ident") {
      return (v.name ?? "").replace(/^@/, "").trim() || null;
    }
    if (v.kind === "string-literal" && typeof v.value === "string") {
      return v.value.replace(/^@/, "").trim() || null;
    }
  }
  return null;
}

/** True when a `<channel>` markup node carries a `watches=` attribute. */
export function isWatchesChannel(node: any): boolean {
  return node?.kind === "markup"
    && (node.tag ?? "") === "channel"
    && readLiteralIdentAttr(node, "watches") !== null;
}

// ---------------------------------------------------------------------------
// Schema table collection — reads every `<schema>` block in the file so a
// `watches=<T>` channel can resolve T's row shape + primary key.
// ---------------------------------------------------------------------------

/**
 * Walk the AST collecting every `<schema>`-declared table, keyed by the
 * lower-cased table name. Later duplicate declarations of a table name are
 * ignored (first-declaration-wins, matching protect-analyzer.ts).
 */
export function collectSchemaTables(nodes: any): Map<string, WatchTable> {
  const result = new Map<string, WatchTable>();
  const visited = new WeakSet<object>();

  const visit = (value: any, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 64) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (visited.has(value)) return;
    visited.add(value);

    if (value.kind === "state" && value.stateType === "schema") {
      const body = collectSchemaBodyText(value);
      if (body.trim().length > 0) {
        let parsed: { tables: Array<{ name: string; columns: any[] }> };
        try {
          parsed = parseSchemaBlock(body) as typeof parsed;
        } catch {
          parsed = { tables: [] };
        }
        for (const table of parsed.tables ?? []) {
          if (!table || typeof table.name !== "string") continue;
          if (!Array.isArray(table.columns) || table.columns.length === 0) continue;
          const key = table.name.toLowerCase();
          if (result.has(key)) continue;
          const columns: WatchColumn[] = table.columns.map((c: any) => ({
            name: String(c.name ?? ""),
            scrmlType: String(c.scrmlType ?? c.type ?? "asIs").toLowerCase(),
            primaryKey: c.primaryKey === true,
          }));
          result.set(key, { name: table.name, columns });
        }
      }
    }

    for (const k of Object.keys(value)) {
      if (k === "span" || k.startsWith("_")) continue;
      visit(value[k], depth + 1);
    }
  };

  visit(nodes, 0);
  return result;
}

// ---------------------------------------------------------------------------
// Driver resolution — `watches=` requires the Postgres driver (§38.13.1 /
// §44.2). Resolves from `<program db=>` and from `<db src=>` state blocks.
// ---------------------------------------------------------------------------

type DbDriver = "sqlite" | "postgres" | "mysql" | null;

/**
 * Resolve the program's database driver for the §38.13.1 Postgres gate.
 * Consults the `<program db=>` attribute first, then any `<db>` state block's
 * `src=` value. Returns null when no db is configured (the caller treats a
 * null driver on a `watches=` channel as a non-Postgres violation — fail
 * closed, since a feed with no resolvable Postgres db cannot be served).
 */
export function resolveProgramDbDriver(nodes: any): DbDriver {
  let driver: DbDriver = null;
  const visited = new WeakSet<object>();

  const readDriverFromAttrs = (attrs: any): string | null => {
    if (!Array.isArray(attrs)) return null;
    const dbAttr = attrs.find((a: any) => a && a.name === "db");
    if (!dbAttr) return null;
    const v = dbAttr.value;
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      if (v.kind === "string-literal" && typeof v.value === "string") return v.value;
      if ((v.kind === "variable-ref" || v.kind === "identifier") && typeof v.name === "string") return v.name;
    }
    return null;
  };

  const visit = (value: any, depth: number): void => {
    if (driver !== null) return;
    if (value === null || typeof value !== "object" || depth > 64) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (visited.has(value)) return;
    visited.add(value);

    if (value.kind === "markup" && (value.tag ?? "") === "program") {
      const d = extractDbDriverFromValue(readDriverFromAttrs(value.attrs ?? value.attributes));
      if (d !== null) { driver = d; return; }
    }
    // `<db src="postgres://…">` state block (§44.2 `<db>` form).
    if (value.kind === "state" && value.stateType === "db") {
      const src = readDriverFromAttrs(value.attrs ?? value.attributes)
        ?? (typeof value.src === "string" ? value.src : null);
      const d = extractDbDriverFromValue(src);
      if (d !== null) { driver = d; return; }
    }

    for (const k of Object.keys(value)) {
      if (k === "span" || k.startsWith("_")) continue;
      visit(value[k], depth + 1);
    }
  };

  visit(nodes, 0);
  return driver;
}

// ---------------------------------------------------------------------------
// Primary-key derivation + RowChange synthesis (§38.13.2).
// ---------------------------------------------------------------------------

/**
 * Derive the primary key of a watched table (§38.13.2). Precedence:
 *   1. an explicit `key=<column>` override (when the named column exists);
 *   2. a column carrying a `primary key` constraint;
 *   3. the `id`-field convention (a column named `id`).
 * Returns null when none applies (→ the caller fires W-CHANNEL-WATCHES-NO-PK).
 */
export function derivePrimaryKey(
  table: WatchTable,
  keyOverride: string | null,
): { column: string; type: string } | null {
  const cols = table.columns ?? [];
  if (keyOverride) {
    // Resolve the `key=` override CASE-INSENSITIVELY against the table (the
    // table lookup itself is case-insensitive, so `key=Id` must resolve column
    // `id`). A `key=` naming a column that does NOT exist (a typo like
    // `key=totl` for `total`) is NOT silently honored with an `asIs` ghost key —
    // it returns null so the feed cannot key its deltas and W-CHANNEL-WATCHES-
    // NO-PK surfaces (§38.13.2). A `key=` typo must SURFACE, never type `asIs`.
    const lc = keyOverride.toLowerCase();
    const named = cols.find((c) => c.name.toLowerCase() === lc);
    if (!named) return null;
    return { column: named.name, type: named.scrmlType };
  }
  const pkMarked = cols.find((c) => c.primaryKey);
  if (pkMarked) return { column: pkMarked.name, type: pkMarked.scrmlType };
  const idCol = cols.find((c) => c.name.toLowerCase() === "id");
  if (idCol) return { column: idCol.name, type: idCol.scrmlType };
  return null;
}

/**
 * Synthesize the per-feed `RowChange` enum from a watched table's row shape
 * (§38.13.2):
 *
 *   RowChange:enum = { Inserted(row: <RowT>), Updated(row: <RowT>), Deleted(key: <PKT>) }
 *
 * `<RowT>` is the struct of the table's columns; `<PKT>` is the primary-key
 * type. `Inserted` / `Updated` carry the full post-image row; `Deleted` carries
 * only the primary key. Total: when no PK is derivable the `Deleted` key type
 * is `asIs` and `pkColumn` is null (the caller fires W-CHANNEL-WATCHES-NO-PK).
 */
export function synthesizeRowChange(
  table: WatchTable,
  keyOverride: string | null,
): RowChangeSynth {
  const pk = derivePrimaryKey(table, keyOverride);
  const fields: Record<string, string> = {};
  for (const col of table.columns ?? []) fields[col.name] = col.scrmlType;
  const rowStruct = { kind: "struct" as const, fields };

  return {
    name: "RowChange",
    table: table.name,
    rowStruct,
    pkColumn: pk ? pk.column : null,
    pkType: pk ? pk.type : null,
    variants: [
      { name: "Inserted", payload: [{ name: "row", type: rowStruct }] },
      { name: "Updated", payload: [{ name: "row", type: rowStruct }] },
      { name: "Deleted", payload: [{ name: "key", type: pk ? pk.type : "asIs" }] },
    ],
  };
}
