/**
 * §14.8.9 — Server→client confidentiality: protected-column egress redaction.
 *
 * This module owns the FLOOR (the load-bearing structural redaction) for
 * `protect=` columns: a column whose resolved source `(table, column)` origin
 * is a protected field SHALL NOT cross the wire to the client unless it is
 * explicitly declassified with `reveal("col")` AT THAT VALUE (SPEC.md:8506-8513
 * — "at the value", "declassified-at-this-value", "at the sink", "here only").
 *
 * The mechanism is "tag at query-lowering, read at the egress sink":
 *
 *   1. At `?{ SELECT ... }` lowering, the resolved per-output-column origins
 *      (reusing the §14.8.7 FROM/JOIN alias map via `extractSelectProjection`)
 *      are turned into the set of OUTPUT column names whose origin is protected.
 *      Each result row is wrapped with `_scrml_protect_tag(rows, cols)`, which
 *      attaches a Symbol-keyed descriptor (`Symbol.for("scrml.protect.origin")`).
 *
 *   2. The descriptor PROPAGATES through every compiler-emitted construction
 *      step for free, because it is an enumerable Symbol-keyed own property:
 *      `{...row}` spread copies it, `.map(r => ({...r}))` preserves it, a helper
 *      `return row` carries it, JOIN rows carry per-output-column origins. A
 *      `JSON.stringify` of the value IGNORES Symbol keys, so the descriptor is
 *      never itself serialized (it is metadata, not data).
 *
 *   3. At the single compiler-owned egress sink (server-fn response serializer
 *      + SSR `/__serverLoad`), `_scrml_protect_redact(value)` walks the value,
 *      reads the descriptor, and drops every protected-origin column that is not
 *      `reveal`-stamped. Redaction is sound BY CONSTRUCTION — the compiler reads
 *      a tag at egress; it never proves a return clean (no value-flow obligation).
 *
 * Soundness bound (§14.8.9 normative — DO NOT over-claim): complete for
 * explicit-column flows of statically-resolvable SQL, by ORIGIN. NOT covered:
 * derived/implicit flows (`{ hasPw: row.pw != "" }` — a value of independent
 * identity carries no descriptor), covert channels, and member-extraction into
 * a re-keyed fresh literal (`{ secret: row.pw }` — same derived-flow boundary).
 * Unresolvable dynamic SQL is stripped WHOLESALE (fail-closed), never
 * accept-unknown. Raw / foreign egress (`_{}`, manual `Response`, `asIs`) the
 * compiler cannot redact fails closed with `E-PROTECT-004`.
 */

import { extractSelectProjection } from "../sql-projection.ts";

/**
 * Compile-time protect context: which `(table, column)` origins are protected,
 * plus each protected table's full column list (for `SELECT *` expansion).
 * Built from the PA stage's ProtectAnalysis (`buildProtectContext`).
 */
export interface ProtectContext {
  /** table name -> set of protected column names on that table. */
  protectedByTable: Map<string, Set<string>>;
  /** table name -> all column names on that table (for `SELECT *` expansion). */
  schemaByTable: Map<string, string[]>;
}

/**
 * Build the codegen-side ProtectContext from the PA stage's ProtectAnalysis.
 * Duck-typed against the loose `{ views?: Map<...> }` shape threaded through
 * runCG so this composes with both the unit-test FileAST input and the live
 * pipeline TABResult input.
 *
 * Returns a context with EMPTY maps when the app declares no `protect=` fields —
 * the caller treats `protectedByTable.size === 0` as "protect inactive" and
 * emits byte-identical output (zero overhead for non-protect apps).
 */
export function buildProtectContext(protectAnalysis: unknown): ProtectContext {
  const protectedByTable = new Map<string, Set<string>>();
  const schemaByTable = new Map<string, string[]>();
  const views = (protectAnalysis as { views?: Map<string, unknown> } | null | undefined)?.views;
  if (!views || typeof (views as Map<string, unknown>).forEach !== "function") {
    return { protectedByTable, schemaByTable };
  }
  for (const [, dbViews] of views as Map<string, { tables?: Map<string, unknown> }>) {
    const tables = dbViews?.tables;
    if (!tables || typeof (tables as Map<string, unknown>).forEach !== "function") continue;
    for (const [tableName, view] of tables as Map<string, {
      protectedFields?: Set<string>;
      fullSchema?: Array<{ name?: string }>;
    }>) {
      if (view?.protectedFields && view.protectedFields.size > 0) {
        const existing = protectedByTable.get(tableName) ?? new Set<string>();
        for (const f of view.protectedFields) existing.add(f);
        protectedByTable.set(tableName, existing);
      }
      if (Array.isArray(view?.fullSchema)) {
        const cols = view.fullSchema.map((c) => c?.name).filter((n): n is string => typeof n === "string");
        if (cols.length > 0) schemaByTable.set(tableName, cols);
      }
    }
  }
  return { protectedByTable, schemaByTable };
}

