/**
 * §14.8.9 — protected-column PROVENANCE FLOW over the emitted server module.
 *
 * WHY THIS EXISTS (S441, `g-protected-column-escapes-redaction-as-scalar`).
 *
 * The §14.8.9 floor (`protect-egress.ts`) tags the ROW — the object a `?{}`
 * SELECT returns — with a Symbol-keyed origin descriptor, and the egress sink
 * `_scrml_protect_redact` strips every protected column the descriptor names.
 * That is sound for every value that still IS a row (or holds one): `return u`,
 * `{...u}`, `{ user: u }`, `rows.map(r => ({...r}))`, a helper returning the row.
 *
 * It is NOT sound for a value pulled OUT of a row. `return u.passwordHash` hands
 * the sink a plain string, and a primitive cannot carry a descriptor, so the
 * redactor has nothing to read: MEASURED, HTTP 200 body `"SECRET-HASH-123"`,
 * while `I-PROTECT-STRIP-001` claimed the column had been stripped. The same is
 * true of every shape that re-houses the extracted value somewhere the
 * descriptor does not reach — `{ h: u.passwordHash }`, `[u.passwordHash]`,
 * `"x" + u.passwordHash`, a template, `const { passwordHash } = u`, a helper
 * `pick(u)`, `rows.map(r => r.passwordHash)`, `JSON.stringify(u)`.
 *
 * No runtime mechanism can repair that at the sink: the descriptor lives on the
 * container, and by the time the sink runs the container is gone. The only
 * place the provenance of an extracted value is still known is the code that
 * extracted it. So this module reads that code.
 *
 * THE RULE (stated once; the comments below refer back to it):
 *
 *   A value whose provenance includes a `protect=` column, and which is NOT
 *   still carried inside a descriptor-bearing row, SHALL NOT reach a
 *   compiler-emitted client-egress sink. The compiler proves this over the
 *   EMITTED server module and rejects the build (`E-PROTECT-006`) — it does not
 *   strip at runtime, because a stripped scalar would silently change what the
 *   program returns, and it does not pass, because that is the leak.
 *
 *   "Provenance includes a protected column" means the value IS the column's
 *   value, or CONTAINS it, reached through identity-preserving steps only:
 *   binding, member / index / destructuring extraction, re-housing in an object
 *   or array literal, spread, `push`/`set`/`Object.assign` into a container,
 *   string concatenation and template interpolation (the value is embedded
 *   verbatim), `? :` / `&&` / `||` / `??`, `await`, a call to a function this
 *   module defines (analysed interprocedurally — parameters and returns), an
 *   array-callback (`map`, `filter`, `find`, `reduce`, …), `join` /
 *   `toString`, the string methods that return a slice or transform of the
 *   receiver, and the ECMAScript built-ins that copy or serialize their
 *   argument (`String`, `JSON.stringify`, `Object.values`, `structuredClone`, …
 *   — see `SERIALIZING_BUILTINS` / `IDENTITY_BUILTINS`).
 *
 *   A value that is COMPUTED from the column — a comparison, arithmetic, a
 *   boolean predicate method (`includes`, `startsWith`, …), `.length`, or the
 *   result of passing the scalar to a function the module does not define
 *   (`verifyPassword(pw, u.passwordHash)`, `Bun.password.verify(...)`) — is a
 *   DERIVED flow, which §14.8.9 places outside the soundness claim. It is not
 *   rejected. This is what keeps the canonical login shape compiling.
 *
 *   `reveal("col")` is honoured exactly as at the sink: reading a column off a
 *   value that `reveal`ed it is a declassified read.
 *
 * WHERE THE SINKS ARE. Every compiler-emitted client-egress path — server-fn
 * response, `<endpoint>` arm, SSR `/__serverLoad`, `/__mountHydrate`, channel
 * `broadcast()`, the `watches=` feed — wraps its payload in
 * `_scrml_protect_redact(...)` when protect is active, so the argument of that
 * call IS the sink. The §37 SSE stream additionally serializes `event` / `id`
 * off each yielded frame outside the redact, so the whole frame bound by the
 * compiler's `for await (const _scrml_val of …)` loop is a sink too.
 *
 * WHAT THIS DOES NOT COVER (disclosed, not hidden):
 *   - derived flows, as above (§14.8.9's own bound);
 *   - extraction performed INSIDE code this module does not contain — an
 *     imported function that receives a whole row is assumed to return rows
 *     as rows (descriptor-preserving, like a module helper), not to extract;
 *   - flow-insensitivity: a binding's taint is the union of everything ever
 *     assigned to it, so a variable reassigned from a protected value to a
 *     clean one is still treated as protected (fails CLOSED, never open).
 *
 * WHY THE EMITTED MODULE AND NOT THE SCRML AST. The emitted module is where the
 * provenance SOURCES (`_scrml_protect_tag(<rows>, <cols>)`, placed by the
 * compiler at query lowering) and the SINKS (`_scrml_protect_redact(<payload>)`)
 * are both explicit, and it is exactly the code that runs. It parses by
 * construction (`validate-emit.ts` gates that), and acorn reads it exactly — no
 * text predicate (the `egress-field-scan.ts` / `findAuthoredResponseConstruction`
 * precedent).
 */

// @ts-ignore — acorn ships its own types but the compiler imports it untyped elsewhere.
import * as acorn from "acorn";
import { CGError } from "./errors.ts";

/** Label used for a row whose SQL origins could not be resolved (strip-all). */
export const ALL_COLUMNS_LABEL = "*";

interface RowPart {
  /** `_scrml_protect_tag` call sites (by source offset) this row came from. */
  tags: Set<number>;
  /** Protected OUTPUT column names the descriptor names. */
  cols: Set<string>;
  /** The descriptor is the strip-all sentinel (unresolvable SQL). */
  all: boolean;
  /** Columns `reveal`ed on EVERY path that reaches here (intersection). */
  revealed: Set<string>;
}

/**
 * The abstract value. `scalar` = the value itself is (or embeds verbatim) a
 * protected column; `deep` = the value is a container holding one outside any
 * descriptor. Both map label -> the first extraction site seen (for the
 * diagnostic). `row` = the value is, or contains, a descriptor-bearing row —
 * which the sink strips, so it is SAFE on its own. `fns` = function values.
 */
interface Taint {
  row: RowPart | null;
  scalar: Map<string, string>;
  deep: Map<string, string>;
  fns: Set<any>;
}

function clean(): Taint {
  return { row: null, scalar: new Map(), deep: new Map(), fns: new Set() };
}

function joinRow(a: RowPart | null, b: RowPart | null): RowPart | null {
  if (!a) return b ? { tags: new Set(b.tags), cols: new Set(b.cols), all: b.all, revealed: new Set(b.revealed) } : null;
  if (!b) return { tags: new Set(a.tags), cols: new Set(a.cols), all: a.all, revealed: new Set(a.revealed) };
  const revealed = new Set<string>();
  for (const c of a.revealed) if (b.revealed.has(c)) revealed.add(c);
  return {
    tags: new Set([...a.tags, ...b.tags]),
    cols: new Set([...a.cols, ...b.cols]),
    all: a.all || b.all,
    revealed,
  };
}

