/**
 * §14.8.9 — Server→client confidentiality: protected-column egress redaction.
 *
 * This module owns the FLOOR (the load-bearing structural redaction) for
 * `protect=` columns: a column whose resolved source `(table, column)` origin
 * is a protected field SHALL NOT cross the wire to the client unless it is
 * explicitly declassified with `reveal("col")`.
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
 * accept-unknown.
 *
 * RAW / FOREIGN EGRESS — the closed-world precondition, enforced in THREE places
 * with three different strengths. Read the strengths; they are not interchangeable:
 *
 *   - `_{}` (§23) and `asIs` (§14.1.1) — `E-PROTECT-004`, a per-body SOURCE-TEXT
 *     co-occurrence LINT. Conservative, defeated by function extraction, and NOT
 *     a guarantee. Labelled as such at its definition; do not restate it as one.
 *   - an author-serialized response BODY (§40) — `E-PROTECT-005`, a HARD compile
 *     error raised at EMISSION, when the compiler is about to wrap an author
 *     value in an envelope it cannot mediate. Structural, not source-text.
 *   - anything that reaches the sink anyway — the RUNTIME refusal in
 *     `_scrml_protect_redact` / `_scrml_protect_opaque_refusal()`. `instanceof
 *     Response` is exact, so this limb has no spelling problem and no extraction
 *     hole. **This is the guarantee. The other two are early warnings.**
 *
 * ⚑ **THE UNIT OF ALL THREE IS THE BODY, NOT THE `Response`.** A `Response` with
 * a null body — a redirect, a 204, `Response.error()` — carries no payload, so
 * there is nothing for a `protect=` column to hide in and nothing for the floor
 * to fail to inspect. Limbs 2 and 3 both permit it; `W-PROTECT-005` covers the
 * narrow seam where the compile limb can prove that and the runtime limb cannot.
 * The adopter-facing statement of the whole contract is one sentence: **a
 * `protect=` app keeps full control of STATUS and HEADERS and gives up authoring
 * the BODY.**
 */

