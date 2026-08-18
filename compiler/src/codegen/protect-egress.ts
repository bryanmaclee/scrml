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
 *   4. "the single compiler-owned egress sink" is a PREMISE, not a fact: a
 *      hand-written `new Response(JSON.stringify(row))` is a SECOND sink and it
 *      is reachable from clean scrml source. §14.8.9 answers that premise
 *      failure by REFUSING TO COMPILE (`E-PROTECT-004`, below) — "the compiler
 *      will not ship a protected column through a path it cannot redact" — NOT
 *      by trying to redact the un-redactable path anyway.
 *
 *      A value-level `toJSON` hook was tried here (dpa-030 D2c) and REMOVED
 *      (S350). A value cannot know WHY it is being serialized, and that single
 *      property produced both of its failure modes: it UNDER-fired after any
 *      shallow copy (`{...row}`, `Object.assign`, `structuredClone`,
 *      `.map(r => ({...r}))` — the hook is an own property of the row and does
 *      not survive the copy, while the Symbol descriptor does), and it
 *      OVER-fired on server-INTERNAL serialization (stringifying a row into an
 *      audit table, a log line, or a cache entry silently lost columns — a
 *      behaviour regression on code that never crosses the wire). Patching the
 *      spread would have been a per-position fix for a whole class. The
 *      compile-time refusal is the sanctioned mechanism; a serialization hook
 *      is not.
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
  "// The descriptor is METADATA ONLY. It changes NOTHING an ordinary JS consumer",
  "// can observe: `row.passwordHash` still reads, `Object.keys(row)` is unchanged,",
  "// and a server-internal `JSON.stringify(row)` -- into an audit table, a log",
  "// line, a cache entry -- still serializes the FULL row. Confidentiality is",
  "// enforced at the two places that are actually egress: the compiler-emitted",
  "// sink calls `_scrml_protect_redact` below, and any egress the compiler CANNOT",
  "// redact is refused at compile time with `E-PROTECT-004` (§14.8.9 fail-closed).",
  "// A serialization hook on the value was deliberately NOT used: a value cannot",
  "// know why it is being serialized, so it strips internal reads it should not",
  "// and misses any shallow copy it should have caught.",
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
// SOUNDNESS BOUND, STATED HONESTLY. The gate reaches ACROSS THE CALL BOUNDARY —
// a row fetched in fn A, returned to fn B, and serialized into a `Response`
// there DOES fire, via the same-file call graph resolved in `detectRawEgressSet`
// below. It is a NAME-based closure over same-file server functions, and it is
// bounded accordingly: an indirect call (a function value passed as an argument,
// stored in an object, or reached through an import) is not resolved, and it is
// not a value-flow analysis — a callee that fetches a protected row and a caller
// that raw-egresses ANYTHING are enough to fire, whether or not that particular
// row is the one serialized.
//
// That over-approximation is deliberate and it is the fail-closed direction: the
// remedy is `reveal("col")`, projecting the column out of the SELECT, or
// returning through the compiler-emitted response — all loud, all reversible.
//
// WHAT IS *NOT* HERE, AND WHY. A value-level `toJSON` hook on the tagged row was
// tried (dpa-030 D2c) as a "total and late" runtime complement to this "loud and
// early" compile-time gate, and it was REMOVED at S350. It was not complementary;
// it was unsound in both directions — defeated by any shallow copy, and firing on
// server-internal serialization that never crosses the wire. §14.8.9 mandates
// REFUSAL at an unredactable egress, not best-effort redaction of one.
// ---------------------------------------------------------------------------

/** Global namespace objects whose `.<name>` IS the global of that name. */
const GLOBAL_NAMESPACE_OBJECTS: ReadonlySet<string> = new Set(["globalThis", "window", "self"]);

/** The raw-egress constructor names §14.8.9 cannot redact past. */
const RAW_EGRESS_CTORS: ReadonlySet<string> = new Set(["Response"]);

