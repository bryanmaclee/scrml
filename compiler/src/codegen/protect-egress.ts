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
 *   4. (dpa-030 D2c) "the single compiler-owned egress sink" was a PREMISE, not a
 *      fact. A hand-written `new Response(JSON.stringify(row))` is a second sink,
 *      it is reachable from clean scrml source, and `JSON.stringify` drops the
 *      descriptor by the same property that makes the descriptor invisible in
 *      output. So a tagged row now carries a non-enumerable `toJSON` that returns
 *      the REDACTED projection. Deny-unless-revealed at the SERIALIZER — which is
 *      where the boundary actually is, and which is why it needs no allow-list of
 *      egress shapes and produces no false positive on a body that returns a bare
 *      `403` with no row in it.
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
  "//",
  "// A tagged row ALSO carries a non-enumerable `toJSON`, so serializing it",
  "// directly -- `new Response(JSON.stringify(row))` in a hand-written handler --",
  "// yields the REDACTED projection, not the raw row. Without it the descriptor is",
  "// silently dropped at exactly the boundary it exists to guard: `JSON.stringify`",
  "// ignores Symbol keys, which is what makes the descriptor invisible in the",
  "// output AND what makes it useless there. `reveal(\"col\")` rebuilds the",
  "// descriptor and reinstalls the hook, so a declassified column still ships.",
  "const _SCRML_PROTECT = Symbol.for(\"scrml.protect.origin\");",
  "function _scrml_protect_mark(row, descriptor) {",
  "  row[_SCRML_PROTECT] = descriptor;",
  "  // Non-enumerable: invisible to `Object.keys` / `{...row}` / the redactor's own",
  "  // rebuild, so it never appears as a column in any output.",
  "  Object.defineProperty(row, \"toJSON\", {",
  "    value: function () { return _scrml_protect_redact(this); },",
  "    enumerable: false, configurable: true, writable: true,",
  "  });",
  "  return row;",
  "}",
  "function _scrml_protect_tag(value, cols) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) {",
  "    for (const row of value) {",
  "      if (row != null && typeof row === \"object\" && !Array.isArray(row)) _scrml_protect_mark(row, { cols, revealed: [] });",
  "    }",
  "    return value;",
  "  }",
  "  return _scrml_protect_mark(value, { cols, revealed: [] });",
  "}",
  "function _scrml_protect_reveal(value, col) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) return value.map((r) => _scrml_protect_reveal(r, col));",
  "  const d = value[_SCRML_PROTECT];",
  "  if (!d) return value;",
  "  const next = { ...value };",
  "  return _scrml_protect_mark(next, { cols: d.cols, revealed: [...d.revealed, col] });",
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

// ---------------------------------------------------------------------------
// §14.8.9 fail-closed gate (E-PROTECT-004) — the STRUCTURAL detector.
//
// WHAT THIS REPLACED, AND WHY IT HAD TO GO. Until dpa-030 this gate was a
// per-body SOURCE-TEXT co-occurrence regex over the fn's source slice:
//
//     /\bnew\s+Response\b/    /\bResponse\s*\.\s*json\b/    /\basIs\b/
//     /(^|[^A-Za-z0-9_$])_\{/     and     /\.\s*reveal\s*\(/  -> suppress ALL
//
// It was documented as a fail-closed gate. It was a LINT, and the mislabelling
// was the worse defect, because everything downstream — the SPEC row, the
// conformance case, the §14.8.9 closed-world argument — was written as if a
// sound gate existed. Measured evasions, all of which compiled CLEAN and shipped
// the protected column at HTTP 200:
//
//   · `new globalThis.Response(...)` — `\bnew\s+Response\b` does not match;
//   · `const R = globalThis.Response` … `new R(...)` — nothing matches;
//   · ANY `.reveal(` anywhere in the body — including `u.reveal("name")` on a
//     column that is not protected — suppressed the gate for EVERY protected
//     column in that body.
//
// Rule 7: don't ask the text what the tree already knows. The `function-decl`
// node this gate is handed carries `sqlNode.kind === "sql"` with the query text,
// `initExpr` for an alias binding, `exprNode` with a real `{kind:"new", callee:
// {kind:"member", object:{kind:"ident",name:"globalThis"}, property:"Response"}}`
// callee, `typeAnnotation: "asIs"`, and `kind: "foreign"` for `_{}`. Every
// evasion above is visible in the tree; none of them is visible to a regex over
// the same bytes.
//
// The walk is STRUCTURAL per invariant 52: every array- and object-valued
// property is descended, exclusions are a two-clause deny-list (`span`, plus the
// `_`-prefixed side-table convention), termination is an identity `seen` set plus
// a 512 depth cap. Enumerating field names is the fail-OPEN shape and "add the
// missing field" is the defect class, not the fix.
//
// SOUNDNESS BOUND, STATED HONESTLY. This gate is WITHIN-FUNCTION. A row fetched
// in fn A, returned to fn B, and serialized into a `Response` there is NOT caught
// here — neither body co-occurs with the other's half. That case is closed at
// RUNTIME instead, by the `toJSON` the tagged row carries (see
// SERVER_PROTECT_HELPER), because the descriptor travels with the VALUE and a
// call-graph closure only tracks NAMES. The two are complementary: this one is
// loud and early, that one is total and late.
// ---------------------------------------------------------------------------