import { extractSelectProjection } from "../sql-projection.ts";
// @ts-ignore — acorn ships its own types but the compiler imports it untyped
// elsewhere (expression-parser.ts, validate-emit.ts, egress-field-scan.ts) for
// the same reason. Used by `findAuthoredResponseConstruction` below.
import * as acorn from "acorn";

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
  "// ⚑ THE MEDIATION MARK — THIS IS THE SEAM BETWEEN THE COMPILE-TIME AND",
  "// RUN-TIME LIMBS, AND IT EXISTS BECAUSE THE TWO WERE ANSWERING THE SAME",
  "// QUESTION WITH DIFFERENT PREDICATES.",
  "//",
  "// Both limbs are asking: is this `Response` AUTHOR-owned (unmediated) or",
  "// COMPILER-owned (already mediated)? The compile-time gate answered it by",
  "// PROVENANCE — it scans only the author-body window, so a compiler-emitted",
  "// `Response` is excluded positionally. The runtime guard answered it by SHAPE",
  "// (`.body === null`), which is a proxy for \"carries a payload\", NOT for",
  "// \"who built it\". Every place provenance and shape disagree was a defect:",
  "//   · `Response.redirect(...)` — author-owned, but payload-free  (W-PROTECT-005)",
  "//   · the §53.9.4 `E-CONTRACT-001-RT` 400 — compiler-owned, but body-carrying,",
  "//     so the guard turned the compiler's own 400 into a 500.",
  "// The mark gives the runtime limb access to PROVENANCE, so both limbs now",
  "// decide on the same basis and a new crossing cannot re-open the gap.",
  "const _SCRML_MEDIATED = Symbol.for(\"scrml.protect.mediated\");",
  "function _scrml_protect_mediated(response) {",
  "  // Symbol-keyed like the origin descriptor, for the same reason: invisible to",
  "  // `JSON.stringify`, so marking a response never changes what ships.",
  "  response[_SCRML_MEDIATED] = true;",
  "  return response;",
  "}",
  "// The compiler-owned refusal for an egress the floor cannot inspect (§14.8.9).",
  "// It carries NO application data by construction: the whole point is that the",
  "// payload could not be proven free of a protected column, so none of it ships.",
  "function _scrml_protect_opaque_refusal() {",
  "  return new Response(JSON.stringify({ error: {",
  "    kind: \"ProtectOpaqueEgress\",",
  "    message: \"the server refused a response body it cannot redact: a `protect=` column could not be proven absent (SPEC §14.8.9). Return the value itself — the compiler envelopes and redacts it — instead of a hand-built Response.\",",
  "  } }), { status: 500, headers: { \"Content-Type\": \"application/json\" } });",
  "}",
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
  "  // §14.8.9 fail-CLOSED on an opaque egress. A Response is a one-shot stream",
  "  // handle: the redactor cannot read its body, so it cannot prove a `protect=`",
  "  // column is absent from it. Refuse what the monitor cannot inspect.",
  "  //",
  "  // This branch used to `return value` — passing the Response through UNTOUCHED,",
  "  // which shipped whatever the author had already serialized into it. That was",
  "  // fail-OPEN: the one direction this floor exists to rule out.",
  "  //",
  "  // A THROW is the mechanism here (not a returned refusal) because this branch",
  "  // is reached from INSIDE the value walk — e.g. `return { receipt: aResponse }`",
  "  // — where there is no response slot to return.",
  "  //",
  "  // ⚠ WHICH SINKS GUARD AGAINST A TOP-LEVEL Response, STATED EXACTLY — THIS",
  "  // COMMENT HAS BEEN WRONG TWICE AND THE SECOND VERSION COST A WHOLE PAGE.",
  "  // Guarded, so a top-level Response is refused one level up and never reaches",
  "  // here: both server-fn arms, the §61 `<endpoint>` envelope, and (since the",
  "  // fix below) `/__mountHydrate`. NOT guarded: `/__serverLoad`, which is safe",
  "  // for a REASON rather than by luck — its `_scrml_rows` / `_scrml_result` /",
  "  // `_scrml_cv` are values the COMPILER built from a lowered `?{}`, so no author",
  "  // construction reaches it.",
  "  //",
  "  // ⛔ DO NOT EXTEND THAT REASON TO `/__mountHydrate`. A previous draft did, and",
  "  // it was false: `_scrml_mh_v<i>` are AUTHOR server-fn return values. MEASURED —",
  "  // a loader returning `Response.redirect(...)` compiled at exit 0 and this throw",
  "  // escaped the handler, losing the ENTIRE hydration payload including every",
  "  // unrelated cell, instead of the shaped 500 the guarded sinks return.",
  "  // The correctness of this file is carried by its comments; an over-claiming",
  "  // one is a defect in it.",
  "  // A `Response` with a NULL body carries no payload at all — there is nothing",
  "  // for a `protect=` column to hide in, so it is not an opaque egress and is",
  "  // returned untouched. `.body === null` is exact and NON-DESTRUCTIVE; anything",
  "  // that measured LENGTH would have to consume the stream and destroy it.",
  "  if (typeof Response !== \"undefined\" && value instanceof Response) {",
  "    // PROVENANCE first, shape second. A response the compiler built is already",
  "    // mediated — refusing it would refuse our own 400s and 403s.",
  "    if (value[_SCRML_MEDIATED]) return value;",
  "    if (value.body === null) return value;",
  "    // TAGGED, not just thrown. A caller that catches this has to be able to tell",
  "    // a confidentiality refusal apart from an ordinary failure — the §37 SSE",
  "    // stream wrapper does exactly that, and without the tag its generic `catch`",
  "    // swallowed the refusal and ended the stream with a silent 200.",
  "    const _scrml_e = new Error(\"scrml §14.8.9: refusing to redact an opaque `Response` nested in a client-egress payload — the floor cannot inspect a Response body, so a `protect=` column cannot be proven absent. Return the value itself instead of a hand-built Response.\");",
  "    _scrml_e.__scrml_protect_opaque = true;",
  "    throw _scrml_e;",
  "  }",
  "  if (Array.isArray(value)) return value.map(_scrml_protect_redact);",
  "  // ⛔ THE WALK IS UNCONDITIONAL. ONLY THE RECONSTRUCTION IS CONDITIONAL.",
  "  //",
  "  // Rebuilding a fresh `{}` from `Object.keys` destroys any value whose JSON",
  "  // form is not its own enumerable keys — a `Date` has none, so a TIMESTAMP",
  "  // column serialized as `{}` instead of its ISO string. The first attempt at",
  "  // preserving those SHORT-CIRCUITED on a non-plain prototype and returned the",
  "  // object WITHOUT DESCENDING, which turned a cosmetic flaw into a fail-OPEN",
  "  // one: a tagged row inside any class-instance wrapper shipped `passwordHash`",
  "  // in cleartext, and a nested `Response` — the limb §14.8.9 designates THE",
  "  // GUARANTEE — was never reached. MEASURED, both.",
  "  //",
  "  // \"Do not rebuild\" and \"do not look\" are different instructions, and inside a",
  "  // fail-closed floor only the first one is ever safe. So: always descend, and",
  "  // decide how to RETURN afterwards.",
  "  //   plain object      -> return the rebuilt copy (lossless for plain objects,",
  "  //                        and byte-identical to the original behaviour);",
  "  //   non-plain, and the walk changed NOTHING -> return the ORIGINAL untouched,",
  "  //                        so a `Date` / `toJSON` value survives intact;",
  "  //   non-plain, and something HAD to change -> rebuild onto the same prototype,",
  "  //                        so methods survive. Internal slots cannot, but this",
  "  //                        arm is reached only when the value actually carried a",
  "  //                        protected column, where the prior behaviour was `{}`.",
  "  const d = value[_SCRML_PROTECT];",
  "  const stripAll = d && d.cols === \"*\";",
  "  const protectedCols = d && Array.isArray(d.cols) ? d.cols : null;",
  "  const revealed = d ? d.revealed : null;",
  "  const out = {};",
  "  let _changed = false;",
  "  for (const k of Object.keys(value)) {",
  "    const isRevealed = revealed && revealed.indexOf(k) !== -1;",
  "    if (!isRevealed && (stripAll || (protectedCols && protectedCols.indexOf(k) !== -1))) { _changed = true; continue; }",
  "    const _rv = _scrml_protect_redact(value[k]);",
  "    if (_rv !== value[k]) _changed = true;",
  "    out[k] = _rv;",
  "  }",
  "  const _proto = Object.getPrototypeOf(value);",
  "  if (_proto === Object.prototype || _proto === null) return out;",
  "  if (!_changed) return value;",
  "  return Object.assign(Object.create(_proto), out);",
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
 * Every `.reveal("col")` in `fnSource` whose argument is a STRING LITERAL, as a
 * set of the column names named.
 *
 * A `.reveal(x)` with a computed argument names no column this scanner can read
 * and therefore discharges NOTHING — it simply does not join the set, which is
 * already the fail-CLOSED outcome. An earlier draft also returned a `dynamic`
 * flag "so the caller can decide"; no caller ever read it, and a returned value
 * nobody consumes is a claim the code does not actually make. Removed rather
 * than left as decoration.
 */