/**
 * Node kinds where an `asIs` annotation describes a value going OUT — a
 * value-binding declaration, or a function's return type. A PARAM entry is
 * deliberately absent: a param annotation is an INGRESS (see `findRawEgress`).
 */
const ASIS_EGRESS_NODE_KINDS: ReadonlySet<string> = new Set([
  "function-decl",
  "let-decl",
  "const-decl",
  "state-decl",
]);

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
 * ═══ OPEN FAIL-OPEN — READ BEFORE CHANGING THIS FUNCTION (S350 fix round 2, H1) ═══
 *
 * This returns a flat BAG OF COLUMN NAMES. It records THAT a column was revealed
 * somewhere in the body, never WHICH VALUE was revealed. The declassification
 * check downstream therefore asks "was this column name revealed anywhere",
 * which is an off-switch with a smaller radius than the one round 1 removed —
 * not the absence of one. THREE measured fail-opens, all exit 0, zero
 * diagnostics, all shipping `passwordHash` at HTTP 200:
 *
 *   (1) TWO SITES, TWO BINDINGS — reveal `a`, egress `b`:
 *         let a = ?{`SELECT * FROM users …`}.get()
 *         let b = ?{`SELECT * FROM users …`}.get()
 *         let x = a.reveal("passwordHash")
 *         return new globalThis.Response(JSON.stringify(b))
 *
 *   (2) ONE SITE, ALIASED — reveal `a`, egress an alias of `a`:
 *         let a = ?{`SELECT * FROM users …`}.get()
 *         let b = a
 *         let x = a.reveal("passwordHash")
 *         return new globalThis.Response(JSON.stringify(b))
 *
 *   (3) ONE SITE, TWO VALUES — both from the same callee:
 *         let a = fetchUser(1)
 *         let b = fetchUser(2)
 *         let x = a.reveal("passwordHash")
 *         return new globalThis.Response(JSON.stringify(b))
 *
 * WHY BINDING IDENTITY DOES NOT FIX THIS, which is the part worth carrying:
 *
 *   · (1) alone would yield to binding identity — two sites, two names.
 *   · (2) DEFEATS binding identity outright, and for a semantic reason:
 *     `_scrml_protect_reveal` RETURNS A FRESH VALUE and leaves the receiver
 *     tagged (asserted in `g-sql-row-protect-leak.test.js`). So `a.reveal(…)`
 *     does NOT declassify `a`. Keying declassification on the RECEIVER binding
 *     is modelling the primitive backwards, and would mark `a` — and every alias
 *     of it — declassified.
 *   · (3) is unanswerable by ANY location-keyed scheme. ONE static query site,
 *     TWO runtime values, one revealed and one not. Site identity, binding
 *     identity and function identity all collapse them into one fact.
 *
 * The general statement: **`reveal` is a VALUE-level operation, and every fact
 * this pass can compute is LOCATION-level** (a query site, a binding name, a
 * function name). A location-keyed declassification check has a fail-open
 * wherever one value is revealed and a sibling from the same location is not.
 * Answering it soundly means tracking values through bindings, aliases,
 * containers and RETURNS — dataflow this compiler does not have.
 *
 * Deliberately NOT patched here: each of the last two rounds traded a fail-open
 * in this mechanism for a false positive or the reverse, and a fourth narrowing
 * of the same shape would do it again. Escalated to the operator as a design
 * question (does cross-call declassification ship at all, or does `reveal`
 * narrow to "declassify at the value you send"). Do not add another
 * name-keyed narrowing here without that ruling.
 * ═══════════════════════════════════════════════════════════════════════════
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
 * The protected-origin query in THIS body whose columns are not all declassified
 * by `revealed`, or null. The returned string is the trimmed query text for the
 * diagnostic.
 *
 * DECLASSIFICATION IS PER-COLUMN, not per-body. `reveal("col")` names ONE column;
 * §14.8.9's own conformance rationale says it "stamps the column's provenance
 * descriptor as declassified". So a body that reveals `name` and leaks
 * `passwordHash` FIRES — under the pre-dpa-030 rule any `.reveal(` at all
 * suppressed the gate wholesale, which made the sole declassification primitive
 * double as an unconditional off-switch. A query whose origins are UNRESOLVABLE
 * (`{all:true}`, the CTE/UNION/dynamic strip-all path) can never be covered by a
 * named reveal — there is no name to check against — so it always fires.
 */