/** Global namespace objects whose `.<name>` IS the global of that name. */
const GLOBAL_NAMESPACE_OBJECTS: ReadonlySet<string> = new Set(["globalThis", "window", "self"]);

/** The raw-egress constructor names §14.8.9 cannot redact past. */
const RAW_EGRESS_CTORS: ReadonlySet<string> = new Set(["Response"]);

type AnyNode = Record<string, unknown>;

const isNode = (v: unknown): v is AnyNode =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Structural walk shared by the collectors below. Descends EVERY array- and
 * object-valued property; the only exclusions are `span` (pure position data)
 * and the codebase's `_`-prefixed side-table convention.
 */
function walkStructurally(root: unknown, visit: (node: AnyNode) => void): void {
  const seen = new Set<unknown>();
  const go = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== "object" || depth > 512) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const el of node) go(el, depth + 1);
      return;
    }
    visit(node as AnyNode);
    for (const key of Object.keys(node as AnyNode)) {
      if (key === "span" || key.startsWith("_")) continue;
      go((node as AnyNode)[key], depth + 1);
    }
  };
  go(root, 0);
}

/**
 * Resolve an expression node to the GLOBAL name it constructs / reads, following
 * `globalThis.X` / `window.X` / `self.X` and any local alias binding. Returns
 * null when the node does not name a global.
 */
function resolveGlobalName(node: unknown, aliases: Map<string, string>): string | null {
  if (!isNode(node)) return null;
  if (node.kind === "ident" && typeof node.name === "string") {
    return aliases.get(node.name) ?? node.name;
  }
  if (
    node.kind === "member"
    && typeof node.property === "string"
    && isNode(node.object)
    && node.object.kind === "ident"
    && typeof node.object.name === "string"
    && GLOBAL_NAMESPACE_OBJECTS.has(node.object.name)
  ) {
    return node.property;
  }
  return null;
}

/**
 * Local `const R = globalThis.Response` style aliases, collected in a first pass
 * so a `new R(...)` earlier in walk order than its binding still resolves. The
 * alias is transitive by construction: a second `const S = R` resolves through
 * the map because `resolveGlobalName` consults it for a bare ident.
 */
function collectGlobalAliases(fnNode: unknown): Map<string, string> {
  const aliases = new Map<string, string>();
  // Two sweeps so `const S = R` picks up `const R = globalThis.Response`
  // regardless of which the walk reaches first.
  for (let pass = 0; pass < 2; pass++) {
    walkStructurally(fnNode, (n) => {
      if ((n.kind !== "const-decl" && n.kind !== "let-decl") || typeof n.name !== "string") return;
      const target = resolveGlobalName(n.initExpr, aliases);
      if (target && target !== n.name) aliases.set(n.name, target);
    });
  }
  return aliases;
}

/**
 * Column names declassified by a `reveal("col")` in this body.
 *
 * Two spellings, both structural: a `.reveal("col")` member call on the value
 * (`{kind:"call", callee:{kind:"member", property:"reveal"}, args:[lit]}`), and
 * a `?{}.reveal("col")` query chain (`chainedCalls: [{method:"reveal", args}]`).
 * The chain form's `args` is a raw argument-list STRING the parser produced — a
 * leaf, not a body scan — so lexing a string literal out of it is reading the
 * parser's own output, not re-parsing the source.
 *
 * A DYNAMIC `u.reveal(colName)` contributes NOTHING to this set: it cannot be
 * proven to cover any particular column, and §14.8.9 is a fail-closed floor, so
 * an unprovable declassification declassifies nothing. That is a loud, reversible
 * refusal; the alternative (treat it as covering everything) is the off-switch
 * this change exists to remove. Measured: zero dynamic reveals in the corpus.
 */
