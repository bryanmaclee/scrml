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
 *   `globalThis["Resp"+"onse"]` -> "Response"   (index, FOLDED static key)
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
 * — the key's value is not in the tree; see `staticIndexKey` for exactly which
 * keys ARE in the tree, including a folded `+` of string literals). A null
 * answer is a NON-match, which is safe here only because the caller treats "no
 * recognised egress" as "the compiler owns this sink" — see the population note
 * on `collectRawEgressFacts` / `detectProtectedRawEgressAcrossFns`.
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
 * string the tree already carries. A double-quoted string and an UN-INTERPOLATED
 * backtick template are both literal `kind: "lit"` nodes with the interpreted
 * `value` on them (`types/ast.ts` LitExpr), so this reads the tree's own answer
 * — it is not a re-scan of source text (invariant 55).
 *
 * **A `+` of static string keys folds, recursively (S354, adversarial round 3).**
 * `globalThis["Resp" + "onse"]` denotes exactly what `globalThis["Response"]`
 * denotes: both operands are literals sitting in the tree, so the key IS static,
 * and a gate that answers only the un-concatenated spelling is one `+` away from
 * a leak. Measured before this fold landed: that exact program compiled at exit 0
 * with ZERO diagnostics on every tree, and the emitted handler, executed against
 * a stubbed `_scrml_sql`, answered
 * `{"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}`. The fold is
 * STRING-only — a numeric `+` is arithmetic, not concatenation, so `a[1 + 1]`
 * still answers null rather than the wrong string `"11"`.
 *
 * Returns null for a key whose value is genuinely NOT in the tree: an identifier
 * (`a[k]`), a call result, a conditional, and an INTERPOLATED template
 * (`` a[`Resp${x}onse`] ``, whose `value` is `""` and therefore not the key —
 * this previously answered `""`, a non-match by accident rather than by
 * decision). Closing any of those needs the name resolver / constant
 * propagation, not a wider key test.
 */
function staticIndexKey(index: unknown): string | null {
  if (!index || typeof index !== "object") return null;
  const i = index as { kind?: string; op?: string; left?: unknown; right?: unknown };
  if (i.kind === "binary" && i.op === "+") {
    const left = staticIndexKey(i.left);
    if (left === null) return null;
    const right = staticIndexKey(i.right);
    if (right === null) return null;
    return left + right;
  }
  return staticStringLiteralValue(index);
}

/**
 * The interpreted value of a node that is a STATIC string literal, or null.
 *
 * Both an un-interpolated and an interpolated backtick template parse to the
 * same node (`lit` / `litType: "template"`); the parser distinguishes them only
 * by what it puts ON the node. `templateLitIsStatic` is that test — see it for
 * why the discrimination is structural and which way it errs.
 */
function staticStringLiteralValue(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as { kind?: string; litType?: string; value?: unknown; raw?: unknown };
  if (n.kind !== "lit") return null;
  if (n.litType !== "string" && n.litType !== "template") return null;
  if (typeof n.value !== "string") return null;
  if (n.litType === "template" && !templateLitIsStatic(n)) return null;
  return n.value;
}

/**
 * Is this `lit` / `litType: "template"` node an UN-INTERPOLATED template?
 *
 * The parser gives both forms the same `kind` and `litType`
 * (`expression-parser.ts`, `case "TemplateLiteral"`), so the discrimination has
 * to come off the fields it does set:
 *   - single-quasi (no `${}`): `raw` is built as "`" + cooked + "`" and `value`
 *     IS the cooked text, so `raw === "`" + value + "`"` holds exactly;
 *   - multi-quasi (with `${}`): `value` is `""` by construction and `raw` is the
 *     template's own source slice, so that equality fails.
 *
 * The `!raw.includes("${")` conjunct closes the parser's own defensive fallback,
 * where a multi-quasi template that could not be sliced falls back to
 * `astringGenerate` (which still renders `${…}`) or, in the last resort, to a
 * bare pair of backticks — a shape that would otherwise read as an empty STATIC
 * template. It costs one false NEGATIVE: an ESCAPED dollar in a single-quasi
 * template is genuinely static but reads as interpolated, because the parser
 * reconstructs that node's `raw` from the cooked text and the backslash is gone
 * by then. That is the fail-CLOSED direction (the value reads as caller-bearing,
 * so the gate fires), which is the only direction a confidentiality floor may
 * err in.
 */