interface ProtectedQuerySite {
  /** Trimmed query text for the diagnostic. */
  text: string;
  /** Protected OUTPUT column names, or `"*"` for the strip-all sentinel. */
  cols: string[] | "*";
}

/**
 * Every protected-origin query site in THIS body, with the columns each one
 * carries. ROOT-INDEPENDENT and reveal-INDEPENDENT, so it is walked once per
 * function and reused for every (root, egress, query) pair the closure loop
 * considers — the pairing loop must never re-walk an AST.
 */
function collectProtectedQuerySites(fnNode: unknown, ctx: ProtectContext): ProtectedQuerySite[] {
  const sites: ProtectedQuerySite[] = [];
  walkStructurally(fnNode, (n) => {
    if (n.kind !== "sql" || typeof n.query !== "string") return;
    const resolved = resolveProtectedOutputColumns(n.query, ctx);
    if (resolved === null) return;
    sites.push({
      text: n.query.trim().replace(/\s+/g, " ").slice(0, 60),
      cols: "all" in resolved ? "*" : resolved.cols,
    });
  });
  return sites;
}

/**
 * The first site in `sites` whose columns are NOT all declassified by
 * `revealed`, or null. A pure list scan — no AST walk.
 *
 * Unresolvable origins (`"*"` — the CTE/UNION/dynamic strip-all path) can never
 * be covered by a named reveal: there is no column name to check against.
 */
function firstUncoveredSite(
  sites: readonly ProtectedQuerySite[],
  revealed: ReadonlySet<string>,
): string | null {
  for (const site of sites) {
    const uncovered = site.cols === "*" || site.cols.some((c) => !revealed.has(c));
    if (uncovered) return site.text;
  }
  return null;
}

/**
 * The protected-origin query in THIS body that `revealed` does not fully
 * declassify, or null. Walks the body, then applies the coverage rule — the
 * SAME rule the interprocedural path applies, via the same two helpers, so the
 * two entries can never drift apart.
 */
function findProtectedQuery(
  fnNode: unknown,
  ctx: ProtectContext,
  revealed: ReadonlySet<string>,
): string | null {
  return firstUncoveredSite(collectProtectedQuerySites(fnNode, ctx), revealed);
}

/**
 * The raw / compiler-unredactable egress in THIS body, or null. Aliases are
 * collected PER BODY (never merged across the call graph): a `const R =
 * globalThis.Response` in one function must not make an unrelated local `R` in
 * another function resolve to `Response`.
 */