function collectRevealedColumns(fnNode: unknown): Set<string> {
  const cols = new Set<string>();
  const literalArg = (arg: unknown): string | null => {
    if (!isNode(arg)) return null;
    if (arg.kind === "lit" && arg.litType === "string" && typeof arg.value === "string") {
      return arg.value;
    }
    return null;
  };
  walkStructurally(fnNode, (n) => {
    if (
      n.kind === "call"
      && isNode(n.callee)
      && n.callee.kind === "member"
      && n.callee.property === "reveal"
    ) {
      for (const a of (Array.isArray(n.args) ? n.args : [])) {
        const lit = literalArg(a);
        if (lit !== null) cols.add(lit);
      }
      return;
    }
    if (Array.isArray(n.chainedCalls)) {
      for (const call of n.chainedCalls) {
        if (!isNode(call) || call.method !== "reveal") continue;
        const raw = typeof call.args === "string" ? call.args : "";
        for (const m of raw.matchAll(/["']([^"']*)["']/g)) cols.add(m[1]);
      }
    }
  });
  return cols;
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
 * Takes the `function-decl` AST NODE (not its source slice). Returns the
 * offending query + egress kind (→ E-PROTECT-004), or null.
 *
 * DECLASSIFICATION IS PER-COLUMN, not per-body. `reveal("col")` names ONE column;
 * §14.8.9's own conformance rationale says it "stamps the column's provenance
 * descriptor as declassified". So a body that reveals `name` and leaks
 * `passwordHash` now FIRES — under the old rule any `.reveal(` at all suppressed
 * the gate wholesale, which made the sole declassification primitive double as an
 * unconditional off-switch. A query whose origins are UNRESOLVABLE (`{all:true}`,
 * the CTE/UNION/dynamic strip-all path) can never be covered by a named reveal —
 * there is no name to check against — so it always fires at a raw egress.
 */
export function detectProtectedRawEgress(
  fnNode: unknown,
  ctx: ProtectContext,
): { query: string; egressKind: string } | null {
  if (!fnNode || typeof fnNode !== "object") return null;

  const aliases = collectGlobalAliases(fnNode);
  const revealed = collectRevealedColumns(fnNode);

  // --- pass 1: the protected-origin query whose columns are NOT all declassified.
  let protectedQuery: string | null = null;
  walkStructurally(fnNode, (n) => {
    if (protectedQuery !== null) return;
    if (n.kind !== "sql" || typeof n.query !== "string") return;
    const resolved = resolveProtectedOutputColumns(n.query, ctx);
    if (resolved === null) return;
    // Unresolvable origins (`{all:true}` — the CTE/UNION/dynamic strip-all path)
    // cannot be declassified by name: there is no column name to check a
    // `reveal("col")` against, so no reveal covers them.
    const uncovered = "all" in resolved || resolved.cols.some((c) => !revealed.has(c));
    if (!uncovered) return;
    protectedQuery = n.query.trim().replace(/\s+/g, " ").slice(0, 60);
  });
  if (protectedQuery === null) return null;

  // --- pass 2: a raw / unredactable egress in the same body.
  let egressKind: string | null = null;
  const setKind = (k: string): void => { if (egressKind === null) egressKind = k; };
  walkStructurally(fnNode, (n) => {
    if (egressKind !== null) return;
    // `_{}` foreign-code block (§23) — opaque interior, nothing to redact through.
    if (n.kind === "foreign") {
      setKind("a `_{}` foreign-code block (§23)");
      return;
    }
    // `new <Response>(...)` — bare, `globalThis.`-qualified, or alias-bound.
    if (n.kind === "new") {
      const ctor = resolveGlobalName(n.callee, aliases);
      if (ctor && RAW_EGRESS_CTORS.has(ctor)) {
        setKind("a manual `Response` / `handle()` body (§40)");
      }
      return;
    }
    // `<Response>.json(...)` — the static-factory spelling of the same egress.
    if (n.kind === "call" && isNode(n.callee) && n.callee.kind === "member"
        && n.callee.property === "json") {
      const recv = resolveGlobalName(n.callee.object, aliases);
      if (recv && RAW_EGRESS_CTORS.has(recv)) {
        setKind("a manual `Response` / `handle()` body (§40)");
      }
      return;
    }
    // An `asIs`-typed binding (§14.1.1) escapes the type system entirely.
    if (typeof n.typeAnnotation === "string" && /(^|[^A-Za-z0-9_$])asIs([^A-Za-z0-9_$]|$)/.test(n.typeAnnotation)) {
      setKind("an `asIs`-typed value (§14.1.1)");
    }
  });
  if (egressKind === null) return null;
  return { query: protectedQuery, egressKind };
}