/**
 * The result of resolving a `?{}` SELECT's protected-origin output columns:
 *   - `{ cols }`  — explicit protected OUTPUT column names (alias-resolved).
 *   - `{ all: true }` — a SELECT whose origins cannot be statically resolved
 *                       (dynamic/CTE/UNION/subquery); the row is stripped
 *                       WHOLESALE at egress (fail-closed, OQ-3).
 *   - `null`      — no protected egress (no protected column selected, or the
 *                   query is not a row-producing SELECT). No tag is emitted.
 */
export type ProtectedColumns = { cols: string[] } | { all: true } | null;

/**
 * Strip leading SQL comments (block `slash-star ... star-slash` and `-- ...`
 * line comments) plus whitespace so the leader test sees the first real keyword.
 * Applied repeatedly because a query may carry several stacked leading comments
 * (e.g. a line comment then a block comment then the SELECT). An unterminated
 * block comment consumes the rest (a malformed / no-op query).
 */
function stripLeadingSqlNoise(sql: string): string {
  let prev: string;
  let s = sql;
  do {
    prev = s;
    s = s.trimStart();
    if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end === -1 ? "" : s.slice(end + 2);
    } else if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl === -1 ? "" : s.slice(nl + 1);
    }
  } while (s !== prev);
  return s;
}

/**
 * Is this query ROW-PRODUCING (so it can carry a client-facing protected column)?
 * True for a leading `SELECT` OR a leading `WITH` (a CTE — `WITH [RECURSIVE] ...`).
 * The leader test runs AFTER stripping `${...}` bound params and leading SQL
 * comments, so a comment- or CTE-prefixed row still reaches the egress floor
 * (§14.8.9: an unresolvable-origin row is stripped WHOLESALE, never accept-unknown).
 * A CTE degrades to the `{ all: true }` strip-all path in `extractSelectProjection`
 * (WITH is an UNTYPEABLE_LEADER); a comment-prefixed plain SELECT resolves normally.
 */
function isRowProducingQuery(sqlContent: string): boolean {
  const normalized = stripLeadingSqlNoise(sqlContent.replace(/\$\{[^}]*\}/g, " "));
  return /^(?:select|with)\b/i.test(normalized);
}

/**
 * Resolve the protected OUTPUT column names a `?{}` SELECT carries, keyed on the
 * column's resolved `(table, column)` ORIGIN (never its surface name — so
 * `SELECT passwordHash AS h` redacts identically to `SELECT passwordHash`).
 *
 * Reuses `extractSelectProjection` (the §14.8.7 alias-origin map). A `SELECT *`
 * / `table.*` star is expanded against the protected table's column set.
 */
export function resolveProtectedOutputColumns(
  sqlContent: string,
  ctx: ProtectContext,
): ProtectedColumns {
  // Only a row-producing query (a leading SELECT or a WITH/CTE, after stripping
  // leading SQL comments) can carry a client-facing protected column. A non-row
  // producer (INSERT/UPDATE/DELETE/DDL) produces no typed row in the v1 SQL
  // surface; `RETURNING` is part of the deferred long tail (documented). A
  // comment- or CTE-prefixed row must NOT slip past this gate untagged (§14.8.9
  // fail-closed): a WITH degrades to strip-all below, never accept-unknown.
  if (!isRowProducingQuery(sqlContent)) return null;

  const proj = extractSelectProjection(sqlContent);
  // Unresolvable SELECT (dynamic / CTE / UNION / subquery-in-FROM) — fail-closed:
  // strip every column wholesale at egress (OQ-3), never accept-unknown.
  if (!proj.resolvable) return { all: true };

  const out = new Set<string>();
  for (const col of proj.columns) {
    if (col.kind === "column" && col.table && col.column) {
      const prot = ctx.protectedByTable.get(col.table);
      if (prot && prot.has(col.column)) out.add(col.outputName);
    } else if (col.kind === "star") {
      // `SELECT *` (no table) expands against every FROM/JOIN table; `table.*`
      // expands against that one table. The output column name of a starred
      // column IS the source column name, so a protected source column appears
      // under its own name in the result row (alias-safe by construction).
      const tables = col.table ? [col.table] : proj.fromTables;
      for (const t of tables) {
        const prot = ctx.protectedByTable.get(t);
        if (prot) for (const c of prot) out.add(c);
      }
    }
    // kind "opaque" (computed/expression column) carries no resolvable origin —
    // it is a derived flow (§14.8.9 out-of-scope), not a protected-origin column.
  }
  if (out.size === 0) return null;
  return { cols: [...out] };
}