function mergeMap(into: Map<string, string>, from: Map<string, string>): void {
  for (const [k, v] of from) if (!into.has(k)) into.set(k, v);
}

function join(...ts: Taint[]): Taint {
  const out = clean();
  for (const t of ts) {
    if (!t) continue;
    out.row = t.row ? joinRow(out.row, t.row) : out.row;
    mergeMap(out.scalar, t.scalar);
    mergeMap(out.deep, t.deep);
    for (const f of t.fns) out.fns.add(f);
  }
  return out;
}

/** Every protected label the value carries OUTSIDE a descriptor. */
function naked(t: Taint): Map<string, string> {
  const m = new Map<string, string>();
  mergeMap(m, t.scalar);
  mergeMap(m, t.deep);
  return m;
}

/** The value, placed inside a fresh container (object / array literal slot). */
function containerOf(t: Taint): Taint {
  return { row: t.row ? joinRow(null, t.row) : null, scalar: new Map(), deep: naked(t), fns: new Set(t.fns) };
}

/** An element / field of the value, when WHICH one is not statically known. */
function elemOf(t: Taint): Taint {
  const scalar = naked(t);
  return { row: t.row ? joinRow(null, t.row) : null, scalar, deep: new Map(t.deep), fns: new Set(t.fns) };
}

/** The protected labels a row still carries (not `reveal`ed). */
function unrevealed(row: RowPart): string[] {
  if (row.all) return [ALL_COLUMNS_LABEL];
  return [...row.cols].filter((c) => !row.revealed.has(c));
}

function taintKey(t: Taint): string {
  const r = t.row
    ? `${[...t.row.tags].sort().join(",")}|${[...t.row.cols].sort().join(",")}|${t.row.all}|${[...t.row.revealed].sort().join(",")}`
    : "-";
  return `${r}#${[...t.scalar.keys()].sort().join(",")}#${[...t.deep.keys()].sort().join(",")}#${t.fns.size}`;
}

/**
 * ECMAScript built-ins whose result SERIALIZES / COPIES the argument's DATA
 * such that a Symbol-keyed descriptor does not survive — a row passed in comes
 * back out as naked protected data. `String(row)` is "[object Object]" and is
 * handled separately (`STRINGIFY_BUILTINS`), because it serializes a scalar
 * verbatim but a row not at all.
 */
const SERIALIZING_BUILTINS = new Set([
  "JSON.stringify", "Object.values", "Object.entries", "Object.fromEntries", "structuredClone",
]);
/** Built-ins that embed a SCALAR argument verbatim in a string result. */
const STRINGIFY_BUILTINS = new Set([
  "String", "encodeURIComponent", "encodeURI", "escape", "btoa", "String.raw",
]);
/** Built-ins that return their argument (or a container of it) unchanged. */
const IDENTITY_BUILTINS = new Set([
  "Object.assign", "Object.freeze", "Object.seal", "Array.from", "Array.of",
  "Promise.resolve", "Promise.all", "Promise.allSettled", "Promise.any", "Promise.race",
  "Map", "Set", "Array", "Object", "WeakMap",
]);

/** Array callbacks: element-param methods (and what their result is). */
const CALLBACK_METHODS = new Set([
  "map", "flatMap", "filter", "find", "findLast", "forEach", "some", "every",
  "findIndex", "findLastIndex", "sort", "toSorted", "reduce", "reduceRight", "then", "catch", "finally",
]);
/** Methods that write their arguments INTO the receiver. */
const MUTATING_METHODS = new Set(["push", "unshift", "splice", "set", "add", "fill"]);
/** Methods that return a single element of the receiver. */
const ELEMENT_METHODS = new Set(["at", "pop", "shift", "get", "charAt"]);
/** Methods that serialize the receiver's elements into a string. */
const JOINING_METHODS = new Set(["join", "toString", "toLocaleString"]);
/**
 * Methods whose result is a predicate / position / comparison over the
 * receiver — a DERIVED value of independent identity (§14.8.9 bound).
 */
const DERIVED_METHODS = new Set([
  "includes", "indexOf", "lastIndexOf", "startsWith", "endsWith", "localeCompare",
  "charCodeAt", "codePointAt", "search", "test", "has", "hasOwnProperty",
  "isPrototypeOf", "propertyIsEnumerable", "getTime", "delete", "forEach",
]);

/** Compiler-runtime helpers the analysis models itself (never walked). */
function isModelledHelperName(name: string): boolean {
  return name.startsWith("_scrml_protect_") || name.startsWith("_scrml_tenant_") || name === "_scrml_active_tenant";
}

interface Scope {
  parent: Scope | null;
  names: Set<string>;
  id: number;
}

interface FnInfo {
  node: any;
  scope: Scope;
  ret: Taint;
  yields: Taint;
  isGen: boolean;
  name: string;
  skip: boolean;
}

/** One leak: a protected value reaching a client-egress sink. */
export interface ProtectFlowLeak {
  /** Display name of the function whose egress ships it (demangled). */
  sinkFn: string;
  /** Protected label (output column name, or `*`). */
  column: string;
  /** Where the value was extracted, e.g. "`u.passwordHash` in `getIt`". */
  site: string;
  /** The function the extraction happened in (demangled), or null. */
  siteFn: string | null;
}

/** One `_scrml_protect_tag` site: the SQL it wraps + whether a sink stripped it. */
export interface ProtectTagSite {
  /** Static SQL skeleton — quasis with `${}` holes, whitespace-collapsed. */
  skeleton: string | null;
  cols: string[] | "*";
  /** True iff a descriptor-bearing row from this site reached a sink with ≥1 unrevealed protected column. */
  stripped: boolean;
}

export interface ProtectFlowResult {
  /** acorn could not parse the module — the flow is UNVERIFIED (caller fails closed). */
  parseError: string | null;
  leaks: ProtectFlowLeak[];
  tagSites: ProtectTagSite[];
}

const PARSE_OPTIONS = { ecmaVersion: "latest" as const, sourceType: "module" as const, allowAwaitOutsideFunction: true };

/**
 * Normalize SQL into its static skeleton: interpolation bodies replaced by a
 * hole marker, whitespace collapsed. Used to match an emitted tag site back to
 * the rewriter's per-query record. Balanced-brace aware for `${ f({a:1}) }`.
 */
export function sqlSkeleton(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "$" && sql[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "{") depth++;
        else if (sql[j] === "}") depth--;
        j++;
      }
      out += "\u0000";
      i = j;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** The rewriter's per-query record (see `rewrite.ts` `protectTagSqlResult`). */
export interface ProtectStripInfo {
  cols: string[] | "*";
  sql: string;
  skeleton: string;
}