function findRawEgress(fnNode: unknown): string | null {
  const aliases = collectGlobalAliases(fnNode);
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
    // An `asIs`-typed value (§14.1.1) escapes the type system entirely.
    //
    // TWO tests, and BOTH are load-bearing: the annotation KEY matches by
    // convention, and the NODE KIND must be an EGRESS position.
    //
    // (1) KEY, by convention — every position an annotation can occupy lands on
    // a property whose key ENDS IN `Annotation`. MEASURED by walking a real AST
    // that spells `asIs` in every position the grammar allows:
    //
    //   returnTypeAnnotation  on `function-decl`   — `function f() -> asIs`
    //   typeAnnotation        on `let-decl`        — `let u: asIs = …`
    //   typeAnnotation        on `const-decl`      — `const u: asIs = …`
    //   typeAnnotation        (array/union suffix) — `let u: asIs[]`
    //   typeAnnotation        on a PARAM entry     — `function f(sink: asIs)`
    //
    // Enumerating the two live field names is the fail-OPEN shape this file's
    // invariant-52 note warns about — `returnTypeAnnotation` is precisely the one
    // a two-name list missed, and that was a measured coverage REGRESSION.
    //
    // (2) NODE KIND, by POSITIVE membership — the key test alone swept in the
    // PARAM entry, and **a parameter annotation is an INGRESS, not an egress**.
    // `function fmt(v: asIs)` describes a value coming IN; it says nothing about
    // a protected row going OUT. Matching it hard-blocked valid code, and
    // `callClosure` then propagated the false egress to every caller:
    //
    //   function fmt(v: asIs) { return v }
    //   export server function getUser(id) {
    //     let u = ?{`SELECT * FROM users …`}.get()
    //     return fmt(u.name)          // a string — the row never leaves
    //   }
    //
    // fired E-PROTECT-004; deleting `: asIs` made it compile. So the egress
    // positions are named POSITIVELY (invariant 54: opt in on a positive
    // membership test, never on the absence of one) — a value-BINDING decl, or a
    // function's RETURN type. A param entry carries no `kind` at all, so it can
    // never satisfy this test even if a new annotation key appears on it.
    //
    // ⚠ KNOWN COVERAGE EDGE, deliberately given up with this rule: an asIs-typed
    // param that is itself the sink — `function f(sink: asIs) { sink(row) }` — is
    // no longer an egress here. Distinguishing a sink param from an ordinary
    // formatting param is a value-flow question, not an annotation question.
    //
    // ⚠ `function-decl.raw` also holds the literal text `asIs` for every one of
    // these spellings, because it is the fn's SOURCE SLICE. Deliberately NOT
    // matched: reading it would re-introduce the source-text co-occurrence regex
    // dpa-030 D2b removed, and would fire on `asIs` in a comment or a string.
    if (typeof n.kind === "string" && ASIS_EGRESS_NODE_KINDS.has(n.kind)) {
      for (const key of Object.keys(n)) {
        if (!key.endsWith("Annotation")) continue;
        const ann = n[key];
        if (typeof ann === "string" && /(^|[^A-Za-z0-9_$])asIs([^A-Za-z0-9_$]|$)/.test(ann)) {
          setKind("an `asIs`-typed value (§14.1.1)");
          return;
        }
      }
    }
  });
  return egressKind;
}

/**
 * §14.8.9 fail-closed gate (E-PROTECT-004) — detect a protected-origin value
 * reaching a RAW / compiler-UNANALYZABLE egress within a SINGLE server-function
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
 * This is the INTRAPROCEDURAL entry. `detectProtectedRawEgressAcrossFile` below
 * is the one the emitter calls; it reaches across the same-file call graph.
 */
export function detectProtectedRawEgress(
  fnNode: unknown,
  ctx: ProtectContext,
): { query: string; egressKind: string } | null {
  if (!fnNode || typeof fnNode !== "object") return null;
  const revealed = collectRevealedColumns(fnNode);
  const query = findProtectedQuery(fnNode, ctx, revealed);
  if (query === null) return null;
  const egressKind = findRawEgress(fnNode);
  if (egressKind === null) return null;
  return { query, egressKind };
}