/**
 * The server-bundle runtime helper block (§14.8.9). Injected into the server
 * module IFF one of `_scrml_protect_tag` / `_scrml_protect_redact` /
 * `_scrml_protect_reveal` is referenced (mirrors the `_scrml_wire_encode`
 * inline-on-use precedent). Server-only — never reaches client.js.
 */
export const SERVER_PROTECT_HELPER: string = [
  "",
  "// --- §14.8.9 Protected-column egress redaction (server-only confidentiality floor) ---",
  "// A Symbol-keyed descriptor records, per result row, which OUTPUT columns",
  "// originate from a `protect=` field. It is enumerable (so `{...row}` spread /",
  "// `.map` carry it) but Symbol-keyed (so JSON.stringify ignores it). The egress",
  "// sink reads it and drops protected columns unless `reveal`-stamped.",
  "const _SCRML_PROTECT = Symbol.for(\"scrml.protect.origin\");",
  "function _scrml_protect_tag(value, cols) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) {",
  "    for (const row of value) {",
  "      if (row != null && typeof row === \"object\" && !Array.isArray(row)) row[_SCRML_PROTECT] = { cols, revealed: [] };",
  "    }",
  "    return value;",
  "  }",
  "  value[_SCRML_PROTECT] = { cols, revealed: [] };",
  "  return value;",
  "}",
  "function _scrml_protect_reveal(value, col) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) return value.map((r) => _scrml_protect_reveal(r, col));",
  "  const d = value[_SCRML_PROTECT];",
  "  if (!d) return value;",
  "  const next = { ...value };",
  "  next[_SCRML_PROTECT] = { cols: d.cols, revealed: [...d.revealed, col] };",
  "  return next;",
  "}",
  "function _scrml_protect_redact(value) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (typeof Response !== \"undefined\" && value instanceof Response) return value;",
  "  if (Array.isArray(value)) return value.map(_scrml_protect_redact);",
  "  const d = value[_SCRML_PROTECT];",
  "  const stripAll = d && d.cols === \"*\";",
  "  const protectedCols = d && Array.isArray(d.cols) ? d.cols : null;",
  "  const revealed = d ? d.revealed : null;",
  "  const out = {};",
  "  for (const k of Object.keys(value)) {",
  "    const isRevealed = revealed && revealed.indexOf(k) !== -1;",
  "    if (!isRevealed && (stripAll || (protectedCols && protectedCols.indexOf(k) !== -1))) continue;",
  "    out[k] = _scrml_protect_redact(value[k]);",
  "  }",
  "  return out;",
  "}",
  "",
].join("\n");

/**
 * Build the `_scrml_protect_tag(<inner>, <cols>)` wrap for a lowered SQL result
 * expression `inner`. `cols` is serialized as a JS array literal of output
 * column names, or the `"*"` strip-all sentinel.
 */
export function wrapWithProtectTag(inner: string, resolved: ProtectedColumns): string {
  if (resolved === null) return inner;
  const colsArg = "all" in resolved ? '"*"' : JSON.stringify(resolved.cols);
  return `_scrml_protect_tag(${inner}, ${colsArg})`;
}