function revealedColumnsIn(fnSource: string): Set<string> {
  const named = new Set<string>();
  // `.reveal(` + a single argument, captured up to the closing paren.
  const revealRe = /\.\s*reveal\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = revealRe.exec(fnSource)) !== null) {
    const arg = r[1].trim();
    const lit = /^(["'`])([^"'`]*)\1$/.exec(arg);
    if (lit) named.add(lit[2]);
  }
  return named;
}

/**
 * §14.8.9 fail-closed gate (E-PROTECT-004) — a protected-origin value reaching a
 * RAW / compiler-UNANALYZABLE egress within a single server-function body.
 *
 * ⚑ **THIS IS A CONSERVATIVE LINT OVER THE §14.8.9 DERIVED-FLOW BOUNDARY. IT IS
 * NOT, AND MUST NOT BE DESCRIBED AS, A CONFIDENTIALITY GUARANTEE.** It is a
 * source-text co-occurrence test scoped to ONE function body, so ordinary
 * function extraction defeats it: the same code with the query in a helper and
 * the raw egress in the caller does not fire. That limitation is INHERENT to a
 * source-text predicate and cannot be repaired by recognizing more spellings —
 * a completeness fix on this mechanism has no done-condition. The guarantees on
 * this surface live elsewhere:
 *   - the RUNTIME floor `_scrml_protect_redact`, which reads the actual
 *     descriptor on the actual value at the actual sink (exact, no spelling
 *     problem), and now REFUSES an opaque `Response` rather than passing it; and
 *   - the emission-time `E-PROTECT-005` gate (`findAuthoredResponseConstruction`
 *     below), which refuses to emit a mediated envelope around an
 *     author-constructed `Response` at all on a `protect=` path.
 *
 * Kinds detected — TWO, and the list SHRANK on purpose (S405, arc A item A3):
 *   - a `_{}` foreign-code block (§23) — opaque interior;
 *   - an `asIs`-typed value (§14.1.1) — escapes the type system.
 *
 * ⛔ The `Response` limb was DELETED here, not weakened. It was the one limb
 * whose source-text co-occurrence stood in for a REAL structural fact — that the
 * compiler-owned envelope is fail-open on a `Response` — and that fact is now
 * enforced where it lives: `E-PROTECT-005` at emission, and the runtime refusal
 * at the sink. Keeping a strictly-weaker duplicate of a check that is now made
 * structurally would be keeping the "lint that reads as a guarantee". Do NOT
 * re-add it.
 *
 * Returns the offending query + egress kind (→ E-PROTECT-004), or null.
 *
 * SUPPRESSION IS COLUMN-KEYED, NOT EXISTENCE-KEYED (S405, arc A item A4). A
 * `reveal("col")` discharges the gate only when the offending query's protected
 * OUTPUT columns are ALL named by a reveal in this body. Previously ANY
 * `.reveal(` anywhere in the body disarmed the gate for EVERY protected column
 * in it, so `reveal("email")` silently declassified `passwordHash` — measured.
 * A `{ all: true }` strip-all query (unresolvable SQL) can never be discharged
 * by named reveals: its protected column set is unknown, so no finite list of
 * names covers it. A `.reveal(<non-literal>)` names no readable column and
 * discharges nothing.
 */
export function detectProtectedRawEgress(
  fnSource: string,
  ctx: ProtectContext,
): { query: string; egressKind: string; undischarged: string[] | "*" } | null {
  if (!fnSource) return null;
  // Is a protected-origin `?{}` SELECT present in this body whose protected
  // output columns are NOT all reveal-declassified?
  const revealed = revealedColumnsIn(fnSource);
  let protectedQuery: string | null = null;
  // The columns the author must ACTUALLY name to discharge this. Carried out to
  // the diagnostic because these are the ALIAS-RESOLVED OUTPUT names, which the
  // author cannot always read off their own SQL: `SELECT passwordHash AS h`
  // needs `reveal("h")`, not `reveal("passwordHash")`. A message that says
  // "declassify every protected column" without naming them sends the adopter
  // to guess at the one thing the compiler has already computed.
  let undischarged: string[] | "*" = [];
  const sqlRe = /\?\{`([^`]*)`\}/g;
  let m: RegExpExecArray | null;
  while ((m = sqlRe.exec(fnSource)) !== null) {
    const resolved = resolveProtectedOutputColumns(m[1], ctx);
    if (resolved === null) continue;
    // Strip-all (unresolvable SQL): the protected column set is unknown, so no
    // finite set of `reveal("col")` names can discharge it. Fail closed.
    if ("all" in resolved) {
      undischarged = "*";
    } else {
      const missing = resolved.cols.filter((c) => !revealed.has(c));
      if (missing.length === 0) continue;
      undischarged = missing;
    }
    protectedQuery = m[1].trim().replace(/\s+/g, " ").slice(0, 60);
    break;
  }
  if (!protectedQuery) return null;
  // Is there a raw / unredactable egress in the same body?
  //
  // ⚑ `_=*\{` — `_` then ZERO OR MORE `=` then `{`, which is SPEC §23.2's own
  // normative opener rule verbatim ("`_` followed by zero or more `=` followed
  // by `{`"), and the pattern `ast-builder.js:18392` already uses. It was
  // `_\{` — LEVEL 0 ONLY — until S405, and that is the one level §23.2 tells
  // authors NOT to write: `W-FOREIGN-001` fires on a level-0 `_{` and
  // recommends `_={}=`. So this limb recognized exactly the spelling the
  // compiler steers authors away from and missed every recommended one.
  // REPRODUCED at `8fa6854d`: `let w = _={ JSON.stringify(v) }=` in a
  // `protect=` body compiled at exit 0 with NO diagnostic and shipped
  // `passwordHash` in full — the foreign block returns a plain string, which
  // carries no descriptor, so the redact at the sink is a no-op on it.
  let egressKind: string | null = null;
  if (/(^|[^A-Za-z0-9_$])_=*\{/.test(fnSource)) {
    egressKind = "a `_{}` foreign-code block (§23)";
  } else if (/\basIs\b/.test(fnSource)) {
    egressKind = "an `asIs`-typed value (§14.1.1)";
  }
  if (!egressKind) return null;
  return { query: protectedQuery, egressKind, undischarged };
}

// ---------------------------------------------------------------------------
// E-PROTECT-005 — the author-constructed `Response` gate (§14.8.9, S405 item A2)
// ---------------------------------------------------------------------------

/**
 * The COMPLETE set of `Response` STATIC members that PRODUCE a `Response`, per
 * the WHATWG Fetch Standard's `Response` interface — `error` · `redirect` ·
 * `json` — plus the `new Response(...)` constructor, matched separately. There
 * is no fourth static producer to add later.
 *
 * ⚑ **THE FULL SET IS LISTED HERE AND ONLY A SUBSET IS GATED. THAT SPLIT IS THE
 * POINT — DO NOT COLLAPSE THIS TO A TWO-MEMBER LIST.** Keeping all four visible,
 * each with its reason, is what stops the next reader from wondering whether the
 * list is truncated (and "re-completing" it back into the S405 defect below).
 */
const RESPONSE_STATIC_PRODUCERS = ["error", "redirect", "json"] as const;
type ResponseStaticProducer = (typeof RESPONSE_STATIC_PRODUCERS)[number];

/**
 * Of those, the ones that can carry a BODY — the only property `E-PROTECT-005`
 * is entitled to care about.
 *
 * ⛔ **`redirect` AND `error` ARE EXCLUDED BECAUSE THE STANDARD GIVES THEM A NULL
 * BODY, NOT AS A CONVENIENCE.** `Response.redirect()` produces a response whose
 * body is null (a status plus a `Location` header); `Response.error()` produces
 * a network-error response with a null body and immutable headers. There is no
 * stream for the floor to fail to inspect, so `E-PROTECT-005`'s own rationale —
 * "an opaque stream the compiler cannot read" — does not hold for them, and its
 * stated resolution ("return the VALUE; the compiler serializes and redacts it")
 * **cannot produce a 302 at all.**
 *
 * ⚑ **S405 FIX-ROUND DEFECT, REPRODUCED: gating them build-broke a shape with NO
 * workaround.** A `protect=` app whose server fn did `SELECT id, name` (the
 * protected column projected OUT) and then `return Response.redirect("/home", 302)`
 * compiled clean at base and hard-failed on the first landing — and because this
 * gate deliberately has no escape hatch, that app could not issue a redirect from
 * a server fn or an `<endpoint>` arm AT ALL. `Response.json` stays gated: it
 * always serializes its argument into a body.
 *
 * The line this draws is the adopter-facing contract, and it is worth stating
 * plainly: **a `protect=` app keeps full control of STATUS and HEADERS; what it
 * gives up is authoring the BODY.** That is a coherent restriction rather than a
 * blanket ban, and it is the one the §14.8.9 floor actually needs.
 */
const RESPONSE_BODY_CARRYING_PRODUCERS: ReadonlySet<ResponseStaticProducer> = new Set(["json"]);

/**
 * The null-body STATICS — the two the RUNTIME guard cannot recognize.
 *
 * ⚑ **THIS SET EXISTS BECAUSE THE COMPILE-TIME AND RUN-TIME LIMBS CAN SEE
 * DIFFERENT THINGS, AND PRETENDING OTHERWISE IS HOW THE FIRST LANDING BROKE
 * REDIRECTS TWICE — once at build time, then again at request time.** Measured
 * on Bun 1.3.14:
 *
 *   `new Response()` / `new Response(null, …)`  ->  `.body === null`  RUNTIME-VISIBLE
 *   `Response.redirect(url, 302)`               ->  `.body` is a 0-byte ReadableStream
 *   `Response.error()`                          ->  `.body` is a 0-byte ReadableStream
 *   `new Response("s3cret", {status:302, headers:{Location:"/h"}})`
 *                                               ->  `.body` is a ReadableStream
 *
 * The last line is the adversarial case and it is why NO runtime heuristic is
 * admissible: a secret-carrying `Response` can be made to present exactly like a
 * redirect — same `location` header, same absent `content-length`, same `.body`
 * shape. Measuring the byte length means CONSUMING the stream, which destroys
 * the response. So the runtime guard can soundly pass through ONLY
 * `.body === null`, and these two fall outside it.
 *
 * They therefore COMPILE (firing `E-PROTECT-005` on them is wrong on that
 * diagnostic's own rationale) but the runtime floor still refuses them.
 * Reporting that at BUILD time as `W-PROTECT-005` is the whole point of this
 * set: the alternative is a shape that compiles clean and then 500s on the first
 * request, which is a worse defect than the build break it replaced.
 */
const RESPONSE_NULL_BODY_STATICS: ReadonlySet<ResponseStaticProducer> = new Set(
  // DERIVED, never re-listed. The two live sets PARTITION the producer set, and
  // deriving this half is what makes the split self-checking: add a member to
  // `RESPONSE_STATIC_PRODUCERS` and it lands here until someone classifies it as
  // body-carrying, so a new producer defaults to the SAFE side (warned, not
  // silently unrecognized). Re-listing `["redirect","error"]` by hand would let
  // the three lists drift, which is exactly the drift that made the parent set
  // "documentation wearing a const" — declared, asserted to be load-bearing, and
  // read by nothing.
  RESPONSE_STATIC_PRODUCERS.filter((m) => !RESPONSE_BODY_CARRYING_PRODUCERS.has(m)),
);

// The partition must be TOTAL and DISJOINT, and this is checked at module load
// rather than asserted in a comment — the whole point of deriving one half.
if (RESPONSE_BODY_CARRYING_PRODUCERS.size + RESPONSE_NULL_BODY_STATICS.size !== RESPONSE_STATIC_PRODUCERS.length) {
  throw new Error(
    "protect-egress: the Response static-producer partition is not total — " +
    `${RESPONSE_BODY_CARRYING_PRODUCERS.size} body-carrying + ${RESPONSE_NULL_BODY_STATICS.size} null-body ` +
    `!= ${RESPONSE_STATIC_PRODUCERS.length} producers. Every producer must be classified as one or the other.`,
  );
}

/** What kind of `Response` construction a scan found, if any. */
export type AuthoredResponseKind =
  /** Carries an author-supplied body the floor cannot inspect -> E-PROTECT-005 (error). */
  | "body"
  /** Provably payload-free, but invisible to the runtime guard -> W-PROTECT-005 (warning). */
  | "null-body-static";

/**
 * Does this `new Response(...)` provably have a NULL body?
 *
 * True for `new Response()` (no arguments) and `new Response(null, …)` — the
 * long-hand spellings of "status/headers only", e.g. a 204 or a hand-rolled 302.
 * The body is argument 0, so this is a purely SYNTACTIC, compile-time-constant
 * test on that one argument — the same class of check as `staticStringKey`, NOT
 * a value-flow analysis. Anything else (an identifier, a call, a template) is
 * treated as a body: proving THOSE null is the permanently-dead analysis.
 */
function isProvablyNullBodyResponse(node: any): boolean {
  const args = Array.isArray(node?.arguments) ? node.arguments : [];
  if (args.length === 0) return true;
  const a0 = args[0];
  return !!a0 && a0.type === "Literal" && a0.value === null;
}

const RESPONSE_SCAN_PARSE_OPTIONS = { ecmaVersion: 2022 as const, sourceType: "module" as const };

/**
 * Which SYNTACTIC CATEGORY a slice handed to the scanner belongs to.
 *
 * ⚑ **THIS PARAMETER IS REQUIRED, AND ITS EXISTENCE IS THE FIX FOR A ROOT CAUSE
 * THAT PRODUCED TWO SEPARATE SILENT HOLES ONE REVIEW ROUND APART.**
 *
 * The scanner cannot parse a bare slice without deciding how to frame it, and it
 * used to GUESS — one wrapper for everything, widened reactively each time a
 * shape failed to parse:
 *
 *   round 1  the wrapper was `async function`, so a §37 generator body's
 *            top-level `yield` did not parse -> `catch` -> null -> `yield new
 *            Response(...)` under `protect=` compiled clean. "Fixed" by adding `*`.
 *   round 2  the same wrapper framed an `<endpoint>` arm's EXPRESSION as a
 *            STATEMENT, so `{ ok: true, r: Response.json({a:1}) }` parsed as a
 *            labeled block and threw -> null. MEASURED: multi-key object arms —
 *            the canonical `<endpoint>` shape — were entirely unscanned, while a
 *            single-key `{ r: new Response(x) }` happened to parse as a label and
 *            WAS scanned. A blind spot that looked like coverage.
 *
 * Both are the same root: **the wrapper grammar was not derived from the shapes
 * it must admit.** Adding a construct each time a hole is found has no
 * done-condition — it is the same unbounded-completeness mistake this whole arc
 * exists to refuse, wearing a parser.
 *
 * The repair is to stop guessing. Every CALL SITE knows statically which
 * category it is passing, so the caller declares it and the compiler enforces
 * that a new call site cannot forget to. **That converts an open question ("did I
 * enumerate every construct that might appear?") into a closed one ("did each of
 * the five call sites pass the right category?").**
 */
export type ScanSliceKind =
  /** A statement list: a server-fn body, a peer callable, a §37 generator body. */
  | "statements"
  /** ONE value-expression: a §61 `<endpoint>` arm's lowered arm value. */
  | "expression";

/**
 * Frame a slice for parsing, per its declared category.
 *
 * **HOW I KNOW EACH WRAPPER IS COMPLETE FOR ITS CATEGORY — the argument, not a list:**
 *
 *   `"statements"` -> the body of an **async generator**. That is the MAXIMAL
 *      statement context in JavaScript: `async` admits `await` (and `for await`),
 *      `function` admits `return`, `*` admits `yield` / `yield*`, and every other
 *      statement form is legal in any function body. There is no statement legal
 *      in a server-fn body that is illegal here, so the set is complete by
 *      CONSTRUCTION rather than by enumeration.
 *   `"expression"` -> the same context, with the slice **parenthesized**. Inside
 *      parentheses the expression grammar is unambiguous and maximal: an object
 *      literal is an object literal (not a labeled block — the round-2 bug), and
 *      `await` is still legal because the enclosing function is async. Every
 *      expression is legal in parentheses, so again complete by construction.
 *
 * The residual risk is no longer "which constructs?" — it is "did a call site
 * declare the wrong category?", which is five sites and a required parameter.
 */
function probeSource(loweredJs: string, sliceKind: ScanSliceKind): string {
  const inner = sliceKind === "expression" ? `(\n${loweredJs}\n);` : loweredJs;
  return `async function* _scrml_response_scan_probe() {\n${inner}\n}`;
}

/**
 * If `node` is a compile-time-constant STRING key, return its value; else null.
 * Same shape as `egress-field-scan.ts`'s helper of the same name, for the same
 * reason: `Response["json"]` names the same static member as `Response.json`.
 */
function staticStringKey(node: any): string | null {
  if (!node || typeof node !== "object") return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    Array.isArray(node.expressions) && node.expressions.length === 0 &&
    Array.isArray(node.quasis) && node.quasis.length === 1
  ) {
    const cooked = node.quasis[0]?.value?.cooked;
    if (typeof cooked === "string") return cooked;
  }
  return null;
}

/**
 * Find an author-constructed `Response` in a slice of ALREADY-LOWERED server JS,
 * in CODE POSITION, using acorn — never a text match. Built on the
 * `egress-field-scan.ts` template (iterative walk, no acorn-walk dependency) and
 * for the same reason: a text predicate cannot tell `new Response(...)` in code
 * from the same characters inside a string literal or a comment, and this gate
 * is a HARD ERROR, so a false fire breaks a build.
 *
 * ⚑ **IT CLASSIFIES BY WHETHER A BODY IS CARRIED — it does not simply "find a
 * `Response`".** The §14.8.9 obligation is about a payload the floor cannot
 * inspect, so a construction with no body cannot violate it and MUST NOT be an
 * error (S405 fix round: gating the null-body ones build-broke every `protect=`
 * app that issues a redirect, with no workaround, because this gate has no
 * escape hatch):
 *
 *   "body"             · `new Response(<body>, …)`      — body is argument 0
 *                      · `Response.json(<data>, …)`     — always serializes a body
 *                      · the computed spelling `Response["json"](…)`
 *   "null-body-static" · `Response.redirect(url, code)` — no body, but the runtime
 *                      · `Response.error()`               guard cannot see that
 *   null (silent)      · `new Response()` / `new Response(null, …)` — no body AND
 *                        runtime-recognizable via `.body === null`
 *
 * ⚑ **NOT RECOGNIZED, BY CONSTRUCTION — AND THIS BOUNDARY IS THE POINT, NOT A
 * TODO.** A `Response` reached by ALIASING (`const R = Response; new R()`), by
 * `await fetch(...)`, by `.clone()`, or returned from any callee this slice does
 * not contain, is invisible to ANY syntactic scan. Chasing those spellings is
 * the unbounded completeness fix with no done-condition. **This gate is an
 * EARLY WARNING that fires at build time on the shapes an author actually
 * writes; the GUARANTEE is the runtime refusal in `_scrml_protect_redact` and
 * the compiler-emitted `_scrml_protect_opaque_refusal()` guard at the sink,
 * which are exact because `instanceof Response` is exact.** Do not "complete"
 * this list — completing it is not possible and believing it is complete is the
 * failure this whole arc exists to remove.
 *
 * Fail direction: a slice acorn cannot parse returns `null` (no fire). That is
 * deliberately fail-OPEN *for the warning* and it is only defensible because the
 * warning is not the guarantee: the runtime refusal still holds. The alternative
 * — firing a confidentiality build-break because the compiler's own emitted
 * slice failed to parse — trades a real false-positive class for no security.
 *
 * @param loweredJs a slice of emitted server JS.
 * @param sliceKind which SYNTACTIC CATEGORY that slice is — see `ScanSliceKind`.
 *        REQUIRED, and required on purpose: see the ⚑ note on that type.
 * @returns the recognized spelling + kind (for the diagnostic), or null.
 */
export function findAuthoredResponseConstruction(
  loweredJs: string,
  sliceKind: ScanSliceKind,
): { spelling: string; kind: AuthoredResponseKind } | null {
  if (!loweredJs || !/\bResponse\b/.test(loweredJs)) return null;
  // A body-carrying construction OUTRANKS a null-body one: a body is an error, a
  // null-body static is only a warning, and a body found anywhere in this slice
  // is the verdict regardless of what else the slice contains or of the order
  // the walk happens to visit them in.
  let nullBodyHit: { spelling: string; kind: AuthoredResponseKind } | null = null;
  let root: any;
  try {
    root = acorn.parse(probeSource(loweredJs, sliceKind), RESPONSE_SCAN_PARSE_OPTIONS);
  } catch {
    // ⚑ REACHING HERE IS NOW A COMPILER-DEFECT SIGNAL, NOT AN EXPECTED PATH.
    // With the slice kind declared by the caller, both wrappers admit the FULL
    // grammar of their category (see `probeSource`), and the emitted JS is valid
    // by construction — so an unparseable slice means the emitter produced
    // invalid JS or a call site declared the wrong kind. It still returns null
    // (fail-open FOR THE WARNING ONLY, defensible solely because the runtime
    // refusal is the guarantee); firing a confidentiality build-break on a
    // compiler defect would trade a real false-positive class for no security.
    return null;
  }
  const stack: any[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }
    if (typeof node.type === "string") {
      if (
        node.type === "NewExpression" &&
        node.callee && node.callee.type === "Identifier" && node.callee.name === "Response"
      ) {
        // `new Response()` / `new Response(null, …)` is reported at NEITHER level:
        // it carries no body (so not an error) AND the runtime guard recognizes it
        // exactly via `.body === null` (so not a warning either). It just works.
        if (!isProvablyNullBodyResponse(node)) return { spelling: "new Response(...)", kind: "body" };
      }
      if (node.type === "CallExpression" && node.callee && node.callee.type === "MemberExpression") {
        const callee = node.callee;
        if (callee.object && callee.object.type === "Identifier" && callee.object.name === "Response") {
          const member = callee.computed
            ? staticStringKey(callee.property)
            : (callee.property && callee.property.type === "Identifier" ? callee.property.name : null);
          // NOTE the set: BODY-CARRYING, not the full producer set. `redirect`
          // and `error` are producers with a null body and must not be an ERROR —
          // see RESPONSE_BODY_CARRYING_PRODUCERS / RESPONSE_NULL_BODY_STATICS.
          if (member !== null && RESPONSE_BODY_CARRYING_PRODUCERS.has(member)) {
            return { spelling: `Response.${member}(...)`, kind: "body" };
          }
          if (member !== null && RESPONSE_NULL_BODY_STATICS.has(member) && !nullBodyHit) {
            nullBodyHit = { spelling: `Response.${member}(...)`, kind: "null-body-static" };
          }
        }
      }
    }
    for (const k in node) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = node[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return nullBodyHit;
}