/**
 * Run the provenance flow over a finished server module and turn it into the
 * §14.8.9 diagnostics:
 *
 *   - `E-PROTECT-006` (Error) for every protected value that reaches a client
 *     egress sink outside a descriptor-bearing row (THE RULE, file header);
 *   - `I-PROTECT-STRIP-001` (Info) ONLY for a query whose row the sink really
 *     stripped. It used to fire for every protected SELECT, so a query whose
 *     column left through `return u.passwordHash` was reported as "stripped"
 *     while it shipped. A query whose row never reaches a sink (a login that
 *     only verifies the hash) strips nothing and now reports nothing.
 *
 * An unparseable module is UNVERIFIED and fails CLOSED with `E-PROTECT-006`.
 * A rewriter record no emitted tag site can be matched to keeps the previous
 * (unconditional) report — the analysis cannot contradict what it cannot see.
 *
 * @param spanOf  maps a demangled server-function name to its source span.
 */
export function buildProtectFlowDiagnostics(
  moduleJs: string,
  infos: ProtectStripInfo[],
  filePath: string,
  spanOf: (fnName: string) => { start: number; end: number; line?: number; col?: number } | null,
): CGError[] {
  const out: CGError[] = [];
  const fileSpan = { file: filePath, start: 0, end: 0 } as any;
  const flow = analyzeProtectFlow(moduleJs);
  if (flow.parseError !== null) {
    out.push(new CGError(
      "E-PROTECT-006",
      `E-PROTECT-006: the compiler could not verify that no \`protect=\` column leaves this file's server module ` +
      `outside its row: the emitted server module did not parse (${flow.parseError}). §14.8.9 fails closed on an ` +
      `egress it cannot analyse. This is a compiler defect — please report it with this file.`,
      fileSpan,
      "error",
    ));
    return out;
  }
  // ONE error per extraction (column + site), naming the most useful sink: the
  // same `u.passwordHash` reaching both a route response and the SSR seed is one
  // mistake, and it is fixed at the extraction, not at either sink.
  const isCompilerName = (n: string) => n.startsWith("_scrml_") || n === "<module>";
  const byExtraction = new Map<string, ProtectFlowLeak>();
  for (const leak of flow.leaks) {
    const key = `${leak.column}\u0000${leak.site}`;
    const prev = byExtraction.get(key);
    if (!prev || (isCompilerName(prev.sinkFn) && !isCompilerName(leak.sinkFn))) byExtraction.set(key, leak);
  }
  for (const leak of byExtraction.values()) {
    const span = spanOf(leak.sinkFn) ?? (leak.siteFn ? spanOf(leak.siteFn) : null);
    const egress = isCompilerName(leak.sinkFn)
      ? `the compiler-emitted client egress \`${leak.sinkFn}\``
      : `the client egress of \`${leak.sinkFn}\``;
    const what = leak.column === ALL_COLUMNS_LABEL
      ? "a column of a row whose SQL column origins cannot be resolved statically (the floor treats every column " +
        "of such a row as protected and strips the row wholesale)"
      : `the protected (\`protect=\`) column \`${leak.column}\``;
    const resolution = leak.column === ALL_COLUMNS_LABEL
      ? "rewrite the query so its column origins resolve (a plain SELECT with an explicit column list), then " +
        "return the row itself or only its non-protected fields"
      : `return the row itself (the floor strips \`${leak.column}\` and keeps the rest), or only a value DERIVED ` +
        `from the column (a comparison, \`verifyPassword(pw, row.${leak.column})\`); to send it deliberately, ` +
        `declassify it at the value — \`row.reveal("${leak.column}").${leak.column}\` (the name is the query's ` +
        `OUTPUT column name after aliasing)`;
    out.push(new CGError(
      "E-PROTECT-006",
      `E-PROTECT-006: ${what} leaves the server outside its row — ${leak.site} reaches ${egress}. ` +
      `The §14.8.9 egress floor strips a protected column using the origin descriptor ` +
      `its ROW carries; a value taken out of the row — a field read, a destructure, a concatenation or template, ` +
      `a new object or array holding it, \`JSON.stringify\` of the row — carries no descriptor, so the floor ` +
      `cannot strip it and the compiler will not ship it. Resolution: ${resolution}.`,
      span ? ({ file: filePath, ...span } as any) : fileSpan,
      "error",
    ));
  }
  const strippedSkeletons = new Set<string>();
  const knownSkeletons = new Set<string>();
  for (const t of flow.tagSites) {
    if (t.skeleton === null) continue;
    knownSkeletons.add(t.skeleton);
    if (t.stripped) strippedSkeletons.add(t.skeleton);
  }
  for (const info of infos) {
    const matched = knownSkeletons.has(info.skeleton);
    if (matched && !strippedSkeletons.has(info.skeleton)) continue;
    const what = info.cols === "*"
      ? "ALL columns (the query's column origins are not statically resolvable — fail-closed wholesale strip)"
      : `protected column(s) ${info.cols.map((c) => `\`${c}\``).join(", ")}`;
    out.push(new CGError(
      "I-PROTECT-STRIP-001",
      `I-PROTECT-STRIP-001: the egress floor strips ${what} from the client response of \`${info.sql}\` ` +
      `(§14.8.9 — a \`protect=\` column never crosses the wire unredacted). To send a protected column ` +
      `deliberately, declassify it at the value with \`reveal("col")\`; to silence this, project the column out of the SELECT.`,
      fileSpan,
      "info",
    ));
  }
  return out;
}

function staticKey(node: any): string | null {
  if (!node) return null;
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number")) return String(node.value);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked ?? null;
  }
  return null;
}

/**
 * Analyse an emitted server module. Returns the leaks (value with protected
 * provenance reaching a sink outside a descriptor) and, per tag site, whether
 * the sink actually stripped a column from it (drives `I-PROTECT-STRIP-001`).
 */
export function analyzeProtectFlow(moduleJs: string): ProtectFlowResult {
  let root: any;
  try {
    root = acorn.parse(moduleJs, PARSE_OPTIONS);
  } catch (e) {
    return { parseError: (e as Error)?.message ?? String(e), leaks: [], tagSites: [] };
  }
  return new FlowAnalysis(moduleJs, root).run();
}