/**
 * Resolve an expression node to the terminal NAME it denotes, walking a member
 * chain to its last property. This is what makes the raw-egress gate spelling-
 * independent:
 *
 *   `Response`                  -> "Response"   (ident)
 *   `globalThis.Response`       -> "Response"   (member, property)
 *   `window.Response`           -> "Response"
 *   `globalThis.foo.Response`   -> "Response"
 *   `globalThis["Response"]`    -> "Response"   (index, STATIC string key)
 *   `window["foo"]["Response"]` -> "Response"
 *
 * `a["b"]` denotes exactly the property `a.b` denotes, so it has to answer the
 * same: a bracket with a string-literal key is statically resolvable, and a gate
 * that reads one spelling and not the other is a spelling trick away from a
 * leak. (Measured before this was closed: `new globalThis["Response"](...)` over
 * a protected row compiled at exit 0 with zero diagnostics and the executed
 * handler answered `{"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}`.)
 *
 * Returns null for a shape with no static terminal name: a call result, a
 * literal, or an index whose key is genuinely DYNAMIC (`a[k]`, `a[cond ? x : y]`
 * — the key's value is not in the tree). A null answer is a NON-match, which is
 * safe here only because the caller treats "no recognised egress" as "the
 * compiler owns this sink" — see the population note on
 * `detectProtectedRawEgress`.
 */
function terminalName(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as { kind?: string; name?: string; property?: string; index?: unknown };
  if (n.kind === "ident" && typeof n.name === "string") return n.name;
  if (n.kind === "member" && typeof n.property === "string") return n.property;
  if (n.kind === "index") return staticIndexKey(n.index);
  return null;
}

/**
 * The STATIC string key of an `expr[key]` index, or null when the key is not a
 * string the tree already carries. A double-quoted string and a static backtick
 * template are both literal `kind: "lit"` nodes with the interpreted `value` on
 * them (`types/ast.ts` LitExpr), so this reads the tree's own answer — it is not
 * a re-scan of source text (invariant 55).
 */
function staticIndexKey(index: unknown): string | null {
  if (!index || typeof index !== "object") return null;
  const i = index as { kind?: string; litType?: string; value?: unknown };
  if (i.kind !== "lit") return null;
  if (i.litType !== "string" && i.litType !== "template") return null;
  return typeof i.value === "string" ? i.value : null;
}

/**
 * The receiver of a property access, resolved through its own chain:
 * `Response.json` -> "Response"; `globalThis.Response.json` -> "Response";
 * `Response["json"]` -> "Response"; `globalThis["Response"].json` -> "Response".
 */
function memberReceiverName(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as { kind?: string; object?: unknown };
  if (n.kind !== "member" && n.kind !== "index") return null;
  return terminalName(n.object);
}

/** Does a type-annotation FIELD denote the `asIs` escape type (§14.1.1)? */
function annotationIsAsIs(annotation: unknown): boolean {
  // `typeAnnotation` / `returnTypeAnnotation` are declared `string` on the AST
  // (types/ast.ts) — the tree stores a type EXPRESSION in string form, so a
  // token test on that FIELD reads a structured value. It is not a re-scan of
  // source text: a comment or a string literal spelling `asIs` cannot reach here
  // (invariant 55 — the field is the tree's own answer).
  if (typeof annotation !== "string") return false;
  return /(^|[^A-Za-z0-9_$])asIs([^A-Za-z0-9_$]|$)/.test(annotation);
}