function templateLitIsStatic(n: { value?: unknown; raw?: unknown }): boolean {
  if (typeof n.value !== "string" || typeof n.raw !== "string") return false;
  if (n.raw.includes("${")) return false;
  return n.raw === "`" + n.value + "`";
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

/**
 * Is this expression node SYNTACTICALLY a literal — a value written out in the
 * source, carrying nothing the caller supplied?
 *
 * **This is the S354 narrowing of the EGRESS test, and its shape is the ruling.**
 * `E-PROTECT-004` fires on CO-OCCURRENCE within a call-reachable set, not on
 * flow, which is what makes it sound; but a `Response` whose every argument is a
 * literal cannot carry caller data at all, so counting it as an egress is not
 * conservatism, it is a defect. Measured: this program is clean on `main` and
 * fired on the round-3 head —
 *
 * ```scrml
 * function loadUser(id) { return ?{`SELECT * FROM users WHERE id = ${id}`}.get() }
 * function deny()       { return new Response("Forbidden", { status: 403 }) }
 * export server function dispatch(id) {
 *   if (id < 0) { return deny() }
 *   let u = loadUser(id)
 *   return { name: u.name }        // compiler-emitted path — redacts correctly
 * }
 * ```
 *
 * `dispatch` reaches both, so round 3's rule fired — while `deny()` returns a
 * CONSTANT and `u` leaves by the redacting path. SPEC §40.3.5's own early-return
 * example is exactly `deny`'s body, so the gate was rejecting the shape the SPEC
 * documents whenever any protected query sat in the same reachable set.
 *
 * **SYNTACTIC, and deliberately so.** A named binding is NOT a literal even when
 * its initializer is: `new Response(SOME_CONST)` still fires, and resolving
 * `SOME_CONST` is the flow analysis the ruling REJECTED — on direction, not cost.
 * A dataflow gate trades this precision bug for a soundness bug, because every
 * gap in a dataflow analysis is a fail-OPEN, and fail-closed is the only property
 * that makes §14.8.9 worth having.
 *
 * **RETURN POSITION ONLY (S355, round 5).** This test is TRUE OF THE
 * CONSTRUCTION AND FALSE OF THE BINDING. A `Response` is a live, mutable handle:
 * its headers are writable after it is built, so "every argument is a literal"
 * says nothing about what the object carries by the time it leaves the function.
 * Reproduced, and the fail-OPEN it opened against `origin/main`:
 *
 * ```scrml
 * export server function getUser(id) {
 *   let u = ?{`SELECT * FROM users WHERE id = ${id}`}.get()
 *   let r = new Response("ok", { status: 200 })
 *   r.headers.set("x-user", u.passwordHash)   // ships the secret in a header
 *   return r
 * }
 * ```
 *
 * — silent at exit 0 with the narrowing applied everywhere; `E-PROTECT-004` on
 * `origin/main`. Same for `.headers.append(...)`, for `new Response()` with no
 * arguments, and for `Response.json({ok:true})` bound to a name.
 *
 * So the narrowing applies ONLY where the construction is the RETURN VALUE —
 * `return new Response("Forbidden", { status: 403 })`, which is §40.3.5's own
 * worked example and the ONE shape the ruling was granted for. A construction
 * assigned to a binding stays an egress, because a binding can be mutated and
 * the gate does not track mutation. The predicate is still PURELY SYNTACTIC (is
 * this node the `exprNode` of a `return-stmt`?) so it does not drift toward the
 * flow analysis the ruling rejected, and it is strictly fail-CLOSED relative to
 * applying the narrowing everywhere.
 *
 * Deliberately NOT return position, every one the fail-CLOSED answer: an arrow's
 * EXPRESSION body (`() => new Response("x")`), a construction under a ternary or
 * a `||` inside a `return`, and a construction returned through a temporary. All
 * three are one syntactic step away from the shape the ruling names, and none of
 * them is that shape.
 *
 * What counts:
 *   - `lit` — string / number / bool / absence, and an UN-INTERPOLATED template
 *     (see `templateLitIsStatic`; an interpolated one is not a literal);
 *   - `array` / `object` literals whose every element / property value is itself
 *     literal (`{ status: 403 }`, `["a", "b"]`);
 *   - `spread` of a literal (`[...["a"]]`), by the same rule.
 *
 * What does NOT, every one of them the fail-CLOSED answer:
 *   - an identifier, member, index or call — `JSON.stringify(u)`, `SOME_CONST`,
 *     `row.name`;
 *   - an object SHORTHAND property (`{ status }` reads a binding);
 *   - any operator node, including a `+` of two string literals. That fold is
 *     available (`staticIndexKey` does it for a bracket KEY, where the question
 *     is "which property does this denote" and answering it wrong is a fail-OPEN)
 *     but it is deliberately NOT taken here, where the question is "may caller
 *     data ride this argument" and the wrong answer is a fail-OPEN in the other
 *     direction. A `+` is an expression, not a literal.
 *
 * provenance: ruling:user-voice-scrml.md S354 (delta-log [1606])
 */
function isSyntacticLiteral(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { kind?: string; litType?: string; elements?: unknown; props?: unknown; argument?: unknown };
  switch (n.kind) {
    case "lit":
      return n.litType !== "template" || templateLitIsStatic(n as { value?: unknown; raw?: unknown });
    case "array":
      return Array.isArray(n.elements) && n.elements.every(isSyntacticLiteral);
    case "object":
      return Array.isArray(n.props) && n.props.every(objectPropIsLiteral);
    case "spread":
      return isSyntacticLiteral(n.argument);
    default:
      return false;
  }
}

/** One `{ … }` property, under the same rule. See `isSyntacticLiteral`. */
function objectPropIsLiteral(prop: unknown): boolean {
  if (!prop || typeof prop !== "object") return false;
  const p = prop as { kind?: string; key?: unknown; value?: unknown; computed?: boolean; argument?: unknown };
  if (p.kind === "prop") {
    // A static key is a plain string on the node and carries nothing; a COMPUTED
    // key is an expression and has to answer the same test as the value.
    if (p.computed === true && !isSyntacticLiteral(p.key)) return false;
    if (p.computed !== true && typeof p.key !== "string" && !isSyntacticLiteral(p.key)) return false;
    return isSyntacticLiteral(p.value);
  }
  if (p.kind === "spread") return isSyntacticLiteral(p.argument);
  // `shorthand` — `{ status }` is an identifier reference, not a literal.
  return false;
}

/**
 * Do ALL of a construction's arguments read as literals — i.e. can no caller
 * value ride this egress? An argument list the walk cannot see as an array is
 * UNKNOWN, and UNKNOWN answers false here (the construction IS an egress), which
 * is the fail-CLOSED direction. An EMPTY list answers true: `new Response()`
 * carries nothing.
 */
function argsAreAllLiterals(args: unknown): boolean {
  if (!Array.isArray(args)) return false;
  return args.every(isSyntacticLiteral);
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
 * The structural walk's depth cap.
 *
 * This is a RESOURCE bound (JS call-stack depth), NOT a correctness one:
 * exceeding it does not truncate the answer, it FAILS CLOSED (`truncated`).
 * That distinction is the whole point — silently truncating a fail-CLOSED check
 * is a fail-OPEN, and raising the number cannot fix it, because ANY finite cap
 * has a boundary. What has to be right is the BEHAVIOUR at the boundary.
 *
 * `depth` counts EDGES, and an array costs two (the container, then each
 * element), so 512 internal levels is ≈250 levels of source nesting, not 512.
 * The measured max over the 1878-body corpus is 37, so a real body never reaches
 * the cap; when a synthetic one does, the compiler says it could not analyse the
 * body rather than passing it. Measured on this exact walk before the cap was
 * made fail-closed: a protected row reaching `new Response(...)` under 250
 * nested array literals fired E-PROTECT-004 and under 255 did NOT — compiling at
 * exit 0, zero diagnostics, and the executed handler shipped the secret.
 */
const RAW_EGRESS_MAX_DEPTH = 512;

/**
 * What one function BODY carries, as read off its parsed tree. Deliberately raw
 * facts rather than a verdict: the verdict is a whole-file question, because a
 * protected SELECT and the raw egress it reaches need not sit in the same body
 * (see `detectProtectedRawEgressAcrossFns`).
 */
export interface RawEgressFacts {
  /** The first protected-origin `?{}` SELECT in this body (normalized, capped
   *  at 60 chars for the message), or null. */
  protectedQuery: string | null;
  /** A `_{}` foreign-code block (§23) — opaque interior. */
  sawForeign: boolean;
  /** A manual `Response` / `handle()` body (§40). */
  sawResponse: boolean;
  /** An `asIs`-typed value (§14.1.1). */
  sawAsIs: boolean;
  /** Bare-identifier callee names invoked from this body — the intra-file call
   *  graph's out-edges. */
  calls: string[];
  /** The walk hit `RAW_EGRESS_MAX_DEPTH`: every field above is UNKNOWN rather
   *  than "no", and the gate fails CLOSED on this body. */
  truncated: boolean;
}

/**
 * §14.8.9 fail-closed gate (E-PROTECT-004), body half — read the facts a single
 * server-function body carries about a protected-origin value reaching a RAW /
 * compiler-UNANALYZABLE egress, where the structural redaction floor cannot
 * guarantee the strip:
 *   - a `_{}` foreign-code block (§23) — opaque interior;
 *   - a manual `Response` / `handle()` body (§40) — the floor's redact passes a
 *     `Response` instance through untouched (it cannot introspect a serialized
 *     body), so a row manually serialized there would LEAK;
 *   - an `asIs`-typed value (§14.1.1) — escapes the type system.
 *
 * The closed-world precondition of §14.8.9 rests on every egress being compiler-
 * emitted and descriptor-preserving; the gate enforces it fail-closed.
 * Conservative BY DESIGN: co-occurrence of a protected query and a raw egress
 * within one call-reachable set fires (the floor never silently ships a
 * protected column through a path it cannot redact). It does not prove the row
 * reaches the egress; it declines to prove that it does not.
 *
 * A body the walk cannot traverse in full (nesting past `RAW_EGRESS_MAX_DEPTH`)
 * comes back `truncated`, and the caller fires on it unconditionally: an
 * un-walked subtree is itself an egress the compiler cannot analyse. See the cap
 * constant — the boundary BEHAVIOUR is the load-bearing part.
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
 *      A key BUILT from literals is a different case and is CLOSED, not
 *      residual: `globalThis["Resp" + "onse"]` folds, because both operands sit
 *      in the tree (S354 — `staticIndexKey`). Measured before that fold: it
 *      compiled at exit 0 with zero diagnostics on every tree and the executed
 *      handler shipped the secret. "The key's value is not in the tree" is the
 *      bound, and a concatenation of literals does not meet it.
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
 *   2. **The call graph is INTRA-FILE and by BARE-IDENTIFIER callee.** The
 *      cross-function shape itself is CLOSED (see
 *      `detectProtectedRawEgressAcrossFns`), but its edges are syntactic: a
 *      cross-FILE import, a call through a value (`handlers[k]()`), and a call
 *      on a member (`obj.method()`) contribute no edge, so a protected SELECT
 *      reachable only through one of those is still invisible. Same syntactic
 *      bound as (1), same fix (the name resolver).
 *
 *   3. **Only `Response.json` is a static-factory egress.** `Response.redirect`
 *      / `Response.error` carry no caller-supplied body, so no protected column
 *      can ride them.
 *
 *   4. **A construction whose arguments are all literals, IN RETURN POSITION, is
 *      not an egress** (S354, narrowed S355). `return new Response("Forbidden",
 *      { status: 403 })` carries nothing the caller supplied. The test is
 *      SYNTACTIC — `new Response(SOME_CONST)` still fires even when `SOME_CONST`
 *      is a module-level string, because resolving the binding is the flow
 *      analysis the ruling rejected. See `isSyntacticLiteral`. This is a
 *      PRECISION narrowing of a fail-closed gate and the only one in this file:
 *      everything else here errs closed.
 *
 *      RETURN POSITION is load-bearing. A `Response` is a live mutable handle,
 *      so the all-literal test is true of the CONSTRUCTION and false of the
 *      BINDING: `let r = new Response("ok"); r.headers.set("x", u.passwordHash);
 *      return r` compiled at exit 0 with the narrowing applied everywhere, and
 *      the executed handler shipped the secret in a header. A construction
 *      assigned to a binding is therefore still an egress — the gate does not
 *      track mutation, so it declines to assume there is none.
 *
 *      The exemption is keyed on the NODE the `return-stmt` holds. Its bound:
 *      if the AST ever memoized one expression node into two positions — one of
 *      them a `return`, one of them not — the `seen` guard would visit it once
 *      and the exemption could carry to the non-return position. Measured on
 *      this tree: identical `new Response("Forbidden", { status: 403 })` text in
 *      a `let` and in a `return` produces TWO distinct nodes (the walk reports
 *      both), so the aliasing does not occur; it is stated because the property
 *      belongs to the expression parser, not to this file.
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
export function collectRawEgressFacts(
  fnNode: unknown,
  ctx: ProtectContext,
): RawEgressFacts {
  if (!fnNode || typeof fnNode !== "object") {
    return { protectedQuery: null, sawForeign: false, sawResponse: false, sawAsIs: false, calls: [], truncated: false };
  }

  let protectedQuery: string | null = null;
  let sawForeign = false;
  let sawResponse = false;
  let sawAsIs = false;
  const calls = new Set<string>();

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
  let truncated = false;
  const seen = new WeakSet<object>();
  // `isReturnValue` is TRUE for exactly one node: the `exprNode` a `return-stmt`
  // holds, visited explicitly from the `return-stmt` branch below. Every other
  // recursion passes FALSE. That one bit is the whole of the S355 return-position
  // rule (see `isSyntacticLiteral`) — a construction is exempt from the
  // all-literal narrowing only where it IS the returned value.
  const visit = (node: unknown, depth: number, isReturnValue: boolean): void => {
    if (!node || typeof node !== "object") return;
    if (depth > RAW_EGRESS_MAX_DEPTH) {
      truncated = true;
      return;
    }
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1, false);
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
    // The callee resolves through its member chain, so every spelling of the
    // constructor answers the same. The ARGUMENTS decide whether it is an egress
    // at all: a construction whose arguments are syntactically all literals
    // carries nothing the caller supplied, so it cannot leak a protected row
    // (S354 — see `isSyntacticLiteral`, which states the boundary and why the
    // test is syntactic rather than a flow analysis).
    //
    // `new <chain>.Response(...)`.
    if (
      n.kind === "new" &&
      terminalName(n.callee) === "Response" &&
      !(isReturnValue && argsAreAllLiterals(n.args))
    ) {
      sawResponse = true;
    }
    // `<chain>.Response.json(...)` — a static factory call on the same receiver.
    if (
      n.kind === "call" &&
      terminalName(n.callee) === "json" &&
      memberReceiverName(n.callee) === "Response" &&
      !(isReturnValue && argsAreAllLiterals(n.args))
    ) {
      sawResponse = true;
    }

    // --- egress kind 3: an `asIs`-typed value (§14.1.1) ---------------------
    if (annotationIsAsIs(n.typeAnnotation) || annotationIsAsIs(n.returnTypeAnnotation)) {
      sawAsIs = true;
    }

    // --- the intra-file call graph edge ------------------------------------
    // A BARE-IDENTIFIER callee only. `obj.method()` is a call on a value, not on
    // a file-level function declaration, and the caller resolves these names
    // against the file's own `function-decl` set — so an unresolved name simply
    // contributes no edge.
    if (n.kind === "call") {
      const callee = n.callee as { kind?: string; name?: string } | undefined;
      if (callee && callee.kind === "ident" && typeof callee.name === "string") calls.add(callee.name);
    }

    // --- RETURN POSITION (S355) -------------------------------------------
    // A `return-stmt` carries the returned expression on `exprNode` (it also
    // carries `expr`, the same expression in STRING form, which the generic loop
    // below skips as a non-object). Visit `exprNode` HERE, with the flag set, so
    // the all-literal narrowing applies to a construction that IS the returned
    // value and to nothing else. The generic loop then re-reaches the same node
    // and the `seen` guard makes that a no-op.
    if (n.kind === "return-stmt") {
      visit(n.exprNode, depth + 1, true);
    }

    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      visit(n[key], depth + 1, false);
    }
  };
  visit(fnNode, 0, false);

  return { protectedQuery, sawForeign, sawResponse, sawAsIs, calls: [...calls], truncated };
}

/**
 * The human-readable egress kind a body carries, or null for none. The priority
 * is FIXED rather than traversal-ordered, so the reported kind does not depend
 * on where in the body each construct happens to sit.
 */
function egressKindOf(facts: RawEgressFacts): string | null {
  if (facts.sawForeign) return "a `_{}` foreign-code block (§23)";
  if (facts.sawResponse) return "a manual `Response` / `handle()` body (§40)";
  if (facts.sawAsIs) return "an `asIs`-typed value (§14.1.1)";
  return null;
}

/** The `MAX_DEPTH` message fragment, shared by the truncation detection. */
const TRUNCATED_EGRESS_KIND =
  "a body the compiler could not analyse in full — its nesting exceeds the " +
  `§14.8.9 structural-analysis depth cap (${RAW_EGRESS_MAX_DEPTH} tree levels)`;

/**
 * One E-PROTECT-004 detection, resolved against the whole file's function set.
 */
export interface ProtectedRawEgressDetection {
  /** The `function-decl` node the diagnostic is reported ON. */
  fn: unknown;
  /** The offending protected SELECT (normalized, truncated), or null when the
   *  detection is a truncated (unanalyzable) body with no resolved query. */
  query: string | null;
  /** Human-readable egress kind for the message. */
  egressKind: string;
  /** Set when the detection is the fail-closed answer for an un-walkable body. */
  truncated?: true;
  /** The call path `fn -> … -> <the fn that holds the protected SELECT>`, when
   *  the SELECT is not in `fn`'s own body. */
  queryVia?: string[];
  /** The call path `fn -> … -> <the fn that holds the raw egress>`, when the
   *  egress is not in `fn`'s own body. */
  egressVia?: string[];
}

/**
 * §14.8.9 fail-closed gate, resolved ACROSS the file's function set.
 *
 * The per-body test this widens (co-occurrence of a protected `?{}` and a raw
 * egress in ONE function) missed the most ordinary shape an adopter writes:
 *
 * ```scrml
 * function loadUser(id) { return ?{`SELECT * FROM users WHERE id = ${id}`}.get() }
 * export server function getUser(id) {
 *   let u = loadUser(id)
 *   return new Response(JSON.stringify(u))          // ships passwordHash
 * }
 * ```
 *
 * Measured, by executing the emitted handler against a stubbed `_scrml_sql`:
 * that program, and its mirror (query in the caller, `new Response` in the
 * helper), and a two-hop chain, ALL answered
 * `{"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}` at exit 0 with zero
 * diagnostics. Splitting a function in two is not a security boundary, so the
 * gate must not treat it as one.
 *
 * The rule: for each function `F`, let `reach(F)` = `F` plus every function `F`
 * transitively CALLS within this file. `F` fires when `reach(F)` contains BOTH a
 * protected SELECT and a raw egress. Forward reachability alone covers both flow
 * directions, because it is evaluated at every function:
 *
 *   - SELECT in a callee, egress in `F`   — the row RETURNS into `F`'s egress;
 *   - SELECT in `F`, egress in a callee   — the row is PASSED IN as an argument;
 *   - both in callees of a common `F`     — the row moves callee → `F` → callee.
 *
 * and two functions with no call path between them share no data path, so they
 * do not fire (verified: an unrelated protected query plus an unrelated §40.3.5
 * `403` in the same file stays silent).
 *
 * This stays a CO-OCCURRENCE test, exactly as conservative as the per-body form
 * — it does not prove the protected row reaches the egress, it declines to prove
 * it does not. Widening the unit from "one body" to "one call-reachable set" is
 * what makes the conservatism honest: the old unit was a boundary the author
 * could cross by pressing Extract Function.
 *
 * **Bound.** The call graph is INTRA-FILE and by BARE-IDENTIFIER callee:
 * a cross-file import, a call through a value (`handlers[k]()`), and a call on a
 * member (`obj.method()`) contribute no edge. Those are the same syntactic bound
 * as the callee resolution above, and closing them needs the name resolver.
 *
 * provenance: ruling:user-voice-scrml.md S352 (dpa-029 Q1, dpa-033 (c))
 */
export function detectProtectedRawEgressAcrossFns(
  fnNodes: readonly unknown[],
  ctx: ProtectContext,
): ProtectedRawEgressDetection[] {
  const nodes = fnNodes.filter((f) => f && typeof f === "object");
  const facts = nodes.map((f) => collectRawEgressFacts(f, ctx));
  const nameOf = (f: unknown): string => (f as { name?: string }).name ?? "<anonymous>";

  // name -> EVERY index declaring it. A MULTIMAP, not a first-wins map (S354,
  // adversarial round 3).
  //
  // The comment this replaces asserted "first declaration wins on a duplicate
  // name (the emitter's own resolution order)", and that property is FALSE.
  // Measured: with the SAFE `loadUser` declared first and the protected one
  // declared last, the gate resolved `getUser`'s edge to the first while the
  // emitter emitted the SECOND as the in-process peer — the program compiled at
  // exit 0 with zero diagnostics and the executed handler answered
  // `{"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}`.
  //
  // A duplicate name is a shadowing question the call-graph edge is the wrong
  // place to answer. Contributing an edge to EVERY declaration is the fail-CLOSED
  // answer: whichever one the emitter picks, the gate has already looked at it.
  // The cost is a possible over-report on a file that declares the same function
  // name twice, which is a shape a linter should be rejecting anyway; the cost of
  // the other answer is a shipped secret.
  //
  // A name with no declaration in this file still contributes no edge (the
  // intra-file bound, stated below).
  const indicesByName = new Map<string, number[]>();
  nodes.forEach((f, i) => {
    const n = nameOf(f);
    const bucket = indicesByName.get(n);
    if (bucket) bucket.push(i);
    else indicesByName.set(n, [i]);
  });

  /**
   * BFS over the call edges from `root`, returning for each reached index the
   * call PATH that reached it (so the diagnostic can name `f -> g -> h` rather
   * than just `h`). Recursion / mutual recursion terminates on the visited set.
   */
  const reachFrom = (root: number): Map<number, string[]> => {
    const paths = new Map<number, string[]>([[root, [nameOf(nodes[root])]]]);
    const queue = [root];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curPath = paths.get(cur)!;
      for (const calleeName of facts[cur].calls) {
        for (const next of indicesByName.get(calleeName) ?? []) {
          if (paths.has(next)) continue;
          paths.set(next, [...curPath, calleeName]);
          queue.push(next);
        }
      }
    }
    return paths;
  };

  const out: ProtectedRawEgressDetection[] = [];
  for (let i = 0; i < nodes.length; i++) {
    // FAIL CLOSED on an unanalyzable body, before anything else: the walk
    // stopped short of the whole tree, so "no protected query here", "no raw
    // egress here" AND "no call edges here" are all UNKNOWN, not "no".
    if (facts[i].truncated) {
      out.push({ fn: nodes[i], query: facts[i].protectedQuery, egressKind: TRUNCATED_EGRESS_KIND, truncated: true });
      continue;
    }

    const reached = reachFrom(i);

    // The protected SELECT: prefer this body's own, else the shortest reached.
    let query = facts[i].protectedQuery;
    let queryVia: string[] | undefined;
    if (query === null) {
      for (const [idx, path] of reached) {
        if (idx !== i && facts[idx].protectedQuery !== null) {
          query = facts[idx].protectedQuery;
          queryVia = path;
          break;
        }
      }
    }
    if (query === null) continue;

    // The raw egress: same preference order.
    let egressKind = egressKindOf(facts[i]);
    let egressVia: string[] | undefined;
    if (egressKind === null) {
      for (const [idx, path] of reached) {
        if (idx === i) continue;
        const k = egressKindOf(facts[idx]);
        if (k !== null) {
          egressKind = k;
          egressVia = path;
          break;
        }
      }
    }
    if (egressKind === null) continue;

    out.push({ fn: nodes[i], query, egressKind, queryVia, egressVia });
  }
  return out;
}