class FlowAnalysis {
  private src: string;
  private root: any;
  private scopeSeq = 0;
  private moduleScope: Scope;
  private fnInfos = new Map<any, FnInfo>();
  private fnParent = new Map<any, any>();
  private bindings = new Map<string, Taint>();
  private changed = false;
  /**
   * Every client-egress point, of four kinds:
   *   redact           — the argument of `_scrml_protect_redact(…)`: the sink
   *                      every compiler-emitted egress routes its payload through;
   *   frame            — the §37 SSE frame bound by `for await (const _scrml_val …)`
   *                      (its `event` / `id` are serialized outside the redact);
   *   serializer       — bytes leaving the server: `new Response(body)`,
   *                      `….publish(topic, data)`, `….enqueue(chunk)`, `….send(msg)`;
   *   serializer-json  — `Response.json(value)`, which JSON-encodes a row itself.
   * The serializer kinds are enumerated over the SERIALIZER, not the redactor, so
   * an egress that never adopted the redact (the `/__mountHydrate` defect class)
   * is still checked: what reaches it has not been through the floor.
   */
  private sinks: Array<{ t: Taint; fnName: string; kind: "redact" | "frame" | "serializer" | "serializer-json" }> = [];
  private tagMeta = new Map<number, { skeleton: string | null; cols: string[] | "*" }>();

  constructor(src: string, root: any) {
    this.src = src;
    this.root = root;
    this.moduleScope = { parent: null, names: new Set(), id: this.scopeSeq++ };
  }

  run(): ProtectFlowResult {
    this.declare(this.root, this.moduleScope, null);
    this.collectInferredNames(this.root);
    // Monotone fixpoint over a finite lattice (labels, tag ids and function
    // nodes are all drawn from this module) — it terminates; the cap is a guard.
    for (let pass = 0; pass < 64; pass++) {
      this.changed = false;
      this.sinks = [];
      this.walkBody(this.root.body, this.moduleScope, null);
      for (const info of this.fnInfos.values()) {
        if (info.skip) continue;
        const body = info.node.body;
        if (body && body.type === "BlockStatement") this.walkBody(body.body, info.scope, info);
        else if (body) this.addRet(info, this.evalExpr(body, info.scope, info));
      }
      if (!this.changed) break;
    }
    const leaks: ProtectFlowLeak[] = [];
    const seen = new Set<string>();
    const stripped = new Set<number>();
    for (const s of this.sinks) {
      const shipped = naked(s.t);
      // A serializer that JSON-encodes its argument WITHOUT the redact in front
      // of it ships a row's protected columns as-is — the row is not safe there.
      if (s.kind === "serializer-json" && s.t.row) {
        for (const c of unrevealed(s.t.row)) if (!shipped.has(c)) shipped.set(c, "a protected row serialized without the §14.8.9 redact");
      }
      for (const [col, site] of shipped) {
        const key = `${s.fnName}\u0000${col}\u0000${site}`;
        if (seen.has(key)) continue;
        seen.add(key);
        leaks.push({ sinkFn: s.fnName, column: col, site, siteFn: this.siteFnOf.get(site) ?? null });
      }
      if (s.kind === "redact" && s.t.row && unrevealed(s.t.row).length > 0) for (const id of s.t.row.tags) stripped.add(id);
    }
    const tagSites: ProtectTagSite[] = [];
    for (const [id, meta] of this.tagMeta) tagSites.push({ skeleton: meta.skeleton, cols: meta.cols, stripped: stripped.has(id) });
    return { parseError: null, leaks, tagSites };
  }

  // ---------------------------------------------------------------- scopes