/**
 * §14.8.9 fail-closed gate (E-PROTECT-004) — detect a protected-origin value
 * reaching a RAW / compiler-UNANALYZABLE egress within a single server-function
 * body, where the structural redaction floor cannot guarantee the strip:
 *   - a `_{}` foreign-code block (§23) — opaque interior;
 *   - a manual `Response` / `handle()` body (§40) — the floor's redact passes a
 *     `Response` instance through untouched (it cannot introspect a serialized
 *     body), so a row manually serialized there would LEAK;
 *   - an `asIs`-typed value (§14.1.1) — escapes the type system.
 *
 * Returns the offending query + egress kind (→ E-PROTECT-004), or null. The
 * closed-world precondition of §14.8.9 rests on every egress being compiler-
 * emitted and descriptor-preserving; this gate enforces it fail-closed.
 * Conservative: co-occurrence of a protected query and a raw egress in the same
 * body fires (the floor never silently ships a protected column through a path
 * it cannot redact).
 *
 * A body the walk cannot traverse in full (nesting past `MAX_DEPTH`) returns
 * `truncated: true` and a null `query`: an un-walked subtree is itself an
 * egress the compiler cannot analyse, so it fires rather than passing. See the
 * cap comment inside — the boundary BEHAVIOUR is the load-bearing part.
 *
 * **This is a STRUCTURAL analysis over the parsed function tree, not a scan of
 * the function's source slice (ruling dpa-029 Q1, S352; invariant 55).** The
 * source-text form it replaces was wrong in four measured ways, every one a
 * direct consequence of asking the text a question the tree already answered:
 *
 *   1. `/\bnew\s+Response\b/` missed `new globalThis.Response(...)` — the
 *      emitted handler's `instanceof Response` passthrough then returned the
 *      manual response BEFORE `_scrml_protect_redact`, and the protected column
 *      shipped at exit 0 with zero diagnostics.
 *   2. `/(^|[^A-Za-z0-9_$])_\{/` matched only the LEVEL-0 foreign opener. The
 *      opener grammar is `_` + N `=` + `{`, so the canonical `_={ … }=` form
 *      SPEC §23.2.4a's own worked example uses walked straight past the gate.
 *   3. `/\basIs\b/` matched the token inside a comment or a string literal.
 *   4. `/\?\{`([^`]*)`\}/` read the SQL out of the text rather than off the
 *      `sql` node the parser had already built.
 *
 * The resolution is by NODE KIND and by CALLEE, and the callee resolves through
 * its member chain, so every MEMBER-CHAIN spelling of a constructor reaches the
 * same conclusion as the bare one.
 *
 * **Residual bound — stated so it is not over-claimed.** Every bound below was
 * measured by compiling the shape and EXECUTING the emitted handler, not read
 * off the code.
 *
 *   1. **Callee resolution is SYNTACTIC, not binding-aware.** A name that is not
 *      in the tree is not resolved: a local rebinding (`let R = Response;
 *      new R()`) and a dynamic bracket key (`let k = "Response";
 *      globalThis[k]`) both read as themselves. Closing either needs the name
 *      resolver / constant propagation, not a wider callee test.
 *
 *      Parity with the source-text form this replaces, stated precisely because
 *      an earlier revision of this comment overstated it: `let R =
 *      globalThis.Response` and `globalThis[k]` are silent on `origin/main` too
 *      — carried forward. `let R = Response` is NOT: on `origin/main` that
 *      program fails `E-SCOPE-001` (`Response` is absent from
 *      `LOGIC_SCOPE_GLOBAL_ALLOWLIST` there) and does not compile at all. This
 *      branch allowlists `Response` for §40.3.5, which makes that spelling
 *      reachable. For that one spelling this is a WIDENING of the residual, not
 *      a carry-forward, and it is pinned as such in
 *      `g-sql-row-protect-leak.test.js`.
 *
 *   2. **Detection is PER FUNCTION BODY.** A protected `?{}` in one function
 *      reaching a raw egress in another — the ordinary `let u = loadUser(id)`
 *      helper split — is invisible to a per-body co-occurrence test. This is the
 *      most idiomatic of the residual shapes and it carries forward from the
 *      source-text form, which was equally per-body. Executed leak, measured.
 *
 *   3. **Only `Response.json` is a static-factory egress.** `Response.redirect`
 *      / `Response.error` carry no caller-supplied body, so no protected column
 *      can ride them.
 *
 * **Declassification is NOT handled here (ruling dpa-033 (c), S352).** §14.8.9
 * scopes `reveal` to the VALUE — "explicitly declassified via the field-level
 * `reveal` construct **at the value**" (SPEC.md:8506-8507), "stamps the named
 * column's provenance descriptor as **declassified-at-this-value**" and "the
 * serializer admits a protected-origin column **only** when its descriptor bears
 * a `reveal` stamp **at the sink**" (SPEC.md:8511-8513), with the worked example
 * commented "**here only**" (SPEC.md:8509). A body-wide suppressor admitted a
 * value that bears no stamp at all — a `.reveal()` on a DIFFERENT query's row
 * silenced the gate for the actually-returned, never-revealed row. This gate is
 * therefore a floor with no exit; the value-scoped exit is sink-level lowering,
 * a separate later arc.
 *
 * provenance: ruling:user-voice-scrml.md S352 (dpa-029 Q1, dpa-033 (c))
 */