// ---------------------------------------------------------------------------
// §14.8.9 fail-closed gate, INTERPROCEDURAL (S350).
//
// The intraprocedural gate above fires only when the protected SELECT and the
// raw egress sit in the SAME body. MEASURED: it goes silent across ONE call hop,
// in BOTH directions —
//
//   (a) SELECT in a callee, raw `Response` in the caller:
//         function fetchUser(id) { return ?{`SELECT * FROM users …`}.get() }
//         function handle(req, resolve) {
//           let u = fetchUser(1)
//           return new globalThis.Response(JSON.stringify({...u}))
//         }
//   (b) SELECT in the caller, raw `Response` in a callee:
//         function wrap(u) { return new globalThis.Response(JSON.stringify(u)) }
//         function handle(req, resolve) {
//           let u = ?{`SELECT * FROM users …`}.get()
//           return wrap(u)
//         }
//
// Both compiled EXIT 0 with zero diagnostics before this change. The spread is
// not what defeats the gate — the CALL BOUNDARY is; (a) goes silent with or
// without the `{...u}`.
//
// THE FIX IS A NAME-KEYED CALL CLOSURE over the file's own server functions.
// For each function F, the EFFECTIVE BODY is F plus every same-file function F
// transitively calls; the existing single-body predicates then run over that set
// unchanged. One rule covers both directions: in (a) the query is in the callee
// and the egress in the root, in (b) the reverse, and closure(handle) contains
// both either way.
//
// BOUND, STATED HONESTLY. This is a NAME closure, not a value-flow analysis:
//   · an INDIRECT call (a function passed as an argument, stored in an object,
//     or reached through an import) is NOT resolved — the edge is only
//     `{kind:"call", callee:{kind:"ident", name}}` against a same-file
//     `function-decl` name;
//   · it does not prove the protected row is the value that reaches the egress.
//     A callee that selects a protected row plus a caller that raw-egresses
//     ANYTHING is enough to fire.
// Both are the fail-CLOSED direction (over-approximate, loud, and reversible by
// `reveal("col")`, by projecting the column out, or by returning through the
// compiler-emitted response). Under-approximating here would be a silent leak.
//
// ⚠ SEQUENCING CONSTRAINT — read before touching the `handle()` call path.
// `handle()` currently cannot call ANY same-file user function at RUNTIME: the
// callee is escalated into its own route handler while the emitted `handle()`
// body still calls the original bare name, which binds to nothing in the module
// (`g-handle-middleware-call-to-escalated-fn-emits-undefined-reference`, HIGH,
// pre-existing — NOT introduced here). So shapes (a) and (b) throw a
// ReferenceError today instead of shipping the column: the leak is MASKED, not
// absent. **Whoever fixes that undefined-callee defect without this gate in
// place UNMASKS a confidentiality leak.** This gate is a PREREQUISITE for that
// fix, not an alternative to it.
// ---------------------------------------------------------------------------

/**
 * Same-file functions this body calls by bare name (`fetchUser(1)`).
 *
 * MEMOIZED per node: the call closure re-asks this for every body it reaches,
 * and the answer is root-independent. Keyed on node identity in a WeakMap, so a
 * stale AST cannot pin memory and a fresh compile of a fresh AST never sees a
 * previous file's answer.
 */
const _calledNamesMemo = new WeakMap<object, Set<string>>();

function collectCalledNames(fnNode: unknown): Set<string> {
  if (fnNode !== null && typeof fnNode === "object") {
    const hit = _calledNamesMemo.get(fnNode as object);
    if (hit) return hit;
  }
  const names = new Set<string>();
  walkStructurally(fnNode, (n) => {
    if (
      n.kind === "call"
      && isNode(n.callee)
      && n.callee.kind === "ident"
      && typeof n.callee.name === "string"
    ) {
      names.add(n.callee.name);
    }
  });
  if (fnNode !== null && typeof fnNode === "object") {
    _calledNamesMemo.set(fnNode as object, names);
  }
  return names;
}

/**
 * The EFFECTIVE BODY of `root`: `root` itself plus every same-file function it
 * transitively calls. Breadth-first with an identity `seen` set, so mutual and
 * self recursion terminate.
 */