  private isFn(n: any): boolean {
    return n && (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression");
  }

  /** Pre-pass: build the scope tree, register every function, hoist names. */
  private declare(node: any, scope: Scope, curFn: any): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const c of node) this.declare(c, scope, curFn);
      return;
    }
    if (this.isFn(node)) {
      if (node.type === "FunctionDeclaration" && node.id) scope.names.add(node.id.name);
      const fnScope: Scope = { parent: scope, names: new Set(), id: this.scopeSeq++ };
      if (node.type === "FunctionExpression" && node.id) fnScope.names.add(node.id.name);
      for (const p of node.params) this.patternNames(p, fnScope.names);
      const name = node.id?.name ?? "";
      const info: FnInfo = {
        node, scope: fnScope, ret: clean(), yields: clean(), isGen: !!node.generator, name,
        skip: node.type === "FunctionDeclaration" && !!name && isModelledHelperName(name),
      };
      this.fnInfos.set(node, info);
      this.fnParent.set(node, curFn);
      if (node.type === "FunctionDeclaration" && node.id) {
        // A declared function's binding holds its function value.
        this.bindings.set(`${scope.id}:${node.id.name}`, { ...clean(), fns: new Set([node]) });
      }
      if (node.type === "FunctionExpression" && node.id) {
        this.bindings.set(`${fnScope.id}:${node.id.name}`, { ...clean(), fns: new Set([node]) });
      }
      this.declare(node.body, fnScope, node);
      return;
    }
    switch (node.type) {
      case "VariableDeclaration":
        for (const d of node.declarations) this.patternNames(d.id, scope.names);
        break;
      case "ClassDeclaration":
        if (node.id) scope.names.add(node.id.name);
        break;
      case "ImportDeclaration":
        for (const s of node.specifiers) if (s.local) scope.names.add(s.local.name);
        return;
      case "CatchClause":
        if (node.param) this.patternNames(node.param, scope.names);
        break;
    }
    for (const k in node) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = node[k];
      if (v && typeof v === "object") this.declare(v, scope, curFn);
    }
  }

  private patternNames(p: any, into: Set<string>): void {
    if (!p) return;
    switch (p.type) {
      case "Identifier": into.add(p.name); break;
      case "ObjectPattern": for (const pr of p.properties) this.patternNames(pr.type === "RestElement" ? pr.argument : pr.value, into); break;
      case "ArrayPattern": for (const el of p.elements) this.patternNames(el, into); break;
      case "RestElement": this.patternNames(p.argument, into); break;
      case "AssignmentPattern": this.patternNames(p.left, into); break;
    }
  }

  private resolve(name: string, scope: Scope): Scope | null {
    for (let s: Scope | null = scope; s; s = s.parent) if (s.names.has(name)) return s;
    return null;
  }

  private getBinding(name: string, scope: Scope): Taint {
    const s = this.resolve(name, scope);
    if (!s) return clean();
    return this.bindings.get(`${s.id}:${name}`) ?? clean();
  }

  private mergeBinding(name: string, scope: Scope, t: Taint): void {
    const s = this.resolve(name, scope) ?? this.moduleScope;
    const key = `${s.id}:${name}`;
    const prev = this.bindings.get(key) ?? clean();
    const next = join(prev, t);
    if (taintKey(prev) !== taintKey(next)) {
      this.bindings.set(key, next);
      this.changed = true;
    } else if (!this.bindings.has(key)) {
      this.bindings.set(key, next);
    }
  }

  private addRet(info: FnInfo, t: Taint): void {
    const next = join(info.ret, t);
    if (taintKey(next) !== taintKey(info.ret)) { info.ret = next; this.changed = true; }
  }

  private addYield(info: FnInfo | null, t: Taint): void {
    if (!info) return;
    const next = join(info.yields, t);
    if (taintKey(next) !== taintKey(info.yields)) { info.yields = next; this.changed = true; }
  }

  // ------------------------------------------------------------ naming

  /** Demangled display name of the function enclosing `fn` (for diagnostics). */
  private displayName(fn: any): string {
    let fallback = "";
    for (let f = fn; f; f = this.fnParent.get(f)) {
      const info = this.fnInfos.get(f);
      let name = info?.name ?? "";
      if (!name) {
        // `const broadcast = (…) => …` / `{ handler: async function (…) {…} }`
        name = this.inferredName(f);
      }
      if (!name) continue;
      const h = /^_scrml_handler_(.+?)(?:_\d+)?$/.exec(name);
      if (h) return h[1];
      if (name.startsWith("_scrml_")) { if (!fallback) fallback = name; continue; }
      return name;
    }
    // Only compiler-internal names on the chain (an SSR / mount-hydrate /
    // serverLoad handler): name the compiler egress itself.
    return fallback || "<module>";
  }

  /** `const broadcast = (…) => …` — the binding name of an anonymous function value. */
  private inferredNames = new Map<any, string>();
  private inferredName(fn: any): string {
    return this.inferredNames.get(fn) ?? "";
  }
  private collectInferredNames(node: any): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) this.collectInferredNames(c); return; }
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && this.isFn(node.init)) {
      this.inferredNames.set(node.init, node.id.name);
    }
    // `export const _scrml_route_x = { handler: async function (…) {…} }`
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.init?.type === "ObjectExpression") {
      for (const pr of node.init.properties) if (pr.type === "Property" && this.isFn(pr.value)) this.inferredNames.set(pr.value, node.id.name);
    }
    for (const k in node) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const v = node[k];
      if (v && typeof v === "object") this.collectInferredNames(v);
    }
  }

  private site(node: any, fn: FnInfo | null): string {
    let text = this.src.slice(node.start, node.end).replace(/\s+/g, " ");
    if (text.length > 70) text = text.slice(0, 67) + "...";
    const where = this.displayName(fn?.node ?? null);
    const s = `\`${text}\` in \`${where}\``;
    this.siteFnOf.set(s, where);
    return s;
  }
  private siteFnOf = new Map<string, string>();

  // -------------------------------------------------------- statements

  private walkBody(stmts: any[], scope: Scope, fn: FnInfo | null): void {
    for (const s of stmts) this.walkStmt(s, scope, fn);
  }

  private walkStmt(node: any, scope: Scope, fn: FnInfo | null): void {
    if (!node) return;
    switch (node.type) {
      case "VariableDeclaration":
        for (const d of node.declarations) {
          const v = d.init ? this.evalExpr(d.init, scope, fn) : clean();
          this.bindPattern(d.id, v, scope, fn);
        }
        return;
      case "FunctionDeclaration":
      case "ClassDeclaration":
      case "EmptyStatement":
      case "DebuggerStatement":
      case "BreakStatement":
      case "ContinueStatement":
      case "ImportDeclaration":
        if (node.type === "ClassDeclaration") this.evalGeneric(node, scope, fn);
        return;
      case "ReturnStatement":
        if (node.argument) {
          const v = this.evalExpr(node.argument, scope, fn);
          if (fn) this.addRet(fn, v);
        }
        return;
      case "ExpressionStatement":
        this.evalExpr(node.expression, scope, fn);
        return;
      case "BlockStatement":
      case "StaticBlock":
        this.walkBody(node.body, scope, fn);
        return;
      case "IfStatement":
        this.evalExpr(node.test, scope, fn);
        this.walkStmt(node.consequent, scope, fn);
        this.walkStmt(node.alternate, scope, fn);
        return;
      case "ForStatement":
        if (node.init) {
          if (node.init.type === "VariableDeclaration") this.walkStmt(node.init, scope, fn);
          else this.evalExpr(node.init, scope, fn);
        }
        if (node.test) this.evalExpr(node.test, scope, fn);
        if (node.update) this.evalExpr(node.update, scope, fn);
        this.walkStmt(node.body, scope, fn);
        return;
      case "WhileStatement":
      case "DoWhileStatement":
        this.evalExpr(node.test, scope, fn);
        this.walkStmt(node.body, scope, fn);
        return;
      case "ForOfStatement":
      case "ForInStatement": {
        const right = this.evalExpr(node.right, scope, fn);
        const el = node.type === "ForOfStatement" ? elemOf(right) : clean();
        if (node.left.type === "VariableDeclaration") {
          const id = node.left.declarations[0].id;
          this.bindPattern(id, el, scope, fn);
          // §37 SSE: the compiler's own frame loop serializes `event` / `id` off
          // each yielded frame OUTSIDE the redact — the whole frame is a sink.
          if (node.type === "ForOfStatement" && node.await && id.type === "Identifier" && id.name === "_scrml_val") {
            this.sinks.push({ t: el, fnName: this.displayName(fn?.node ?? null), kind: "frame" });
          }
        } else {
          this.bindPattern(node.left, el, scope, fn);
        }
        this.walkStmt(node.body, scope, fn);
        return;
      }
      case "TryStatement":
        this.walkStmt(node.block, scope, fn);
        if (node.handler) this.walkStmt(node.handler.body, scope, fn);
        this.walkStmt(node.finalizer, scope, fn);
        return;
      case "SwitchStatement":
        this.evalExpr(node.discriminant, scope, fn);
        for (const c of node.cases) {
          if (c.test) this.evalExpr(c.test, scope, fn);
          this.walkBody(c.consequent, scope, fn);
        }
        return;
      case "LabeledStatement":
        this.walkStmt(node.body, scope, fn);
        return;
      case "ThrowStatement":
        this.evalExpr(node.argument, scope, fn);
        return;
      case "ExportNamedDeclaration":
        if (node.declaration) this.walkStmt(node.declaration, scope, fn);
        return;
      case "ExportDefaultDeclaration":
        if (node.declaration) {
          if (node.declaration.type.endsWith("Declaration")) this.walkStmt(node.declaration, scope, fn);
          else this.evalExpr(node.declaration, scope, fn);
        }
        return;
      case "ExportAllDeclaration":
        return;
      default:
        this.evalGeneric(node, scope, fn);
    }
  }

  /** Visit every expression under `node` for side effects; the node's own value is clean. */
  private evalGeneric(node: any, scope: Scope, fn: FnInfo | null): Taint {
    for (const k in node) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = node[k];
      if (!v || typeof v !== "object") continue;
      const items = Array.isArray(v) ? v : [v];
      for (const it of items) {
        if (!it || typeof it.type !== "string") continue;
        if (this.isFn(it)) continue;
        if (/Statement$|Declaration$/.test(it.type)) this.walkStmt(it, scope, fn);
        else if (it.type === "ClassBody" || it.type === "MethodDefinition" || it.type === "PropertyDefinition") this.evalGeneric(it, scope, fn);
        else this.evalExpr(it, scope, fn);
      }
    }
    return clean();
  }

  // -------------------------------------------------------- patterns

  private bindPattern(p: any, t: Taint, scope: Scope, fn: FnInfo | null): void {
    if (!p) return;
    switch (p.type) {
      case "Identifier":
        this.mergeBinding(p.name, scope, t);
        return;
      case "ObjectPattern":
        for (const pr of p.properties) {
          if (pr.type === "RestElement") {
            // Object rest copies enumerable Symbol-keyed props too — the
            // descriptor survives, exactly as for `{...row}`.
            this.bindPattern(pr.argument, t, scope, fn);
            continue;
          }
          let v: Taint;
          if (pr.computed) {
            const k = staticKey(pr.key);
            this.evalExpr(pr.key, scope, fn);
            v = this.memberRead(t, k, k === null, pr, fn);
          } else {
            const k = pr.key.type === "Identifier" ? pr.key.name : staticKey(pr.key);
            v = this.memberRead(t, k, false, pr, fn);
          }
          this.bindPattern(pr.value, v, scope, fn);
        }
        return;
      case "ArrayPattern":
        for (const el of p.elements) {
          if (!el) continue;
          if (el.type === "RestElement") this.bindPattern(el.argument, t, scope, fn);
          else this.bindPattern(el, this.memberRead(t, "0", false, el, fn), scope, fn);
        }
        return;
      case "RestElement":
        this.bindPattern(p.argument, t, scope, fn);
        return;
      case "AssignmentPattern":
        this.bindPattern(p.left, join(t, this.evalExpr(p.right, scope, fn)), scope, fn);
        return;
      case "MemberExpression":
        this.evalExpr(p.object, scope, fn);
        if (p.computed) this.evalExpr(p.property, scope, fn);
        this.mutateRoot(p.object, containerOf(t), scope);
        return;
    }
  }

  /** `a.b.c = v` / `a.push(v)` — the value now lives inside the root binding `a`. */
  private mutateRoot(expr: any, t: Taint, scope: Scope): void {
    let e = expr;
    while (e && (e.type === "MemberExpression" || e.type === "ChainExpression")) e = e.type === "ChainExpression" ? e.expression : e.object;
    if (e && e.type === "Identifier") this.mergeBinding(e.name, scope, t);
  }

  // -------------------------------------------------------- expressions

  /**
   * A field / index read off a value. This is where extraction happens: a
   * protected column read off a descriptor-bearing row becomes a NAKED scalar.
   */
  private memberRead(o: Taint, key: string | null, dynamic: boolean, node: any, fn: FnInfo | null): Taint {
    const r = clean();
    const numeric = key !== null && /^\d+$/.test(key);
    if (o.row) {
      if (dynamic) {
        // `rows[i]` (an element — still a row) OR `u[k]` (any column): both.
        r.row = joinRow(null, o.row);
        for (const c of unrevealed(o.row)) r.scalar.set(c, this.site(node, fn));
      } else if (numeric) {
        r.row = joinRow(null, o.row);
      } else if (key !== null && key !== "length") {
        // A named protected column keeps its name; any other column read off a
        // strip-all row (unresolvable SQL) is protected-by-default, labelled `*`.
        if (!o.row.revealed.has(key)) {
          if (o.row.cols.has(key)) r.scalar.set(key, this.site(node, fn));
          else if (o.row.all) r.scalar.set(ALL_COLUMNS_LABEL, this.site(node, fn));
        }
      }
    }
    if (o.deep.size > 0) {
      mergeMap(r.scalar, o.deep);
      mergeMap(r.deep, o.deep);
    }
    // A property of a primitive (`.length`) is derived; a CHARACTER of it is not.
    if (o.scalar.size > 0 && (dynamic || numeric)) mergeMap(r.scalar, o.scalar);
    for (const f of o.fns) r.fns.add(f);
    return r;
  }

  private evalExpr(node: any, scope: Scope, fn: FnInfo | null): Taint {
    if (!node) return clean();
    switch (node.type) {
      case "Identifier":
        if (node.name === "undefined") return clean();
        return this.getBinding(node.name, scope);
      case "Literal":
      case "ThisExpression":
      case "Super":
      case "MetaProperty":
      case "PrivateIdentifier":
        return clean();
      case "TemplateLiteral": {
        const r = clean();
        for (const e of node.expressions) mergeMap(r.scalar, naked(this.evalExpr(e, scope, fn)));
        return r;
      }
      case "TaggedTemplateExpression": {
        const tagT = this.evalExpr(node.tag, scope, fn);
        const args = node.quasi.expressions.map((e: any) => this.evalExpr(e, scope, fn));
        if (tagT.fns.size > 0) return this.applyFns(tagT.fns, args);
        const path = this.globalPath(node.tag, scope);
        if (path === "String.raw") {
          const r = clean();
          for (const a of args) mergeMap(r.scalar, naked(a));
          return r;
        }
        // `_scrml_sql`…`` / `tx`…`` — a query. Its interpolations are bound
        // parameters (server-side use), and its result is untagged data.
        return clean();
      }
      case "ArrayExpression": {
        let r = clean();
        for (const el of node.elements) {
          if (!el) continue;
          const v = el.type === "SpreadElement" ? this.evalExpr(el.argument, scope, fn) : this.evalExpr(el, scope, fn);
          r = join(r, el.type === "SpreadElement" ? containerOf(elemOf(v)) : containerOf(v));
        }
        return r;
      }
      case "ObjectExpression": {
        let r = clean();
        for (const pr of node.properties) {
          if (pr.type === "SpreadElement") {
            // `{...row}` copies the enumerable Symbol descriptor: still a row.
            r = join(r, containerOf(this.evalExpr(pr.argument, scope, fn)));
            continue;
          }
          if (pr.computed) this.evalExpr(pr.key, scope, fn);
          r = join(r, containerOf(this.evalExpr(pr.value, scope, fn)));
        }
        return r;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return { ...clean(), fns: new Set([node]) };
      case "ClassExpression":
        return this.evalGeneric(node, scope, fn);
      case "UnaryExpression":
      case "UpdateExpression":
        this.evalExpr(node.argument, scope, fn);
        return clean();
      case "BinaryExpression": {
        const l = this.evalExpr(node.left, scope, fn);
        const rr = this.evalExpr(node.right, scope, fn);
        if (node.operator !== "+") return clean();
        // String concatenation embeds a protected scalar VERBATIM. A row
        // concatenates as "[object Object]" and carries nothing.
        const r = clean();
        mergeMap(r.scalar, naked(l));
        mergeMap(r.scalar, naked(rr));
        return r;
      }
      case "LogicalExpression":
        return join(this.evalExpr(node.left, scope, fn), this.evalExpr(node.right, scope, fn));
      case "ConditionalExpression":
        this.evalExpr(node.test, scope, fn);
        return join(this.evalExpr(node.consequent, scope, fn), this.evalExpr(node.alternate, scope, fn));
      case "AssignmentExpression": {
        const rv = this.evalExpr(node.right, scope, fn);
        let v = rv;
        if (node.operator === "+=") {
          const lv = this.evalExpr(node.left, scope, fn);
          v = clean();
          mergeMap(v.scalar, naked(lv));
          mergeMap(v.scalar, naked(rv));
        } else if (node.operator !== "=" && node.operator !== "||=" && node.operator !== "&&=" && node.operator !== "??=") {
          this.evalExpr(node.left, scope, fn);
          return clean();
        }
        this.bindPattern(node.left, v, scope, fn);
        return v;
      }
      case "SequenceExpression": {
        let last = clean();
        for (const e of node.expressions) last = this.evalExpr(e, scope, fn);
        return last;
      }
      case "AwaitExpression":
        return this.evalExpr(node.argument, scope, fn);
      case "YieldExpression": {
        const v = node.argument ? this.evalExpr(node.argument, scope, fn) : clean();
        this.addYield(fn, node.delegate ? elemOf(v) : v);
        return clean();
      }
      case "ChainExpression":
      case "ParenthesizedExpression":
        return this.evalExpr(node.expression, scope, fn);
      case "MemberExpression": {
        const o = this.evalExpr(node.object, scope, fn);
        let key: string | null;
        let dynamic = false;
        if (node.computed) {
          this.evalExpr(node.property, scope, fn);
          key = staticKey(node.property);
          dynamic = key === null;
        } else {
          key = node.property.type === "Identifier" || node.property.type === "PrivateIdentifier" ? node.property.name : null;
        }
        return this.memberRead(o, key, dynamic, node, fn);
      }
      case "CallExpression":
      case "NewExpression":
        return this.evalCall(node, scope, fn);
      case "ImportExpression":
        this.evalExpr(node.source, scope, fn);
        return clean();
      default:
        return this.evalGeneric(node, scope, fn);
    }
  }

  /** `JSON.stringify` / `String` — the dotted path of an UNRESOLVED (global) callee. */
  private globalPath(callee: any, scope: Scope): string | null {
    if (callee.type === "Identifier") return this.resolve(callee.name, scope) ? null : callee.name;
    if (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier" && callee.property.type === "Identifier") {
      if (this.resolve(callee.object.name, scope)) return null;
      return `${callee.object.name}.${callee.property.name}`;
    }
    return null;
  }

  private applyFns(fns: Set<any>, args: Taint[], everyParam?: Taint): Taint {
    let r = clean();
    for (const f of fns) {
      const info = this.fnInfos.get(f);
      if (!info || info.skip) continue;
      f.params.forEach((p: any, i: number) => {
        if (everyParam) this.bindPattern(p.type === "RestElement" ? p.argument : p, everyParam, info.scope, info);
        else if (p.type === "RestElement") this.bindPattern(p.argument, containerOf(join(...args.slice(i))), info.scope, info);
        else this.bindPattern(p, args[i] ?? clean(), info.scope, info);
      });
      r = join(r, info.isGen ? containerOf(join(info.yields, info.ret)) : info.ret);
    }
    return r;
  }

  private evalCall(node: any, scope: Scope, fn: FnInfo | null): Taint {
    const callee = node.callee;
    const args: Taint[] = node.arguments.map((a: any) =>
      a.type === "SpreadElement" ? elemOf(this.evalExpr(a.argument, scope, fn)) : this.evalExpr(a, scope, fn));

    // --- the compiler's own protect runtime, modelled exactly -----------------
    if (callee.type === "Identifier" && !this.resolveLocalShadow(callee.name, scope)) {
      const name = callee.name;
      if (name === "_scrml_protect_tag") {
        const colsArg = node.arguments[1];
        let cols: string[] | "*" = [];
        if (colsArg?.type === "Literal" && colsArg.value === "*") cols = "*";
        else if (colsArg?.type === "ArrayExpression") {
          cols = colsArg.elements.filter((e: any) => e?.type === "Literal" && typeof e.value === "string").map((e: any) => e.value);
        }
        if (!this.tagMeta.has(node.start)) this.tagMeta.set(node.start, { skeleton: this.tagSkeleton(node.arguments[0]), cols });
        return {
          ...clean(),
          row: { tags: new Set([node.start]), cols: new Set(cols === "*" ? [] : cols), all: cols === "*", revealed: new Set() },
        };
      }
      if (name === "_scrml_protect_reveal") {
        const v = args[0] ?? clean();
        const col = staticKey(node.arguments[1]);
        if (v.row && col !== null) {
          const row = joinRow(null, v.row)!;
          row.revealed.add(col);
          return { ...v, row };
        }
        return v;
      }
      if (name === "_scrml_protect_redact") {
        this.sinks.push({ t: args[0] ?? clean(), fnName: this.displayName(fn?.node ?? null), kind: "redact" });
        return clean();
      }
      if (isModelledHelperName(name)) {
        // `_scrml_tenant_redact(v, t)` / `_scrml_tenant_tag(v, …)` preserve the
        // protect descriptor on survivors (§14.8.10 composes inside §14.8.9).
        return args[0] ?? clean();
      }
    }

    // --- method calls ----------------------------------------------------------
    if (callee.type === "MemberExpression" || (callee.type === "ChainExpression" && callee.expression.type === "MemberExpression")) {
      const m = callee.type === "ChainExpression" ? callee.expression : callee;
      const path = this.globalPath(m, scope);
      if (path === "Response.json") {
        this.sinks.push({ t: args[0] ?? clean(), fnName: this.displayName(fn?.node ?? null), kind: "serializer-json" });
        return clean();
      }
      if (path !== null) {
        const b = this.builtin(path, args);
        if (b) return b;
      }
      const recv = this.evalExpr(m.object, scope, fn);
      let method: string | null = null;
      if (m.computed) { this.evalExpr(m.property, scope, fn); method = staticKey(m.property); }
      else if (m.property.type === "Identifier") method = m.property.name;

      // Bytes leaving the server: a channel publish, an SSE chunk, a WS send.
      const sinkArg = method === "publish" ? 1 : (method === "enqueue" || method === "send") ? 0 : -1;
      if (sinkArg >= 0) {
        this.sinks.push({ t: args[sinkArg] ?? clean(), fnName: this.displayName(fn?.node ?? null), kind: "serializer" });
      }

      if ((method === "call" || method === "apply") && recv.fns.size > 0) {
        if (method === "call") return this.applyFns(recv.fns, args.slice(1));
        // `f.apply(this, list)`: every parameter may receive any list element.
        return this.applyFns(recv.fns, [], elemOf(args[1] ?? clean()));
      }
      if (method === "bind" && recv.fns.size > 0) return { ...clean(), fns: new Set(recv.fns) };

      // `row.reveal("col")` left UNLOWERED — the scrml declassification written
      // inside a `_{}` foreign block, where the compiler does not rewrite it to
      // `_scrml_protect_reveal`. It is the author's explicit declassification of
      // that column (the same reading E-PROTECT-004's suppression gives it); at
      // runtime a plain row has no `.reveal`, so the call throws before anything
      // ships. Honour it as a reveal rather than report a leak that cannot occur.
      if (method === "reveal" && recv.row) {
        const col = staticKey(node.arguments[0]);
        if (col !== null) {
          const row = joinRow(null, recv.row)!;
          row.revealed.add(col);
          return { ...recv, row };
        }
      }

      if (method !== null && CALLBACK_METHODS.has(method)) return this.callbackMethod(method, recv, args, node, fn);

      if (method !== null && MUTATING_METHODS.has(method)) {
        const written = method === "set" ? (args[1] ?? clean()) : method === "splice" ? join(...args.slice(2)) : join(...args);
        this.mutateRoot(m.object, containerOf(written), scope);
        return method === "push" || method === "unshift" ? clean() : join(recv, containerOf(written));
      }
      // A method stored in an object literal the module built (`api.f(x)`).
      const viaField = this.memberRead(recv, method, method === null, node, fn);
      let r = clean();
      if (viaField.fns.size > 0) r = join(r, this.applyFns(viaField.fns, args));

      if (method !== null && DERIVED_METHODS.has(method)) return r;
      if (method !== null && ELEMENT_METHODS.has(method)) return join(r, elemOf(recv));
      if (method !== null && JOINING_METHODS.has(method)) {
        const s = clean();
        mergeMap(s.scalar, naked(recv));
        return join(r, s);
      }
      // Any other method: the result may be the receiver, a slice or transform
      // of it (`slice`, `concat`, `trim`, `toUpperCase`, `replace`, `split`, …),
      // or one of the arguments woven in. Fail CLOSED: keep all of it.
      const out: Taint = { row: recv.row ? joinRow(null, recv.row) : null, scalar: new Map(recv.scalar), deep: new Map(recv.deep), fns: new Set() };
      if (recv.scalar.size > 0 || recv.deep.size > 0) for (const a of args) mergeMap(out.scalar, naked(a));
      return join(r, out);
    }

    // --- plain calls -------------------------------------------------------------
    const ct = this.evalExpr(callee, scope, fn);
    if (ct.fns.size > 0) return this.applyFns(ct.fns, args);
    const path = this.globalPath(callee, scope);
    if (path === "Response" && node.type === "NewExpression") {
      // A response body the server sends. (An AUTHOR-built one is also
      // E-PROTECT-005 and refused at runtime; a compiler-built one must only
      // ever carry redacted bytes — this is what checks that.)
      this.sinks.push({ t: args[0] ?? clean(), fnName: this.displayName(fn?.node ?? null), kind: "serializer" });
      return clean();
    }
    if (path !== null) {
      const b = this.builtin(path, args);
      if (b) return b;
    }
    return this.opaqueCall(args);
  }

  /** A callee identifier that a local binding shadows is not the runtime helper. */
  private resolveLocalShadow(name: string, scope: Scope): boolean {
    const s = this.resolve(name, scope);
    return !!s && s !== this.moduleScope;
  }

  private builtin(path: string, args: Taint[]): Taint | null {
    if (SERIALIZING_BUILTINS.has(path)) {
      // The descriptor is a Symbol key: `JSON.stringify` / `Object.values` /
      // `structuredClone` drop it and keep the column. Everything the row
      // carried comes out NAKED.
      const r = clean();
      for (const a of args) {
        mergeMap(r.scalar, naked(a));
        if (a.row) for (const c of unrevealed(a.row)) if (!r.scalar.has(c)) r.scalar.set(c, `\`${path}(…)\` of a protected row`);
      }
      r.deep = new Map(r.scalar);
      return r;
    }
    if (STRINGIFY_BUILTINS.has(path)) {
      const r = clean();
      for (const a of args) mergeMap(r.scalar, naked(a));
      return r;
    }
    if (IDENTITY_BUILTINS.has(path)) {
      if (path === "Array.of") return join(...args.map(containerOf));
      return join(...args);
    }
    return null;
  }

  /**
   * A call into code this module does not define (an import, a platform API).
   * A SCALAR argument yields a DERIVED result — `verifyPassword(pw, u.passwordHash)`
   * is a boolean of independent identity (§14.8.9 bound). A CONTAINER argument
   * is assumed returned as-is (descriptor-preserving), so its naked contents
   * stay naked and its rows stay rows.
   */
  private opaqueCall(args: Taint[]): Taint {
    const r = clean();
    for (const a of args) {
      if (a.row) r.row = joinRow(r.row, a.row);
      mergeMap(r.deep, a.deep);
    }
    return r;
  }

  private callbackMethod(method: string, recv: Taint, args: Taint[], node: any, fn: FnInfo | null): Taint {
    const cb = args[0] ?? clean();
    const el = elemOf(recv);
    let cbRet = clean();
    if (cb.fns.size > 0) {
      let params: Taint[];
      if (method === "reduce" || method === "reduceRight") params = [join(args[1] ?? clean()), el, clean(), recv];
      else if (method === "then") params = [recv];
      else if (method === "catch" || method === "finally") params = [clean()];
      else params = [el, clean(), recv];
      cbRet = this.applyFns(cb.fns, params);
      if (method === "reduce" || method === "reduceRight") {
        // The accumulator also receives every callback return.
        cbRet = join(cbRet, this.applyFns(cb.fns, [cbRet, el, clean(), recv]));
      }
    } else if (method === "map" || method === "flatMap") {
      // An opaque callback (`rows.map(format)`): the element may come back as-is.
      cbRet = el;
    }
    switch (method) {
      case "map":
      case "flatMap":
        return containerOf(cbRet);
      case "filter":
      case "sort":
      case "toSorted":
        return recv;
      case "find":
      case "findLast":
        return el;
      case "reduce":
      case "reduceRight":
        return join(args[1] ?? clean(), cbRet);
      case "then":
        return cb.fns.size > 0 ? cbRet : recv;
      case "catch":
        return join(recv, cbRet);
      case "finally":
        return recv;
      default:
        return clean();
    }
  }

  /** The static SQL skeleton wrapped by a `_scrml_protect_tag` first argument. */
  private tagSkeleton(arg: any): string | null {
    let found: string | null = null;
    const stack = [arg];
    while (stack.length > 0 && found === null) {
      const n = stack.pop();
      if (!n || typeof n !== "object") continue;
      if (Array.isArray(n)) { for (const c of n) stack.push(c); continue; }
      if (n.type === "TaggedTemplateExpression") {
        found = sqlSkeleton(n.quasi.quasis.map((q: any) => q.value.cooked ?? q.value.raw).join("${}"));
        break;
      }
      if (n.type === "CallExpression" && n.callee?.type === "MemberExpression" && n.callee.property?.name === "unsafe"
          && n.arguments[0]?.type === "Literal" && typeof n.arguments[0].value === "string") {
        found = sqlSkeleton(n.arguments[0].value);
        break;
      }
      for (const k in n) {
        if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
        const v = n[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
    return found;
  }
}