export function detectProtectedRawEgress(
  fnNode: unknown,
  ctx: ProtectContext,
): { query: string | null; egressKind: string; truncated?: true } | null {
  if (!fnNode || typeof fnNode !== "object") return null;

  let protectedQuery: string | null = null;
  let sawForeign = false;
  let sawResponse = false;
  let sawAsIs = false;

  // Generic structural walk — the `astReadsCurrentUserAmbient` precedent
  // (emit-server.ts): identity `seen` set against a cyclic tree, a depth cap,
  // and `span` skipped (a span carries no semantics and holds a `filePath`
  // string that would otherwise be walked on every node).
  //
  // The cap is a RESOURCE bound (JS call-stack depth), NOT a correctness one:
  // exceeding it does not truncate the answer, it FAILS CLOSED (see the
  // `truncated` handling after the walk). That distinction is the whole point —
  // silently truncating a fail-CLOSED check is a fail-OPEN, and raising the
  // number cannot fix it, because ANY finite cap has a boundary. What has to be
  // right is the BEHAVIOUR at the boundary.
  //
  // `depth` counts EDGES, and an array costs two (the container, then each
  // element), so 512 internal levels is ≈250 levels of source nesting, not 512.
  // The measured max over the 1878-body corpus is 37, so a real body never
  // reaches the cap; when a synthetic one does, the compiler says it could not
  // analyse the body rather than passing it. Measured on this exact walk before
  // this fix: a protected row reaching `new Response(...)` under 250 nested
  // array literals fired E-PROTECT-004 and under 255 did NOT — compiling at
  // exit 0, zero diagnostics, secret shipped.
  const MAX_DEPTH = 512;
  let truncated = false;
  const seen = new WeakSet<object>();
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object") return;
    if (depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }

    const n = node as Record<string, unknown>;

    // --- the protected-origin `?{}` SELECT ---------------------------------
    // A `?{}` is a `sql` node wherever it sits; the let/const/return attachment
    // forms carry it as `sqlNode`, which the generic recursion below reaches.
    if (n.kind === "sql" && typeof n.query === "string" && protectedQuery === null) {
      if (resolveProtectedOutputColumns(n.query, ctx) !== null) {
        protectedQuery = n.query.trim().replace(/\s+/g, " ").slice(0, 60);
      }
    }

    // --- egress kind 1: a `_{}` foreign-code block (§23) --------------------
    // Node kind, so EVERY opener level (`_{`, `_={`, `_=={`, …) is one answer.
    if (n.kind === "foreign") sawForeign = true;

    // --- egress kind 2: a manual `Response` (§40) ---------------------------
    // `new <chain>.Response(...)` — the callee resolves through its member chain.
    if (n.kind === "new" && terminalName(n.callee) === "Response") sawResponse = true;
    // `<chain>.Response.json(...)` — a static factory call on the same receiver.
    if (
      n.kind === "call" &&
      terminalName(n.callee) === "json" &&
      memberReceiverName(n.callee) === "Response"
    ) {
      sawResponse = true;
    }

    // --- egress kind 3: an `asIs`-typed value (§14.1.1) ---------------------
    if (annotationIsAsIs(n.typeAnnotation) || annotationIsAsIs(n.returnTypeAnnotation)) {
      sawAsIs = true;
    }

    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      visit(n[key], depth + 1);
    }
  };
  visit(fnNode, 0);

  // --- FAIL CLOSED on an unanalyzable body -------------------------------
  // The walk stopped short of the whole tree, so "no protected query here" and
  // "no raw egress here" are both UNKNOWN, not "no": the un-walked subtree could
  // hold either or both. §14.8.9's floor never ships a protected column through
  // a path it cannot analyse, and an un-walked subtree is exactly such a path,
  // so the gate reports rather than returns silently. This is checked BEFORE the
  // `protectedQuery === null` early return, because the query itself may be the
  // thing the truncation hid.
  if (truncated) {
    return {
      query: protectedQuery,
      egressKind:
        `a body the compiler could not analyse in full — its nesting exceeds the ` +
        `§14.8.9 structural-analysis depth cap (${MAX_DEPTH} tree levels)`,
      truncated: true,
    };
  }

  if (protectedQuery === null) return null;

  // Priority is fixed rather than traversal-ordered, so the reported kind does
  // not depend on where in the body each construct happens to sit.
  const egressKind = sawForeign
    ? "a `_{}` foreign-code block (§23)"
    : sawResponse
      ? "a manual `Response` / `handle()` body (§40)"
      : sawAsIs
        ? "an `asIs`-typed value (§14.1.1)"
        : null;
  if (!egressKind) return null;
  return { query: protectedQuery, egressKind };
}