function callClosure(root: unknown, byName: ReadonlyMap<string, unknown>): unknown[] {
  const bodies: unknown[] = [root];
  const seen = new Set<unknown>([root]);
  for (let i = 0; i < bodies.length; i++) {
    for (const name of collectCalledNames(bodies[i])) {
      const callee = byName.get(name);
      if (!callee || seen.has(callee)) continue;
      seen.add(callee);
      bodies.push(callee);
    }
  }
  return bodies;
}

/** One E-PROTECT-004 finding, keyed to the function the diagnostic reports on. */
export interface ProtectedRawEgressFinding {
  /** The `function-decl` node the diagnostic is reported at. */
  fn: unknown;
  /** The offending query text (trimmed for the message). */
  query: string;
  /** Human-readable egress kind (`a manual \`Response\` …`). */
  egressKind: string;
  /** Name of the function holding the query, when it is NOT `fn`. */
  queryFn: string | null;
  /** Name of the function holding the egress, when it is NOT `fn`. */
  egressFn: string | null;
  /**
   * The nodes holding each half. The emitter needs a resolvable span to point
   * the diagnostic at, and the reported root may not have one — these are the
   * fallbacks so a span-less root can never SILENTLY DISCARD a finding.
   */
  queryHolder: unknown;
  egressHolder: unknown;
}

const fnNameOf = (n: unknown): string =>
  (isNode(n) && typeof n.name === "string") ? n.name : "<anonymous>";

/**
 * §14.8.9 fail-closed gate across the same-file call graph. Returns one finding
 * per leak path, reported at the INNERMOST function whose effective body holds
 * both halves — so a chain `handle -> serve -> fetchUser` with the egress in
 * `serve` reports once, on `serve`, rather than once per enclosing caller.
 *
 * -- REVEAL IS PATH-SCOPED, NOT CLOSURE-SCOPED (S350 fix round 1, B3) --
 * `reveal("col")` is honoured only from the body holding the protected QUERY and
 * the body holding the EGRESS. It was briefly unioned across the WHOLE closure,
 * which re-created at call-graph scope exactly the defect this gate's header
 * says was removed at body scope: a `reveal("passwordHash")` on a completely
 * unrelated value in an unrelated sibling function silently suppressed the gate
 * for a protected query elsewhere in the file -- a fail-OPEN, MEASURED.
 *
 * Query-holder + egress-holder is the tightest scope that still covers both
 * natural factorings -- the reveal at the fetch (`return u.reveal("pw")` inside
 * the helper) and the reveal at the send (`JSON.stringify(u.reveal("pw"))` at
 * the boundary). It is deliberately NOT the transitive path: a reveal on a
 * MIDDLE function that neither queries nor egresses is not honoured, because the
 * call graph cannot distinguish "this middle function reveals the row that
 * leaks" from "this middle function reveals something unrelated" without
 * value-flow analysis. That case FAILS CLOSED, which is the mandated direction;
 * the author moves the reveal to either end to silence it.
 *
 * For a single body, query-holder == egress-holder == that body, so the
 * intraprocedural semantics are unchanged.
 */
export function detectProtectedRawEgressAcrossFile(
  fnNodes: readonly unknown[],
  ctx: ProtectContext,
): ProtectedRawEgressFinding[] {
  const fns = fnNodes.filter((f) => f && typeof f === "object");
  if (fns.length === 0) return [];

  // Name -> node. A duplicate name keeps the FIRST declaration (the emitter's
  // own resolution order); an ambiguous name is not a reason to stop analysing.
  const byName = new Map<string, unknown>();
  for (const f of fns) {
    const name = isNode(f) ? f.name : undefined;
    if (typeof name === "string" && !byName.has(name)) byName.set(name, f);
  }

  const closures = new Map<unknown, unknown[]>();
  const closureSets = new Map<unknown, Set<unknown>>();
  for (const f of fns) {
    const c = callClosure(f, byName);
    closures.set(f, c);
    closureSets.set(f, new Set(c));
  }

  // Per-BODY facts, computed ONCE and reused for every root that reaches this
  // body. Both are root-independent, so the pairing loop below re-reads a map
  // instead of re-walking the AST per (root, body) pair.
  const revealsOf = new Map<unknown, Set<string>>();
  const egressOf = new Map<unknown, string | null>();
  const sitesOf = new Map<unknown, ProtectedQuerySite[]>();
  for (const f of fns) {
    revealsOf.set(f, collectRevealedColumns(f));
    egressOf.set(f, findRawEgress(f));
    sitesOf.set(f, collectProtectedQuerySites(f, ctx));
  }

  // A finding per root whose effective body holds both halves.
  const raw = new Map<unknown, ProtectedRawEgressFinding>();
  for (const f of fns) {
    const bodies = closures.get(f)!;
    const egressBodies = bodies.filter((b) => egressOf.get(b) != null);
    if (egressBodies.length === 0) continue;

    let found: ProtectedRawEgressFinding | null = null;
    // Pair each candidate egress with each candidate query holder, and scope the
    // reveal set to exactly those two bodies (see the header note).
    const queryBodies = bodies.filter((b) => sitesOf.get(b)!.length > 0);
    if (queryBodies.length === 0) continue;

    outer:
    for (const e of egressBodies) {
      for (const q of queryBodies) {
        const revealed = new Set<string>(revealsOf.get(q));
        for (const c of revealsOf.get(e)!) revealed.add(c);
        const query = firstUncoveredSite(sitesOf.get(q)!, revealed);
        if (query === null) continue;
        found = {
          fn: f,
          query,
          egressKind: egressOf.get(e)!,
          queryFn: q === f ? null : fnNameOf(q),
          egressFn: e === f ? null : fnNameOf(e),
          queryHolder: q,
          egressHolder: e,
        };
        break outer;
      }
    }
    if (found) raw.set(f, found);
  }

  // -- REPORT THE INNERMOST FIRING ROOT, AND NEVER DROP A CYCLE (B1) --
  //
  // The first cut of this filter was `closure(f).some(b => b !== f && raw.has(b))`
  // -- "drop f if its effective body contains any other firing root". On a call
  // CYCLE that drops EVERYTHING: with `a -> b -> a`, closure(a) contains b and
  // closure(b) contains a, so each is "not innermost" because of the other, both
  // are dropped, and every enclosing caller is dropped with them. MEASURED: a
  // protected SELECT in `a`, a raw `Response` in `b`, and one back-edge `b -> a`
  // took the gate from exit 1 to exit 0. **Adding a call edge silently turned a
  // confidentiality gate off**, and mutual recursion between two server helpers
  // is ordinary code.
  //
  // The fix is STRICT containment. R' is strictly inside R only when R' is
  // reachable from R and R is NOT reachable from R' -- so two functions in the
  // same cycle never suppress each other, while a genuine outer caller still
  // defers to the inner one. "Cannot determine an innermost root" is exactly the
  // case that must fail CLOSED, so a cycle FIRES; it just fires once.
  const strictlyInside = (inner: unknown, outer: unknown): boolean =>
    inner !== outer
    && closureSets.get(outer)!.has(inner)
    && !closureSets.get(inner)!.has(outer);

  const survivors = fns.filter(
    (f) => raw.has(f) && ![...raw.keys()].some((other) => strictlyInside(other, f)),
  );

  // Survivors that are mutually reachable describe ONE leak path through one
  // cycle; keep a single deterministic representative (first in `fnNodes` order,
  // which is the emitter's own order) so a cycle yields one diagnostic rather
  // than one per member.
  const findings: ProtectedRawEgressFinding[] = [];
  const claimed = new Set<unknown>();
  for (const f of survivors) {
    if (claimed.has(f)) continue;
    for (const g of survivors) {
      if (closureSets.get(f)!.has(g) && closureSets.get(g)!.has(f)) claimed.add(g);
    }
    findings.push(raw.get(f)!);
  }
  return findings;
}
