#!/usr/bin/env bun
/**
 * scripts/int-number-census.ts — the corpus census behind the `int` / `number`
 * assignability ruling (SPEC §7.5.1 position 3).
 *
 * WHY THIS EXISTS (S404)
 * ======================
 * SPEC §7.5.1 states, verbatim, that *"Position 3 cannot be turned on before an `int` / `number`
 * assignability ruling exists"*, and it justifies the block with a MEASUREMENT:
 *
 *   > Measured over 1920 corpus `.scrml` files, turning on argument assignability with today's
 *   > inference produces 37 new rejections of which **all 37 are false positives**, and every one
 *   > is the same shape: a `number` literal passed to an `int`-annotated parameter.
 *
 * That figure was measured once, at an unnamed commit, and has been RELAYED since — including in a
 * mutated "37 of 40" form that the SPEC does not say. A ruling that rests on a number deserves a
 * number that can be re-derived on demand. This script is that instrument: run it, get the pair.
 *
 * ⚑ IT MEASURES A RULE THAT DOES NOT EXIST YET, AND THAT IS THE POINT. §7.5.1 position 3 is
 * `not checked` — there is NO argument-assignability code in the compiler to run. (The
 * `fieldTypeAssignable` / `fieldTypeEquals` pair in `type-system.ts` is the §14.8.8
 * SQL-projection-row-vs-`:struct`-contract width-subtyping path, explicitly BOUNDED to that use
 * and reached from nowhere else.) So this script MODELS the candidate rule against the real parse
 * and reports what it would do. Every modelling choice is named in `--json` output rather than
 * baked into a single headline number.
 *
 * THE FOUR QUESTIONS
 * ==================
 *   Q1  Every `int` / `integer` ANNOTATION POSITION in the corpus, cross-tabbed on two axes:
 *       the POSITION (fn param · fn return · struct field · state cell · schema column ·
 *       let/const · other) and the NESTING (direct · array element · map key · map value ·
 *       union member), because `int[]` and `[int: string]` are the same `int` in different holes.
 *   Q2  Every CALL SITE reaching an `int`/`integer`-annotated parameter, classified by what is
 *       actually passed.
 *   Q3  THE DIAGONAL. How many Q2 sites a strict name-equality rule would REJECT, and how many of
 *       those are integral literals. Reported in TWO readings (see MODELLING, below) because the
 *       strict reading and the today's-inference reading are different numbers and the SPEC's
 *       sentence is about the second.
 *   Q4  THE REVERSE DIRECTION. Call sites passing an `int`/`integer`-typed value into a
 *       `number`-annotated parameter. Under a refinement reading this is the SAFE direction and a
 *       rule that rejects it is wrong on its face.
 *
 * RULE 7 — POST-AST, NOT REGEX
 * ============================
 * This is a post-AST question and it is answered from the real parse. Every `.scrml` goes through
 * the compiler's own `runBlockSplitter` -> `runTAB`, and every type question is answered by the
 * compiler's own resolvers — `buildTypeRegistry`, `resolveTypeExpr`, `parseStructBody` from
 * `type-system.ts`, and `parseSchemaBlock` from `schema-differ.js`. There is NO regex over scrml
 * source text anywhere in this file. Full corpus parse measured at ~2.5 ms/file / ~7 s for 2555
 * files, so the fallback this rule contemplates was never needed.
 *
 * ANTI-TRUNCATION (pa-base §8 — the truncated probe; primary.map.md invariant 59)
 * ==============================================================================
 * A truncated enumeration reads exactly like a complete one. Every total this script prints is
 * an `N of M` pair against the population it was drawn from, so a collapse is VISIBLE in the
 * output instead of inferable from it:
 *   - files parsed          `N of M` discovered
 *   - annotation sites      `N of M` annotation-bearing sites reached
 *   - call expressions      `N of M` resolved to a declared callee
 *   - classified arguments  `N of M` arguments at an int-annotated parameter
 * Nothing is silently dropped: an unrecognised expression kind becomes an `other:<kind>`
 * sub-bucket and an unresolved callee is counted in its own line. `--json` carries every raw
 * site so the summary can be audited against it.
 *
 * MODELLING — the choices, stated rather than buried
 * ==================================================
 * (a) `int` is an ALIAS of `integer` (`BUILTIN_TYPES`, `type-system.ts`), so the two spellings are
 *     ONE type here. The per-spelling counts are reported anyway because they are free.
 * (b) GCP3 classifies every numeric literal as `number` (§45), so `1` is a `number` and never an
 *     `integer`. A rule keyed on the RESOLVED type therefore rejects `f(1)` for an `int` param.
 *     That is the whole of the "37".
 * (c) Q3 has TWO readings and both are reported:
 *       STRICT       — reject every Q2 site whose argument is not `int`-annotated. This is the
 *                      literal name-equality rule, and it rejects things today's compiler cannot
 *                      even type, which no real widening would do.
 *       PROVABLE     — reject only sites whose argument type is PROVABLE (a literal, or an
 *                      identifier with a resolvable primitive annotation) and is not `integer`.
 *                      This is the population a §7.5.1 position-3 widening built on today's
 *                      inference would actually reject, and it is the reading the SPEC sentence
 *                      is about.
 * (d) Callee resolution is same-file first, then import-resolved (relative specifiers, and
 *     `scrml:NAME` -> `stdlib/NAME/index.scrml`). A callee that resolves to neither is COUNTED,
 *     not dropped — see the `unresolvedCallee` line. Method calls (`obj.m()`) have no declared
 *     scrml signature to reach and are counted separately.
 * (e) Identifier arguments are resolved through a real lexical scope stack (fn params, then
 *     block-local `let`/`const` in source order, then file-level state cells for `@name`).
 *
 * WHICH CORPUS — and why the SPEC's "1920" is NOT the whole tree
 * ==============================================================
 * §7.5.1 says its measurement was taken "over 1920 corpus `.scrml` files". The whole tree holds
 * **2555** (2518 tracked + 37 gitignored test fixtures). The 1920 is the population
 * `scripts/corpus-emit-differential.ts` enumerates — its `DEFAULT_ROOTS` are
 * `examples · samples · conformance · stdlib · benchmarks`, which EXCLUDES `compiler/` and
 * `docs/`. Counted at this watermark that set is exactly 1920, so the figure is identified, not
 * guessed. `--roots=…` reproduces it:
 *
 *   bun scripts/int-number-census.ts --summary --roots=examples,samples,conformance,stdlib,benchmarks
 *
 * That distinction is load-bearing and not a footnote: `compiler/self-host-v2/lex.scrml` alone
 * carries the single largest block of int-param call sites in the tree and sits OUTSIDE the
 * differential's roots, so a whole-tree number and a §7.5.1 number are different measurements of
 * different things. Report which one you ran.
 *
 * MODES
 *   bun scripts/int-number-census.ts             summary + the full per-site listings
 *   bun scripts/int-number-census.ts --summary   totals only (the DONE-PROBE shape)
 *   bun scripts/int-number-census.ts --json      machine-readable, every site included
 *   bun scripts/int-number-census.ts --roots=a,b restrict the corpus to these top-level roots
 *   bun scripts/int-number-census.ts --selftest  fixture-driven check of the classifiers
 *
 * EXIT CODES
 *   0  the census ran over a plausible corpus
 *   2  NOT A VALID RUN: the enumeration collapsed below MIN_FILES (a truncated probe — refuse to
 *      report a census over a remnant), or --selftest failed
 */

import { readdirSync, readFileSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { runBlockSplitter } from "../compiler/src/block-splitter.js";
import { runTAB } from "../compiler/src/ast-builder.js";
import { BUILTIN_TYPES, buildTypeRegistry, inferExprType, parseEnumBody, parseStructBody, resolveTypeExpr } from "../compiler/src/type-system.ts";
import { parseSchemaBlock } from "../compiler/src/schema-differ.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const STDLIB_ROOT = join(REPO_ROOT, "stdlib");

/** Directory names never descended into. `worktrees` keeps a sibling agent's tree out of the count. */
const SKIP_DIRS = new Set(["node_modules", ".git", "worktrees"]);

/**
 * HARD FLOOR on the enumerated file count. The corpus only grows; a run that finds fewer than
 * this has almost certainly truncated (a moved directory, a broken walk) and MUST NOT report a
 * census over the remnant. Set below the smallest LEGITIMATE population — the 5-root §7.5.1 set
 * (1920 at this watermark) — with headroom. `--roots` narrows the corpus DELIBERATELY, so the
 * floor is scaled down when it is used; the truncation being guarded against is an ACCIDENTAL
 * collapse, and a declared narrowing is not one.
 */
const MIN_FILES = 1500;
/** Floor when `--roots` is in play: a declared narrowing may legitimately be small. */
const MIN_FILES_ROOTED = 1;

/** The two spellings that resolve to `tPrimitive("integer")`. `int` is an ALIAS, not a sibling. */
const INT_SPELLINGS = new Set(["int", "integer"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResolvedTypeLike = {
  kind: string;
  name?: string;
  element?: ResolvedTypeLike;
  key?: ResolvedTypeLike;
  value?: ResolvedTypeLike;
  members?: ResolvedTypeLike[];
  set?: boolean;
  /** enum only — `payload` is a `Map<fieldName, ResolvedType>` or null (see `VariantDef`). */
  variants?: Array<{ name: string; payload: Map<string, ResolvedTypeLike> | null }>;
  fields?: Map<string, ResolvedTypeLike>;
};

type Nesting = "direct" | "array-element" | "map-key" | "map-value" | "union-member" | "enum-payload" | "deeper";

type Position =
  | "fn-param" | "fn-return" | "struct-field" | "enum-payload" | "state-cell" | "schema-column"
  | "let-const-decl" | string; // `other:<nodeKind>` for anything not anticipated

type AnnotationSite = {
  file: string;
  line: number;
  /**
   * ⚑ WHAT THE `line` ACTUALLY POINTS AT. `exact` = the site's own line. `decl-head` = the line of
   * the enclosing `type` / `<schema>` declaration, because the per-FIELD line is not recoverable:
   * `parseStructBody` / `parseEnumBody` / `parseSchemaBlock` return resolved types keyed by name and
   * throw the per-field source position away, and `splitTopLevel` (the splitter that would give it
   * back) is not exported. Labelling it is the only honest option — this file's own rule at the
   * `citeLine` comment is that a citation which is present, plausible and wrong is WORSE than an
   * absent one, so a decl-head line says so rather than impersonating a field line.
   */
  lineKind: "exact" | "decl-head";
  position: Position;
  nesting: Nesting;
  spelling: string;      // the source spelling: `int` or `integer` (or "" when not recoverable)
  owner: string;         // fn name / field name / cell name / column name
  annotation: string;    // the full annotation text this int was found inside
};

type ArgBucket =
  | "integral-literal" | "fractional-literal" | "int-annotated" | "number-annotated"
  | "unannotated" | string; // `other:<kind>`, `non-numeric-literal:<litType>`, `other-annotated:<t>`

type CallSite = {
  file: string;
  line: number;
  callee: string;
  calleeFile: string;
  resolution: "local" | "import" | "stdlib";
  paramName: string;
  paramIndex: number;
  paramAnnotation: string;
  bucket: ArgBucket;
  /** true when the argument's type is PROVABLE today (a literal, or an annotated identifier). */
  provable: boolean;
  /** the resolved primitive name of the argument, when there is one */
  argType: string;
  argKind: string;
  /**
   * For an `other:call` argument: the primitive its callee DECLARES it returns, when the callee is
   * resolvable and its `-> T` names a primitive. "" otherwise.
   *
   * ⚑ THIS IS THE DIFFERENCE BETWEEN "UNKNOWABLE" AND "NOT YET ASKED", AND IT BEARS ON THE RULING.
   * `isIdentCont(peekCode(c, 0))` classifies `other:call` only because `inferExprType` gaps on
   * every `call` node — yet `peekCode` is declared `-> int` right there in the source. Those sites
   * are recoverable by a return-type-aware inference, which is a DIFFERENT and much cheaper lever
   * than an int/number assignability ruling. Reporting them separately keeps the two levers from
   * being conflated in the blast-radius figure.
   */
  calleeReturns: string;
};

type FnDecl = {
  name: string;
  file: string;
  line: number;
  fnKind: string;
  isServer: boolean;
  params: Array<{ name: string; annotation: string }>;
  returnAnnotation: string;
};

// ---------------------------------------------------------------------------
// Corpus enumeration
// ---------------------------------------------------------------------------

/** Every `.scrml` under `root`, deterministic (code-unit-sorted) order. */
function enumerateScrml(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir).sort(); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e)) continue;
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (e.endsWith(".scrml")) out.push(p);
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// Type-tree inspection — answers "where does an `integer` sit inside this type?"
// ---------------------------------------------------------------------------

/**
 * Walk a ResolvedType (as produced by the compiler's own `resolveTypeExpr` /
 * `parseStructBody`) and yield the NESTING role of every `integer` primitive inside it.
 * `int[]` yields `array-element`; `[int: string]` yields `map-key`; `int` yields `direct`.
 * Depth-limited so a self-referential registry entry cannot hang the census.
 */
function integerNestings(t: ResolvedTypeLike | null | undefined, at: Nesting = "direct", depth = 0): Nesting[] {
  if (!t || typeof t !== "object" || depth > 12) return [];
  switch (t.kind) {
    case "primitive":
      return t.name === "integer" ? [at] : [];
    case "array":
      return integerNestings(t.element, at === "direct" ? "array-element" : "deeper", depth + 1);
    case "map":
      return [
        ...integerNestings(t.key, at === "direct" ? "map-key" : "deeper", depth + 1),
        ...integerNestings(t.value, at === "direct" ? "map-value" : "deeper", depth + 1),
      ];
    case "union":
      return (t.members ?? []).flatMap((m) =>
        integerNestings(m, at === "direct" ? "union-member" : "deeper", depth + 1));

    // ⚑ NOMINAL TYPES ARE A HARD STOP, AND THAT IS DELIBERATE — NOT THE ENUM OMISSION BEING
    // RE-INTRODUCED SOMEWHERE ELSE.
    // A `struct` / `enum` / `error` reached from HERE arrived by NAME (`fn f(e: PaymentError)`),
    // and that is a USE of the type, not a declaration of an annotation position. Its payload and
    // field annotations are counted exactly once, at their own declaration, by the dedicated decl
    // passes in `collectAnnotationSites`. Recursing here instead would report
    // `InsufficientFunds(available: int)` once per parameter that happens to name the enum, which
    // is double-counting dressed as completeness. The enum-payload population is NOT missing —
    // see the `enum-payload` pass — it is counted where it is written.
    case "struct":
    case "enum":
    case "error":
      return [];

    default:
      return [];
  }
}

/**
 * The `int`-bearing payload fields of an enum's variants, as (variantName, fieldName) pairs with
 * the nesting each `integer` sits at. Reads the VariantDef list the compiler's own `parseEnumBody`
 * / `buildTypeRegistry` produced — `payload` is a `Map<fieldName, ResolvedType>` or null.
 */
function enumPayloadIntFields(
  t: ResolvedTypeLike,
): Array<{ variant: string; field: string; nesting: Nesting }> {
  const out: Array<{ variant: string; field: string; nesting: Nesting }> = [];
  for (const v of (t.variants ?? [])) {
    if (!v || !v.payload) continue;
    for (const [fname, ftype] of v.payload) {
      for (const n of integerNestings(ftype)) {
        out.push({ variant: v.name, field: fname, nesting: n === "direct" ? "enum-payload" : n });
      }
    }
  }
  return out;
}

/**
 * Is `annotation` a bare TYPE NAME (as opposed to a literal `asIs`, a compound, or empty)?
 *
 * ⚑ THIS EXISTS BECAUSE AN UNRESOLVABLE ANNOTATION IS SILENT, AND THE OLD `catch` WAS DEAD CODE.
 * `resolveTypeExpr` contains no `throw` — verified by reading it — so the `catch` that was meant
 * to count unresolvable annotations could never fire, and `annotations the resolver refused: 0`
 * was a false all-clear. What actually happens is documented by SPEC §14.1.2 / §34's
 * `E-TYPE-UNKNOWN-NAME` row: an out-of-file name "collapse[s] SILENTLY to `asIs`", and the
 * emission lives at the decl-binding sites, "NOT `resolveTypeExpr`, which is span-free".
 * So an annotation naming an IMPORTED type resolves to `asIs`, yields no nestings, and vanishes
 * from the census with nothing counted. This predicate lets that population be COUNTED, so the
 * headline figures can be honestly labelled as a floor when it is non-zero.
 */
function isBareTypeName(annotation: string): boolean {
  const t = annotation.trim();
  if (!t || t === "asIs") return false;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t);
}

/** The resolved primitive name of a type, or "" when it is not a bare primitive. */
function primitiveName(t: ResolvedTypeLike | null | undefined): string {
  return t && t.kind === "primitive" && typeof t.name === "string" ? t.name : "";
}

/**
 * The source spelling (`int` / `integer`) inside an annotation, for the free per-spelling tally.
 *
 * Not a parse — a presentation detail over an annotation string the type resolver has ALREADY
 * accepted. The TYPE question is answered structurally by `integerNestings`; this only picks which
 * of the two aliases the author typed.
 *
 * ⚑ RETURNS `"mixed"` WHEN BOTH SPELLINGS APPEAR, AND THAT MATTERS FOR WHOLE-DECL BODIES.
 * A struct / enum BODY is one string covering many fields. When it contains only ONE of the two
 * spellings, every int-bearing field in it provably uses that spelling and attributing it is
 * correct. When it contains BOTH, the per-field answer is NOT recoverable from this string — the
 * splitter that would recover it (`splitTopLevel`) is not exported — so it returns `"mixed"`
 * rather than silently attributing whichever the scan happened to hit first. An earlier draft did
 * exactly that and reported a per-spelling tally that was wrong by an unknown margin.
 */
function spellingIn(annotation: string): string {
  const words = annotation.split(/[^A-Za-z0-9_]+/);
  const hasInteger = words.includes("integer");
  const hasInt = words.includes("int");
  if (hasInteger && hasInt) return "mixed";
  if (hasInteger) return "integer";
  if (hasInt) return "int";
  return "";
}

// ---------------------------------------------------------------------------
// Generic AST walk
// ---------------------------------------------------------------------------

type AnyNode = Record<string, unknown>;

/** Depth-first walk over every object in the AST, cycle-safe. */
function walkAst(root: unknown, visit: (n: AnyNode) => void): void {
  const seen = new WeakSet<object>();
  const go = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    if (seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) { for (const item of v) go(item); return; }
    const n = v as AnyNode;
    if (typeof n.kind === "string") visit(n);
    for (const k of Object.keys(n)) { if (k === "parent") continue; go(n[k]); }
  };
  go(root);
}

const lineOf = (n: AnyNode): number => {
  const s = n.span as { line?: number } | undefined;
  return typeof s?.line === "number" ? s.line : 0;
};

/**
 * ⚑ EXPRESSION SPANS ARE SEGMENT-RELATIVE, SO `call.span.line` IS NOT A FILE LINE.
 * `expression-parser` spans are offsets into the expression FRAGMENT it was handed, and their
 * `line` restarts at 1 per fragment. Reading one as a file line yields `file.scrml:1` for every
 * call site in the corpus — a citation that is present, plausible, and wrong, which is worse than
 * an absent one. The file-absolute line comes from the nearest enclosing NON-EXPRESSION node
 * (a statement / declaration / markup node), whose span the ast-builder does anchor to the file.
 *
 * Verified against `examples/28-flux.scrml`: the `goalAxis(...)` calls carry a span, and their
 * enclosing `state-decl` spans read 41 and 42 — the lines the calls are actually on.
 */
const EXPR_KINDS = new Set([
  "lit", "ident", "call", "member", "index", "binary", "unary", "ternary", "array", "object",
  "spread", "assign", "lambda", "cast", "new", "match-expr", "map-lit", "sql-ref",
  "input-state-ref", "escape-hatch", "markup-value", "reset-expr", "template",
]);

/** The file-absolute line to cite for `n`, given the enclosing statement line carried down. */
const citeLine = (n: AnyNode, enclosing: number): number => {
  if (EXPR_KINDS.has(String(n.kind ?? ""))) return enclosing;
  const own = lineOf(n);
  return own > 0 ? own : enclosing;
};

// ---------------------------------------------------------------------------
// Per-file model
// ---------------------------------------------------------------------------

type FileModel = {
  file: string;
  ast: AnyNode;
  registry: Map<string, ResolvedTypeLike>;
  fns: Map<string, FnDecl>;
  /** local import name -> resolved absolute `.scrml` path + the exported name */
  imports: Map<string, { file: string; imported: string; kind: "import" | "stdlib" }>;
  /** cell name (no `@`) -> its declaration. File-scoped, so no scope stack is needed for `@x`. */
  stateCells: Map<string, Decl>;
};

/** Resolve an import specifier to an absolute `.scrml` path, or null. */
function resolveSpecifier(spec: string, fromFile: string): { file: string; kind: "import" | "stdlib" } | null {
  if (spec.startsWith("scrml:")) {
    const name = spec.slice("scrml:".length);
    const p = join(STDLIB_ROOT, name, "index.scrml");
    return existsSync(p) ? { file: p, kind: "stdlib" } : null;
  }
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) {
    const base = spec.startsWith("/") ? spec : resolve(dirname(fromFile), spec);
    for (const cand of [base, base + ".scrml", join(base, "index.scrml")]) {
      if (existsSync(cand) && statSync(cand).isFile()) return { file: cand, kind: "import" };
    }
  }
  return null;
}

/**
 * ⚑ REGISTRY REPAIR — and it exists because the compiler's own builder cannot see two of the
 * language's most ordinary type-decl forms.
 *
 * `buildTypeRegistry` branches on `decl.typeKind` and handles exactly `struct` / `enum` / `error`;
 * everything else hits a terminal `else` that registers `tAsIs()` "so references don't explode".
 * `ast-builder` only sets `typeKind` when the decl carries an EXPLICIT marker (`type B : struct =`),
 * so BOTH of these — the canonical forms — arrive with `typeKind: ""` and become `asIs`:
 *
 *     type Count = int          ->  typeKind ""  raw "int"          ->  registry: asIs
 *     type Point = { x: int }   ->  typeKind ""  raw "{ x : int }"  ->  registry: asIs
 *
 * REPRODUCED at this watermark, not inferred. For the census the consequence is direct: a
 * parameter written `c: Count` would resolve to `asIs` and the site would VANISH from the count —
 * a silent under-report of exactly the population the ruling depends on. So the instrument repairs
 * its own registry, using the compiler's own `resolveTypeExpr` / `parseStructBody` on the decl's
 * `raw`. No compiler behaviour is changed by this; the repair is local to the census.
 *
 * The repair count is REPORTED (`aliasRepairs` / `structRepairs`) rather than absorbed, because
 * "how much of the corpus does the registry builder currently not see" is itself a finding.
 * Iterates so a chained alias (`type A = int` / `type B = A`) settles.
 */
type RepairCounters = {
  aliasRepairs: number; structRepairs: number; enumRepairs: number;
  registryBuildFailures: number; duplicateFnNames: number;
};
const freshRepairCounters = (): RepairCounters =>
  ({ aliasRepairs: 0, structRepairs: 0, enumRepairs: 0, registryBuildFailures: 0, duplicateFnNames: 0 });

function repairRegistry(
  registry: Map<string, ResolvedTypeLike>,
  typeDecls: AnyNode[],
  counters: RepairCounters,
): void {
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const decl of typeDecls) {
      const name = typeof decl?.name === "string" ? decl.name : "";
      const raw = typeof decl?.raw === "string" ? decl.raw.trim() : "";
      if (!name || !raw) continue;
      const current = registry.get(name);
      if (!current || current.kind !== "asIs") continue; // only repair the fallthrough
      if (raw.startsWith("{")) {
        let fields: Map<string, ResolvedTypeLike> | null = null;
        try { fields = parseStructBody(raw, registry as never) as Map<string, ResolvedTypeLike>; } catch { fields = null; }
        if (fields && fields.size > 0) {
          registry.set(name, { kind: "struct", name, fields } as unknown as ResolvedTypeLike);
          // Counted on EVERY pass, not just pass 0. The fixpoint means a decl can only be repaired
          // once (the `kind !== "asIs"` guard above rejects it thereafter), so a pass-0-only count
          // was not a de-dupe — it simply DISCARDED every repair a later pass made, and printed a
          // floor while reading like a count.
          counters.structRepairs++;
          changed = true;
          continue;
        }
        // Zero struct fields on a brace body: it is an ENUM. Repair it as one, so a no-marker
        // `type E = enum { V(n: int) }` is not left as `asIs` and invisible.
        try {
          const parsed = parseEnumBody(raw, registry as never, [], undefined, name) as
            { variants?: Array<{ name: string; payload: Map<string, ResolvedTypeLike> | null }> };
          if (!parsed?.variants?.length) continue;
          registry.set(name, { kind: "enum", name, variants: parsed.variants } as ResolvedTypeLike);
          counters.enumRepairs++;
          changed = true;
        } catch { continue; }
      } else {
        let t: ResolvedTypeLike;
        try { t = resolveTypeExpr(raw, registry as never) as ResolvedTypeLike; } catch { continue; }
        if (!t || t.kind === "asIs" || t.kind === "unknown") continue;
        registry.set(name, t);
        counters.aliasRepairs++;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function buildFileModel(
  file: string,
  ast: AnyNode,
  repairCounters: RepairCounters = freshRepairCounters(),
): FileModel {
  const fileSpan = { file, start: 0, end: 0, line: 1, col: 1 };
  let registry: Map<string, ResolvedTypeLike>;
  try {
    registry = buildTypeRegistry((ast.typeDecls as AnyNode[]) ?? [], [], fileSpan) as Map<string, ResolvedTypeLike>;
  } catch {
    // ⚑ SEEDED WITH `BUILTIN_TYPES`, NOT EMPTY, AND COUNTED.
    // An earlier draft fell back to `new Map()`. That is not a degraded registry, it is a BROKEN
    // one: with no builtins seeded, `resolveTypeExpr("int", …)` cannot resolve, so every
    // annotation in the file silently stops being an int and the file drops out of the census
    // with nothing reported. `BUILTIN_TYPES` is exported precisely so a fallback can be honest.
    registry = new Map(BUILTIN_TYPES as unknown as Map<string, ResolvedTypeLike>);
    repairCounters.registryBuildFailures++;
  }
  repairRegistry(registry, (ast.typeDecls as AnyNode[]) ?? [], repairCounters);

  const fns = new Map<string, FnDecl>();
  const stateCells = new Map<string, Decl>();
  walkAst(ast, (n) => {
    if (n.kind === "function-decl" && typeof n.name === "string") {
      const rawParams = Array.isArray(n.params) ? n.params : [];
      // `m.fns` is name-keyed, so a second `fn` of the same name in one file overwrites the first
      // and its call sites are then attributed to the wrong signature. Counted so the condition is
      // visible; not resolved, because picking a winner would need real scoping the census lacks.
      if (fns.has(n.name)) repairCounters.duplicateFnNames++;
      fns.set(n.name, {
        name: n.name,
        file,
        line: lineOf(n),
        fnKind: typeof n.fnKind === "string" ? n.fnKind : "fn",
        isServer: n.isServer === true,
        returnAnnotation: typeof n.returnTypeAnnotation === "string" ? n.returnTypeAnnotation : "",
        params: rawParams.map((p: unknown) => {
          if (typeof p === "string") return { name: p, annotation: "" };
          const po = (p ?? {}) as AnyNode;
          return {
            name: typeof po.name === "string" ? po.name : "",
            annotation: typeof po.typeAnnotation === "string" ? po.typeAnnotation : "",
          };
        }),
      });
    }
    // ⚑ Recorded whether or not it is ANNOTATED. An unannotated cell still has an initializer, and
    // that initializer is what today's inference types — dropping the unannotated ones here is
    // exactly the under-report tier 2 of `classifyArg` exists to prevent.
    if (n.kind === "state-decl" && typeof n.name === "string") {
      stateCells.set(String(n.name).replace(/^@/, ""), {
        annotation: typeof n.typeAnnotation === "string" ? n.typeAnnotation : "",
        init: (n.initExpr ?? null) as AnyNode | null,
      });
    }
  });

  const imports = new Map<string, { file: string; imported: string; kind: "import" | "stdlib" }>();
  for (const imp of ((ast.imports as AnyNode[]) ?? [])) {
    const source = typeof imp?.source === "string" ? imp.source : "";
    if (!source) continue;
    const hit = resolveSpecifier(source, file);
    if (!hit) continue;
    const specs = Array.isArray(imp.specifiers) ? imp.specifiers : [];
    for (const s of specs) {
      const so = (s ?? {}) as AnyNode;
      const local = typeof so.local === "string" ? so.local : (typeof so.imported === "string" ? so.imported : "");
      const imported = typeof so.imported === "string" ? so.imported : local;
      if (local) imports.set(local, { file: hit.file, imported, kind: hit.kind });
    }
  }

  return { file, ast, registry, fns, imports, stateCells };
}

// ---------------------------------------------------------------------------
// Q1 — annotation positions
// ---------------------------------------------------------------------------

/** Map an owning node kind to the census's position bucket. */
function positionFor(n: AnyNode): Position {
  switch (n.kind) {
    case "state-decl": return "state-cell";
    case "let-decl":
    case "const-decl": return "let-const-decl";
    default: return `other:${String(n.kind)}`;
  }
}

function collectAnnotationSites(
  m: FileModel,
  rel: string,
  out: AnnotationSite[],
  counters: Counters,
  unresolvedNames: Set<string> = new Set(),
): void {
  const push = (position: Position, owner: string, annotation: string, line: number): void => {
    counters.annotationSitesSeen++;
    let t: ResolvedTypeLike;
    // `resolveTypeExpr` has no `throw` in it; this catch is defence-in-depth, NOT the mechanism
    // that counts unresolvable annotations. That mechanism is the `asIs`-named check below.
    try { t = resolveTypeExpr(annotation, m.registry as never) as ResolvedTypeLike; }
    catch { counters.annotationSitesUnresolvable++; return; }
    if (t && t.kind === "asIs" && isBareTypeName(annotation)) {
      counters.annotationSitesAsIsNamed++;
      unresolvedNames.add(annotation.trim());
    }
    const nestings = integerNestings(t);
    if (nestings.length === 0) return;
    counters.annotationSitesWithInt++;
    for (const nesting of nestings) {
      out.push({
        file: rel, line, lineKind: "exact", position, nesting,
        spelling: spellingIn(annotation), owner, annotation,
      });
    }
  };

  // (1) fn/function params + return types — reached from the fn index, not a second walk.
  for (const fn of m.fns.values()) {
    for (const p of fn.params) if (p.annotation) push("fn-param", `${fn.name}(${p.name})`, p.annotation, fn.line);
    if (fn.returnAnnotation) push("fn-return", fn.name, fn.returnAnnotation, fn.line);
  }

  // (2) BRACE-BODIED TYPE DECLARATIONS — struct/error/tuple FIELDS and enum VARIANT PAYLOADS.
  //
  // ⚑ AN ENUM BODY IS NOT A STRUCT BODY, AND CONFLATING THEM COST A WHOLE POSITION KIND.
  // An earlier draft ran only `parseStructBody` here and incremented `structBodiesParsed` on its
  // result unconditionally. `parseStructBody` on an enum raw returns an EMPTY map — it looks for
  // `name: type` pairs and an enum body has `Variant(field: type)` — so every enum in the corpus
  // was counted as a SUCCESSFULLY PARSED STRUCT WITH NOTHING IN IT. The `N of M` pair read
  // `900 of 900`, perfect, while `enum-payload` contributed zero sites to the population. That is
  // this file's own anti-truncation invariant defeated in the one way it can be: not by dropping a
  // count, but by a clean all-clear over a silently narrowed population.
  //
  // So: a zero-field struct parse is now a REPORTED condition, the enum route is tried on exactly
  // those bodies, and the two body kinds are counted separately.
  //
  // Neither parse is gated on `typeKind`: the canonical no-marker forms (`type A = { x: int }`,
  // `type E = enum { ... }`) carry `typeKind: ""`, so gating would drop them.
  for (const decl of ((m.ast.typeDecls as AnyNode[]) ?? [])) {
    const raw = typeof decl?.raw === "string" ? decl.raw : "";
    if (!raw.trim().startsWith("{")) continue;
    const declName = String(decl.name ?? "<anon>");
    const declLine = lineOf(decl);
    // Per-field spelling is not recoverable from a whole body (see `spellingIn`); when the body
    // mixes both aliases this is "mixed" rather than a wrong guess.
    const bodySpelling = spellingIn(raw);

    const emit = (position: Position, owner: string, nesting: Nesting): void => {
      out.push({
        file: rel, line: declLine, lineKind: "decl-head", position, nesting,
        spelling: bodySpelling, owner, annotation: owner,
      });
    };

    let fields: Map<string, ResolvedTypeLike> | null = null;
    try { fields = parseStructBody(raw, m.registry as never) as Map<string, ResolvedTypeLike>; }
    catch { counters.structBodiesUnparsed++; }

    if (fields && fields.size > 0) {
      counters.structBodiesParsed++;
      for (const [fname, ftype] of fields) {
        counters.annotationSitesSeen++;
        const nestings = integerNestings(ftype);
        if (nestings.length === 0) continue;
        counters.annotationSitesWithInt++;
        for (const nesting of nestings) emit("struct-field", `${declName}.${fname}`, nesting);
      }
      continue;
    }

    // Zero struct fields on a brace body. REPORTED — and then tried as an enum, which is what it
    // almost always is. Prefer the registry's already-built EnumType; fall back to a direct
    // `parseEnumBody` for the no-marker form that `buildTypeRegistry` leaves as `asIs`.
    if (fields) counters.braceBodiesZeroField++;

    let variants: ResolvedTypeLike | null = null;
    const fromRegistry = m.registry.get(declName);
    if (fromRegistry && fromRegistry.kind === "enum") {
      variants = fromRegistry;
    } else {
      try {
        const parsed = parseEnumBody(raw, m.registry as never, [], { file: m.file, start: 0, end: 0, line: declLine, col: 1 }, declName) as
          { variants?: Array<{ name: string; payload: Map<string, ResolvedTypeLike> | null }> };
        if (parsed?.variants?.length) variants = { kind: "enum", name: declName, variants: parsed.variants };
      } catch { counters.enumBodiesUnparsed++; continue; }
    }
    if (!variants) continue;
    counters.enumBodiesParsed++;

    // ⚑ EVERY payload field is an annotation POSITION (SPEC §14.1.1 names
    // "enum-variant-payload" in its own loci list, alongside struct field and fn param), so each
    // one counts toward `annotationSitesSeen` whether or not it is an int.
    for (const v of (variants.variants ?? [])) {
      if (!v?.payload) continue;
      for (const _f of v.payload.keys()) counters.annotationSitesSeen++;
    }
    for (const hit of enumPayloadIntFields(variants)) {
      counters.annotationSitesWithInt++;
      emit("enum-payload", `${declName}.${hit.variant}(${hit.field})`, hit.nesting);
    }
  }

  // (3) every other `typeAnnotation`-bearing node — state cells, let/const, and anything this
  // census did not anticipate, which lands in `other:<kind>` rather than being dropped.
  walkAst(m.ast, (n) => {
    if (n.kind === "function-decl") return;              // handled above, per-param
    if (typeof n.typeAnnotation !== "string" || !n.typeAnnotation) return;
    push(positionFor(n), typeof n.name === "string" ? n.name : "<anon>", n.typeAnnotation, lineOf(n));
  });

  // (4) `<schema>` table columns, via the compiler's own `parseSchemaBlock`. Schema column types
  // are the SQL vocabulary, a DIFFERENT namespace from §7.5 annotations — bucketed separately so
  // they are visible without being conflated into the §7.5.1 population.
  walkAst(m.ast, (n) => {
    if (n.kind !== "state" || n.stateType !== "schema") return;
    let body = "";
    walkAst(n.children, (c) => { if (c.kind === "text" && typeof c.value === "string") body += c.value; });
    if (!body.trim()) return;
    let parsed: { tables?: Array<{ name?: string; columns?: Array<{ name?: string; scrmlType?: string }> }> };
    try { parsed = parseSchemaBlock(body) as typeof parsed; }
    catch { counters.schemaBlocksUnparsed++; return; }
    counters.schemaBlocksParsed++;
    for (const table of parsed.tables ?? []) {
      for (const col of table.columns ?? []) {
        counters.annotationSitesSeen++;
        const st = String(col.scrmlType ?? "").toLowerCase();
        if (!INT_SPELLINGS.has(st)) continue;
        counters.annotationSitesWithInt++;
        out.push({
          // `parseSchemaBlock` returns columns without source positions, so this is the `<schema>`
          // block's own line, labelled as such rather than impersonating the column's line.
          file: rel, line: lineOf(n), lineKind: "decl-head",
          position: "schema-column", nesting: "direct",
          spelling: st, owner: `${String(table.name)}.${String(col.name)}`, annotation: st,
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Q2/Q3/Q4 — call sites, over a real lexical scope stack
// ---------------------------------------------------------------------------

/**
 * What a name's declaration told us. `annotation` is the declared type text (may be ""); `init` is
 * the initializer expression node (may be null). BOTH are carried because the resolution cascade is
 * two-tier: an annotation is authoritative, and where there is none the DECL-SITE INITIALIZER is
 * what today's inference has to work with. `<cols> = 15` carries no annotation and is still a
 * `number` — and 44 of this corpus's int-param arguments are exactly that shape, so a census that
 * stopped at "unannotated" would under-report the blast radius by a third.
 */
type Decl = { annotation: string; init: AnyNode | null };
type Scope = Map<string, Decl>;

/**
 * Resolve an identifier's declaration: innermost lexical scope outward, then file-level state cells.
 *
 * ⚑ THE `@` STRIP APPLIES TO THE STATE-CELL LOOKUP ONLY, AND THAT IS THE WHOLE POINT.
 * `@cell` and `cell` are DISTINCT bindings in scrml. An earlier draft searched lexical scopes with
 * `get(name) ?? get(bare)`, so a `let cell: string` in scope would answer a read of `@cell` — a
 * local shadowing a state cell it has no relationship to, and reporting the local's type for the
 * cell's value. Only `stateCells` is keyed bare (its own decl names are stored with the sigil
 * stripped), so only it gets the stripped key.
 */
function lookupDecl(name: string, scopes: Scope[], stateCells: Map<string, Decl>): Decl | null {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const hit = scopes[i].get(name);
    if (hit !== undefined) return hit;
  }
  // A `@`-sigilled read resolves ONLY against state cells; a bare read resolves against them too
  // (a bare cell read is legal in several positions) but never the other way around.
  return stateCells.get(name.replace(/^@/, "")) ?? null;
}

/**
 * The compiler's OWN inference, run on an expression node. Returns the resolved PRIMITIVE name, or
 * "" when inference is defeated.
 *
 * ⚑ THIS IS WHAT MAKES THE "PROVABLE" READING A MEASUREMENT RATHER THAN AN OPINION.
 * §7.5.1's sentence is about "turning on argument assignability with TODAY'S INFERENCE", and
 * `inferExprType` IS today's inference — the same function the position-1/2 checks consult. It
 * types the four literal forms plus a signed numeric literal, and returns a NAMED GAP for
 * `ident` / `binary` / `call` / `member` / everything else. Asking it directly means this census
 * cannot drift from the compiler's real capability by re-implementing a guess at it.
 */
function inferredPrimitive(node: AnyNode | null | undefined): string {
  if (!node || typeof node !== "object") return "";
  let r: { ok?: boolean; type?: ResolvedTypeLike };
  try { r = inferExprType(node as never) as typeof r; } catch { return ""; }
  return r?.ok === true ? primitiveName(r.type) : "";
}

type ArgClass = { bucket: ArgBucket; provable: boolean; argType: string; argKind: string; calleeReturns?: string };

/** Classify one argument expression. Every branch terminates in a NAMED bucket — nothing falls through. */
function classifyArg(
  arg: AnyNode | null | undefined,
  scopes: Scope[],
  m: FileModel,
  /** Resolves a callee NAME to the primitive its declaration says it returns ("" if unknown). */
  calleeReturnPrim: (name: string) => string = () => "",
): ArgClass {
  if (!arg || typeof arg !== "object") return { bucket: "other:missing", provable: false, argType: "", argKind: "" };
  const kind = String(arg.kind ?? "");

  if (kind === "lit") {
    const litType = String(arg.litType ?? "");
    if (litType === "number") {
      const v = arg.value;
      const integral = typeof v === "number" && Number.isInteger(v);
      // GCP3 (§45): the numeric literal's RESOLVED type is `number`, integral or not — confirmed
      // against `inferExprType`'s own `lit` arm rather than assumed.
      return {
        bucket: integral ? "integral-literal" : "fractional-literal",
        provable: true, argType: inferredPrimitive(arg) || "number", argKind: kind,
      };
    }
    // `not` is §42 absence. Its provability follows `inferExprType` like every other form rather
    // than being hardcoded — `inferExprType`'s own `lit` arm names `not` as a GAP, so asserting
    // `provable: true` here contradicted this file's stated definition of PROVABLE. Latent (zero
    // corpus occurrences at an int param), fixed so it cannot become live silently.
    if (litType === "not") {
      const notPrim = inferredPrimitive(arg);
      return { bucket: "not-literal", provable: notPrim !== "", argType: notPrim || "not", argKind: kind };
    }
    const inferred = inferredPrimitive(arg);
    return {
      bucket: `non-numeric-literal:${litType}`,
      provable: inferred !== "", argType: inferred, argKind: kind,
    };
  }

  // A signed numeric literal (`-7`, `+3`) is ONE literal to an author and must not land in `other`.
  // `inferExprType` types the `-` form and NOT the `+` form; the bucket follows what the author
  // wrote, `provable` follows what the compiler can actually prove. Keeping those two axes apart
  // is the point — collapsing them is how a census starts reporting its own opinion.
  if (kind === "unary" && (arg.op === "-" || arg.op === "+")) {
    const inner = arg.argument as AnyNode | undefined;
    if (inner && inner.kind === "lit" && inner.litType === "number") {
      const v = inner.value;
      const integral = typeof v === "number" && Number.isInteger(v);
      const inferred = inferredPrimitive(arg);
      return {
        bucket: integral ? "integral-literal" : "fractional-literal",
        provable: inferred !== "", argType: inferred, argKind: `${kind}${String(arg.op)}`,
      };
    }
    return { bucket: `other:${kind}`, provable: false, argType: "", argKind: kind };
  }

  if (kind === "ident") {
    const decl = lookupDecl(String(arg.name ?? ""), scopes, m.stateCells);

    // Tier 1 — a DECLARED annotation is authoritative.
    if (decl?.annotation) {
      let t: ResolvedTypeLike | null = null;
      try { t = resolveTypeExpr(decl.annotation, m.registry as never) as ResolvedTypeLike; } catch { t = null; }
      const prim = t ? primitiveName(t) : "";
      if (prim === "integer") return { bucket: "int-annotated", provable: true, argType: "integer", argKind: kind };
      if (prim === "number") return { bucket: "number-annotated", provable: true, argType: "number", argKind: kind };
      if (prim) return { bucket: `other-annotated:${prim}`, provable: true, argType: prim, argKind: kind };
      if (t) return { bucket: `other-annotated:${t.kind}`, provable: false, argType: t.kind, argKind: kind };
    }

    // Tier 2 — NO annotation, but the DECL-SITE INITIALIZER is something today's inference can
    // type. This tier is not an embellishment: `<cols> = 15` is unannotated and is provably a
    // `number`, and a position-3 widening WOULD reject `f(@cols)` for an `int` param. Stopping at
    // "unannotated" would silently move those sites out of the rejection set.
    const initPrim = inferredPrimitive(decl?.init ?? null);
    if (initPrim === "integer") return { bucket: "inferred-int", provable: true, argType: "integer", argKind: kind };
    if (initPrim) return { bucket: `inferred-${initPrim}`, provable: true, argType: initPrim, argKind: kind };

    // Tier 3 — nothing to go on. `W-TYPE-031-UNPROVEN` territory.
    return { bucket: "unannotated", provable: false, argType: "", argKind: kind };
  }

  // Everything else — hand it to the compiler's own inference rather than guessing. Today that
  // gaps on every compound form (`binary`, `call`, `member`, `index`, `ternary`, …), which is
  // exactly why positions 3-5 are not checked; if inference later grows, this census grows with it
  // for free instead of needing to be rewritten.
  const inferred = inferredPrimitive(arg);
  if (inferred) return { bucket: `inferred-${inferred}`, provable: true, argType: inferred, argKind: kind };

  // Inference gapped. For a CALL, record what the callee DECLARES it returns — not as a type
  // (nothing here proves the declaration), but so the "unknowable" bucket can be split into what
  // an assignability ruling must decide and what a return-type-aware inference would simply know.
  let declaredReturn = "";
  if (kind === "call") {
    const callee = arg.callee as AnyNode | undefined;
    if (callee && callee.kind === "ident" && typeof callee.name === "string") {
      declaredReturn = calleeReturnPrim(callee.name);
    }
  }
  return { bucket: `other:${kind}`, provable: false, argType: "", argKind: kind, calleeReturns: declaredReturn };
}

type Counters = {
  filesDiscovered: number;
  filesParsed: number;
  filesFailed: number;
  annotationSitesSeen: number;
  annotationSitesWithInt: number;
  annotationSitesUnresolvable: number;
  structBodiesParsed: number;
  structBodiesUnparsed: number;
  /** brace-bodied type-decls whose struct parse yielded ZERO fields — REPORTED, not a success. */
  braceBodiesZeroField: number;
  enumBodiesParsed: number;
  enumBodiesUnparsed: number;
  /** annotations whose raw text is a NAME but which resolved to `asIs` — a SILENT drop. */
  annotationSitesAsIsNamed: number;
  /** callee-side PARAM annotations with the same problem (a param typed by an imported name). */
  paramAnnotationsAsIsNamed: number;
  /** `buildTypeRegistry` threw for this file; the census fell back to BUILTIN_TYPES. */
  registryBuildFailures: number;
  /** two `fn` decls sharing a name in one file — the later one overwrote the earlier in `m.fns`. */
  duplicateFnNames: number;
  schemaBlocksParsed: number;
  schemaBlocksUnparsed: number;
  aliasRepairs: number;
  structRepairs: number;
  enumRepairs: number;
  callExprsSeen: number;
  callsCalleeNotIdent: number;
  callsUnresolvedCallee: number;
  callsResolved: number;
  argsAtIntParam: number;
  argsAtNumberParam: number;
};

/**
 * Walk a file's AST maintaining a lexical scope stack, and record every argument that reaches an
 * `int`- or `number`-annotated parameter of a resolvable callee.
 */
function collectCallSites(
  m: FileModel,
  rel: string,
  models: Map<string, FileModel>,
  intSites: CallSite[],
  numberSites: CallSite[],
  counters: Counters,
  unresolvedNames: Set<string> = new Set(),
): void {
  /** Resolve a call's callee name to a declared fn, same-file first then through imports. */
  const resolveCallee = (name: string): { fn: FnDecl; resolution: "local" | "import" | "stdlib" } | null => {
    const local = m.fns.get(name);
    if (local) return { fn: local, resolution: "local" };
    const imp = m.imports.get(name);
    if (!imp) return null;
    const target = models.get(imp.file);
    if (!target) return null;
    const fn = target.fns.get(imp.imported);
    return fn ? { fn, resolution: imp.kind } : null;
  };

  /** The primitive a named callee DECLARES it returns, resolved in the CALLEE's own registry. */
  const calleeReturnPrim = (name: string): string => {
    const hit = resolveCallee(name);
    if (!hit || !hit.fn.returnAnnotation) return "";
    const cm = models.get(hit.fn.file) ?? m;
    try { return primitiveName(resolveTypeExpr(hit.fn.returnAnnotation, cm.registry as never) as ResolvedTypeLike); }
    catch { return ""; }
  };

  const record = (call: AnyNode, fn: FnDecl, resolution: "local" | "import" | "stdlib", scopes: Scope[], line: number): void => {
    const args = Array.isArray(call.args) ? (call.args as AnyNode[]) : [];
    // ⚑ The PARAMETER's annotation is resolved against the CALLEE's registry, not the caller's.
    // They differ the moment a callee names a file-local alias (`type Count = int`): resolving
    // `Count` in the caller's registry yields `asIs` and the site vanishes. Harmless for the bare
    // primitives, silently lossy for everything else — so it is done correctly rather than
    // conveniently. The ARGUMENT keeps using the caller's registry, which is where it lives.
    const calleeModel = models.get(fn.file) ?? m;
    fn.params.forEach((p, i) => {
      if (!p.annotation) return;
      let t: ResolvedTypeLike;
      try { t = resolveTypeExpr(p.annotation, calleeModel.registry as never) as ResolvedTypeLike; } catch { return; }
      // The SAME silent swallow as the annotation side: a parameter typed by an IMPORTED or
      // otherwise out-of-file name resolves to `asIs`, is neither `integer` nor `number`, and the
      // call site drops out with nothing counted. Count it, so Q2/Q3/Q4 can be labelled a FLOOR
      // when it is non-zero instead of reading as complete.
      if (t && t.kind === "asIs" && isBareTypeName(p.annotation)) {
        counters.paramAnnotationsAsIsNamed++;
        unresolvedNames.add(p.annotation.trim());
      }
      const prim = primitiveName(t);
      if (prim !== "integer" && prim !== "number") return;
      if (i >= args.length) return; // arity shortfall — not this census's question
      const cls = classifyArg(args[i], scopes, m, calleeReturnPrim);
      const site: CallSite = {
        file: rel, line, callee: fn.name,
        calleeFile: relative(REPO_ROOT, fn.file), resolution,
        paramName: p.name, paramIndex: i, paramAnnotation: p.annotation,
        bucket: cls.bucket, provable: cls.provable, argType: cls.argType, argKind: cls.argKind,
        calleeReturns: cls.calleeReturns ?? "",
      };
      if (prim === "integer") { counters.argsAtIntParam++; intSites.push(site); }
      else { counters.argsAtNumberParam++; numberSites.push(site); }
    });
  };

  const seen = new WeakSet<object>();

  const go = (v: unknown, scopes: Scope[], encl: number): void => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const item of v) go(item, scopes, encl); return; }
    if (seen.has(v as object)) return;
    seen.add(v as object);
    const n = v as AnyNode;
    const kind = String(n.kind ?? "");
    const line = citeLine(n, encl);

    // A `function-decl` opens a scope carrying its own parameters.
    //
    // ⚑ IT MUST NOT SHORT-CIRCUIT THE BODY WALK BELOW, AND AN EARLIER DRAFT DID.
    // That draft descended into the fn body through the generic key loop, which walks the body
    // ARRAY without registering its `let`/`const` declarations — so every annotated local inside
    // every function was invisible. Caught by spot-checking `compiler/self-host-v2/lex.scrml:115`
    // against source: `isLineFeed(code)` was reported `unannotated` while line 114 plainly reads
    // `const code: int = peekCode(c, 0)`. The param scope is now COMPOSED with the ordered body
    // walk rather than replacing it.
    let here = scopes;
    if (kind === "function-decl") {
      const s: Scope = new Map();
      const fn = m.fns.get(String(n.name ?? ""));
      for (const p of fn?.params ?? []) if (p.name) s.set(p.name, { annotation: p.annotation, init: null });
      here = [...scopes, s];
    }

    // A call: record it BEFORE descending, so a nested call's args are classified in the same scope.
    if (kind === "call") {
      counters.callExprsSeen++;
      const callee = n.callee as AnyNode | undefined;
      if (!callee || callee.kind !== "ident" || typeof callee.name !== "string") {
        counters.callsCalleeNotIdent++;
      } else {
        const hit = resolveCallee(callee.name);
        if (!hit) counters.callsUnresolvedCallee++;
        else { counters.callsResolved++; record(n, hit.fn, hit.resolution, here, line); }
      }
    }

    // A node with an ordered statement `body` opens a block scope; `let`/`const` become visible to
    // their FOLLOWING siblings, which is what lexical scope actually means.
    if (Array.isArray(n.body)) {
      const s: Scope = new Map();
      const inner = [...here, s];
      for (const stmt of n.body as AnyNode[]) {
        go(stmt, inner, line);
        if (stmt && (stmt.kind === "let-decl" || stmt.kind === "const-decl") && typeof stmt.name === "string") {
          s.set(stmt.name, {
            annotation: typeof stmt.typeAnnotation === "string" ? stmt.typeAnnotation : "",
            init: (stmt.initExpr ?? null) as AnyNode | null,
          });
        }
      }
      for (const k of Object.keys(n)) { if (k === "parent" || k === "body" || k === "params") continue; go(n[k], inner, line); }
      return;
    }

    for (const k of Object.keys(n)) { if (k === "parent" || (kind === "function-decl" && k === "params")) continue; go(n[k], here, line); }
  };

  go(m.ast, [], 0);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const tally = <T>(rows: T[], key: (r: T) => string): Array<[string, number]> => {
  const map = new Map<string, number>();
  for (const r of rows) map.set(key(r), (map.get(key(r)) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

// ---------------------------------------------------------------------------
// --selftest — the classifiers, against a fixture whose answers are known by hand
// ---------------------------------------------------------------------------

const SELFTEST_SOURCE = `type Shape = {
  a: int
  b: number
  c: int[]
  d: [int: string]
}

type Ev : enum = {
  Idle
  DeltaSince(seq: int)
  Range(lo: int, hi: number)
}

fn takesInt(n: int) -> int = n
fn takesNumber(v: number) -> number = v
fn takesForeign(u: NotDeclaredAnywhere) -> int = 1

fn localScope(seed: int) -> int {
  const derived: int = seed
  if (seed > 0) {
    takesInt(derived)
  }
  return derived
}

<state>
  <cell>: int = 0
  <bare> = 15
</state>

<program>
  \${
    let li: int = 1
    const cn: number = 2
    let cell: string = "shadow"
    takesInt(1)
    takesInt(-7)
    takesInt(1.5)
    takesInt(li)
    takesInt(cn)
    takesInt(@cell)
    takesInt("s")
    takesInt(takesInt(2))
    takesInt(@bare)
    takesNumber(li)
    takesNumber(@cell)
    takesNumber(1)
  }
</program>
<page><main><p>x</p></main></page>
`;

/**
 * The CROSS-FILE half of the selftest. The whole-corpus run reports ZERO import-resolved callee
 * sites, and a zero from an unexercised code path is indistinguishable from a zero that is true —
 * so the path is proven here. `lib.scrml` declares an int-param fn behind a file-LOCAL type alias
 * (`type Count = int`), which also pins the registry choice: resolving `Count` against the
 * CALLER's registry yields `asIs` and the site disappears.
 */
const SELFTEST_LIB = `type Count = int

export fn bump(c: Count) -> Count = c
export fn plain(n: int) -> int = n
`;
const SELFTEST_CONSUMER = `import { bump, plain } from "./lib.scrml"

<program>
  \${
    bump(5)
    plain(6)
  }
</program>
<page><main><p>x</p></main></page>
`;

function runSelftest(): number {
  const dir = mkdtempSync(join(tmpdir(), "scrml-int-census-"));
  const file = join(dir, "selftest.scrml");
  const libFile = join(dir, "lib.scrml");
  const consumerFile = join(dir, "consumer.scrml");
  writeFileSync(file, SELFTEST_SOURCE, "utf8");
  writeFileSync(libFile, SELFTEST_LIB, "utf8");
  writeFileSync(consumerFile, SELFTEST_CONSUMER, "utf8");
  try {
    const { ast } = runTAB(runBlockSplitter({ filePath: file, source: SELFTEST_SOURCE })) as { ast: AnyNode };
    const selfRepair = { aliasRepairs: 0, structRepairs: 0 };
    const m = buildFileModel(file, ast, selfRepair);
    const models = new Map([[file, m]]);
    const counters = freshCounters();
    const anns: AnnotationSite[] = [];
    const selfUnresolved = new Set<string>();
    collectAnnotationSites(m, "selftest.scrml", anns, counters, selfUnresolved);
    const intSites: CallSite[] = [], numberSites: CallSite[] = [];
    collectCallSites(m, "selftest.scrml", models, intSites, numberSites, counters);

    // --- cross-file leg -----------------------------------------------------
    const libAst = runTAB(runBlockSplitter({ filePath: libFile, source: SELFTEST_LIB })).ast as AnyNode;
    const conAst = runTAB(runBlockSplitter({ filePath: consumerFile, source: SELFTEST_CONSUMER })).ast as AnyNode;
    const xRepair = { aliasRepairs: 0, structRepairs: 0 };
    const libM = buildFileModel(libFile, libAst, xRepair);
    const conM = buildFileModel(consumerFile, conAst, xRepair);
    const xModels = new Map([[libFile, libM], [consumerFile, conM]]);
    const xCounters = freshCounters();
    const xInt: CallSite[] = [], xNum: CallSite[] = [];
    collectCallSites(conM, "consumer.scrml", xModels, xInt, xNum, xCounters);

    const annBy = (p: string, nest?: string) =>
      anns.filter((a) => a.position === p && (nest === undefined || a.nesting === nest)).length;
    const intBy = (b: string) => intSites.filter((s) => s.bucket === b).length;
    const numBy = (b: string) => numberSites.filter((s) => s.bucket === b).length;

    const checks: Array<[string, boolean, string]> = [
      ["struct field `a: int` -> struct-field/direct", annBy("struct-field", "direct") === 1, String(annBy("struct-field", "direct"))],
      ["struct field `c: int[]` -> array-element", annBy("struct-field", "array-element") === 1, String(annBy("struct-field", "array-element"))],
      ["struct field `d: [int: string]` -> map-key", annBy("struct-field", "map-key") === 1, String(annBy("struct-field", "map-key"))],
      ["fn params `takesInt(n: int)` + `localScope(seed: int)` -> fn-param x2", annBy("fn-param") === 2, String(annBy("fn-param"))],
      ["fn returns `takesInt` + `localScope` + `takesForeign` -> fn-return x3", annBy("fn-return") === 3, String(annBy("fn-return"))],
      ["state cell `<cell>: int` -> state-cell x1", annBy("state-cell") === 1, String(annBy("state-cell"))],
      ["`let li: int` + in-fn `const derived: int` -> let-const-decl x2", annBy("let-const-decl") === 2, String(annBy("let-const-decl"))],
      // THREE, not two: `takesInt(1)`, the signed `takesInt(-7)`, and the INNER `takesInt(2)` of
      // the nested call. The nested inner call is a real int-param site and must not be swallowed
      // by its enclosing one — this assertion is here because the first draft expected two.
      ["`takesInt(1)` + `(-7)` + nested inner `(2)` -> integral-literal x3", intBy("integral-literal") === 3, String(intBy("integral-literal"))],
      ["`takesInt(-7)` counts as integral-literal (signed)", intSites.some((s) => s.argKind === "unary-"), "argKind"],
      ["`takesInt(1.5)` -> fractional-literal x1", intBy("fractional-literal") === 1, String(intBy("fractional-literal"))],
      // THREE int-annotated: the two top-level reads plus `takesInt(derived)` from INSIDE an if
      // branch inside a fn body. That third one is the regression anchor for the fn-body scope bug.
      ["`takesInt(li)` / `(@cell)` / nested-in-fn `(derived)` -> int-annotated x3", intBy("int-annotated") === 3, String(intBy("int-annotated"))],
      ["an annotated `const` inside a fn body is visible to a NESTED read", intSites.some((s2) => s2.callee === "takesInt" && s2.bucket === "int-annotated"), "no"],
      ["`takesInt(cn)` -> number-annotated x1", intBy("number-annotated") === 1, String(intBy("number-annotated"))],
      ["`takesInt(\"s\")` -> non-numeric-literal:string", intBy("non-numeric-literal:string") === 1, String(intBy("non-numeric-literal:string"))],
      ["`takesInt(takesInt(2))` -> other:call x1", intBy("other:call") === 1, String(intBy("other:call"))],
      ["REVERSE: 2 int-typed args reach a number param", numBy("int-annotated") === 2, String(numBy("int-annotated"))],
      ["REVERSE: the `number` param also sees 1 integral literal", numBy("integral-literal") === 1, String(numBy("integral-literal"))],
      // TIER 2 — an UNANNOTATED cell whose initializer today's inference CAN type. `<bare> = 15`
      // must land in `inferred-number` and count as PROVABLE, i.e. as a real rejection. Landing it
      // in `unannotated` would under-report the blast radius by a third of this corpus.
      ["`takesInt(@bare)` where `<bare> = 15` -> inferred-number", intBy("inferred-number") === 1, String(intBy("inferred-number"))],
      ["that tier-2 site is PROVABLE (it is a real rejection)", intSites.some((s2) => s2.bucket === "inferred-number" && s2.provable), "not provable"],
      ["`<bare> = 15` is NOT counted as an int ANNOTATION site", annBy("state-cell") === 1, String(annBy("state-cell"))],
      ["every int-param arg is classified (N of M)", counters.argsAtIntParam === intSites.length, `${counters.argsAtIntParam}/${intSites.length}`],

      // ── REGRESSION ANCHORS, one per HIGH from the S239 adversarial pass ──────────────────
      // Each of these passed a GREEN selftest before the finding. They exist so the next
      // omission of this species fails a check instead of arriving as a clean all-clear.

      // HIGH 1 — enum-variant payloads are an annotation POSITION (SPEC §14.1.1 loci list).
      // `DeltaSince(seq: int)` + `Range(lo: int, …)` = 2 int payload fields; `hi: number` is not.
      ["HIGH1: enum variant payloads bucket as `enum-payload` x2", annBy("enum-payload") === 2, String(annBy("enum-payload"))],
      ["HIGH1: their nesting is `enum-payload`, not `direct`", annBy("enum-payload", "enum-payload") === 2, String(annBy("enum-payload", "enum-payload"))],

      // HIGH 2 — an enum body must NOT be counted as a successfully parsed STRUCT body. The old
      // code did exactly that (parseStructBody returns an empty map for an enum raw), so the
      // `N of M` read perfect while a whole position kind contributed nothing.
      ["HIGH2: the enum body is counted as an ENUM body, not a struct body", counters.enumBodiesParsed === 1, String(counters.enumBodiesParsed)],
      ["HIGH2: exactly one brace body had zero struct fields, and it is REPORTED", counters.braceBodiesZeroField === 1, String(counters.braceBodiesZeroField)],
      ["HIGH2: the struct body is still counted (1, not 2)", counters.structBodiesParsed === 1, String(counters.structBodiesParsed)],

      // HIGH 3 — an annotation naming an out-of-file type collapses to `asIs` SILENTLY.
      // `takesForeign(u: NotDeclaredAnywhere)` must be COUNTED, not vanish. `resolveTypeExpr`
      // never throws, so the old `catch`-based counter was structurally dead and reported 0.
      ["HIGH3: an unresolvable NAMED annotation is counted, not swallowed", counters.annotationSitesAsIsNamed >= 1, String(counters.annotationSitesAsIsNamed)],
      ["HIGH3: the offending type name is captured for the report", selfUnresolved.has("NotDeclaredAnywhere"), [...selfUnresolved].join(",") || "<empty>"],
      ["HIGH3: the dead `resolver refused` counter stays 0 (it is not the mechanism)", counters.annotationSitesUnresolvable === 0, String(counters.annotationSitesUnresolvable)],

      // HIGH 4 — `@cell` and `cell` are DISTINCT bindings. A `let cell: string` is in scope at the
      // `takesInt(@cell)` site; if the bare-strip leaked into the lexical lookup it would answer
      // `string` and manufacture a false non-numeric rejection.
      ["HIGH4: a lexical `cell` does NOT shadow the state cell `@cell`", !intSites.some((s2) => s2.bucket === "other-annotated:string"), intSites.filter((s2) => s2.bucket.startsWith("other-annotated")).map((s2) => s2.bucket).join(",") || "<none>"],
      ["HIGH4: `@cell` still resolves to the int state cell", intBy("int-annotated") === 3, String(intBy("int-annotated"))],
      // CROSS-FILE: proves the import-resolution path FIRES, so the corpus run's zero
      // import-resolved sites is a measurement rather than a dead branch.
      ["cross-file: both `bump(5)` and `plain(6)` resolve through the import", xInt.length === 2, String(xInt.length)],
      ["cross-file sites are tagged resolution=import", xInt.every((s2) => s2.resolution === "import"), xInt.map((s2) => s2.resolution).join(",")],
      ["cross-file args are integral-literal", xInt.every((s2) => s2.bucket === "integral-literal"), xInt.map((s2) => s2.bucket).join(",")],
      // ALIAS REPAIR: `type Count = int` is `typeKind: ""`, which `buildTypeRegistry` registers as
      // `asIs`. Without `repairRegistry` the `bump` site VANISHES — this asserts it does not.
      ["alias `type Count = int` is repaired, so `bump` is not lost", xInt.some((s2) => s2.paramAnnotation === "Count"), xInt.map((s2) => s2.paramAnnotation).join(",")],
      ["repairRegistry counted the alias repair", xRepair.aliasRepairs === 1, String(xRepair.aliasRepairs)],
      ["repairRegistry counted the no-marker struct repair", selfRepair.structRepairs === 1, String(selfRepair.structRepairs)],
    ];
    for (const [name, ok, got] of checks) console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `   (got ${got})`}`);
    return checks.every(([, ok]) => ok) ? 0 : 2;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function freshCounters(): Counters {
  return {
    filesDiscovered: 0, filesParsed: 0, filesFailed: 0,
    annotationSitesSeen: 0, annotationSitesWithInt: 0, annotationSitesUnresolvable: 0,
    structBodiesParsed: 0, structBodiesUnparsed: 0,
    braceBodiesZeroField: 0, enumBodiesParsed: 0, enumBodiesUnparsed: 0,
    annotationSitesAsIsNamed: 0, paramAnnotationsAsIsNamed: 0,
    registryBuildFailures: 0, duplicateFnNames: 0,
    schemaBlocksParsed: 0, schemaBlocksUnparsed: 0,
    aliasRepairs: 0, structRepairs: 0, enumRepairs: 0,
    callExprsSeen: 0, callsCalleeNotIdent: 0, callsUnresolvedCallee: 0, callsResolved: 0,
    argsAtIntParam: 0, argsAtNumberParam: 0,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (process.argv.includes("--selftest")) process.exit(runSelftest());

const WANT_JSON = process.argv.includes("--json");
const WANT_SUMMARY_ONLY = process.argv.includes("--summary");

/**
 * `--roots=a,b,c` restricts the corpus to those top-level directories. Present so this instrument
 * can reproduce §7.5.1's own stated population instead of only measuring a superset of it.
 * ⚑ Callee resolution still indexes ONLY the selected files, so a call whose callee is declared
 * outside the roots becomes an unresolved callee rather than silently resolving — the narrowing
 * is honest in both directions and the `unresolvedCallee` line moves to show it.
 */
const rootsArg = process.argv.find((a) => a.startsWith("--roots="));
const ROOTS: string[] | null = rootsArg
  ? rootsArg.slice("--roots=".length).split(",").map((s) => s.trim()).filter(Boolean)
  : null;

const counters = freshCounters();
// ⚑ DEDUPED. `--roots=examples,examples/sub` (or any pair where one root contains another) would
// otherwise enumerate the same file twice, double-counting every site while every `N of M` pair
// still read clean — the truncation invariant's mirror image, an INFLATED population that looks
// just as healthy as a correct one.
const files = ROOTS
  ? [...new Set(ROOTS.flatMap((r) => enumerateScrml(join(REPO_ROOT, r))))].sort()
  : enumerateScrml(REPO_ROOT);
counters.filesDiscovered = files.length;

// Pass 1 — parse every file and build its model. Cross-file callee resolution needs every file's
// fn index in hand before any call site is classified, so this cannot be a single pass.
const models = new Map<string, FileModel>();
const parseFailures: Array<{ file: string; error: string }> = [];
const t0 = performance.now();
for (const f of files) {
  try {
    const out = runTAB(runBlockSplitter({ filePath: f, source: readFileSync(f, "utf8") })) as { ast?: AnyNode };
    if (!out?.ast) { counters.filesFailed++; parseFailures.push({ file: relative(REPO_ROOT, f), error: "no ast" }); continue; }
    models.set(f, buildFileModel(f, out.ast, counters));
    counters.filesParsed++;
  } catch (e) {
    counters.filesFailed++;
    parseFailures.push({ file: relative(REPO_ROOT, f), error: String((e as Error)?.message ?? e).slice(0, 160) });
  }
}
const parseMs = performance.now() - t0;

const floor = ROOTS ? MIN_FILES_ROOTED : MIN_FILES;
if (counters.filesDiscovered < floor) {
  console.error(`✗ NOT A VALID RUN — enumeration collapsed: ${counters.filesDiscovered} files < floor ${floor}.`);
  console.error(`  Refusing to report a census over a remnant. Walk root: ${REPO_ROOT}${ROOTS ? `  roots: ${ROOTS.join(",")}` : ""}`);
  process.exit(2);
}
// ⚑ THE FLOOR GUARDS WHAT WAS PARSED, NOT ONLY WHAT WAS FOUND.
// Guarding `filesDiscovered` alone catches a broken WALK and misses a broken PARSE: if every file
// were found and every parse threw, the census would exit 0 and report a tidy population of zeros —
// the exact "reports PASS while measuring nothing" species this instrument is built against.
if (counters.filesParsed < floor) {
  console.error(`✗ NOT A VALID RUN — parse collapsed: ${counters.filesParsed} of ${counters.filesDiscovered} files parsed, < floor ${floor}.`);
  console.error(`  A census of zeros is not a census. First few failures:`);
  for (const f of parseFailures.slice(0, 5)) console.error(`    ${f.file}  |  ${f.error}`);
  process.exit(2);
}

// Pass 2 — the census itself.
const annotations: AnnotationSite[] = [];
/** Every type NAME that silently collapsed to `asIs` — the floor caveat, enumerated not asserted. */
const unresolvedTypeNames = new Set<string>();
const intParamSites: CallSite[] = [];
const numberParamSites: CallSite[] = [];
const t1 = performance.now();
for (const f of files) {
  const m = models.get(f);
  if (!m) continue;
  const rel = relative(REPO_ROOT, f);
  collectAnnotationSites(m, rel, annotations, counters, unresolvedTypeNames);
  collectCallSites(m, rel, models, intParamSites, numberParamSites, counters, unresolvedTypeNames);
}
const censusMs = performance.now() - t1;

// --- Q3: the diagonal, in both readings -------------------------------------
const strictRejections = intParamSites.filter((s) => s.bucket !== "int-annotated");
const strictRejectionsIntegral = strictRejections.filter((s) => s.bucket === "integral-literal");
const provableRejections = strictRejections.filter((s) => s.provable && s.argType !== "integer");
const provableRejectionsIntegral = provableRejections.filter((s) => s.bucket === "integral-literal");
/** A provable rejection whose argument is NOT a number at all — a rejection no ruling would undo. */
const provableRejectionsNonNumeric = provableRejections.filter((s) => s.argType !== "number");
/**
 * Sites inference GAPPED on, but whose callee DECLARES a primitive return type. These are not
 * rejections today and they are not an assignability question — they are the population a
 * return-type-aware inference would resolve without any ruling at all. Split out so the two levers
 * stay distinguishable in the blast-radius figure.
 */
const unProvableSites = intParamSites.filter((s) => !s.provable);
const inferenceGappedWithDeclaredReturn = unProvableSites.filter((s) => s.calleeReturns !== "");
const gappedReturnsInt = inferenceGappedWithDeclaredReturn.filter((s) => s.calleeReturns === "integer");

// --- Q4: the reverse direction ----------------------------------------------
const reverseSites = numberParamSites.filter((s) => s.argType === "integer");

// --- files touched -----------------------------------------------------------
const annFiles = new Set(annotations.map((a) => a.file));
const intCallFiles = new Set(intParamSites.map((s) => s.file));
const intParamDecls = new Set<string>();
/**
 * Functions whose ONLY int-ish parameter is an `int[]` ARRAY, so they are deliberately NOT in
 * `intParamDecls` — an `int[]` parameter is not an `int` parameter and no assignability ruling on
 * the int/number pair reaches it.
 *
 * ⚑ THIS COUNTER EXISTS TO EXPLAIN A DISCREPANCY RATHER THAN LEAVE IT AS NOISE.
 * A line-grep for an int-annotated parameter returns 74; this census returns 71, and the gap is
 * exactly these. `:[[:space:]]*(int|integer)\b` matches `int[` — the word boundary sits between
 * `t` and `[` — so a grep counts `interpDepths: int[]` as an int parameter and the resolver does
 * not. The three are `mkState`, `popDepth` and `emitInterpStart` in `compiler/self-host-v2/
 * lex.scrml`. (The `int[]` params in `examples/28-flux.scrml` do NOT contribute to the gap: those
 * functions carry bare `int` params too, so they are already counted.) Both numbers are right
 * about different questions; reporting the reconciliation means nobody has to re-derive it.
 */
const intArrayOnlyParamDecls = new Set<string>();
for (const m of models.values()) {
  for (const fn of m.fns.values()) {
    let hasBareInt = false;
    let hasIntArray = false;
    for (const p of fn.params) {
      if (!p.annotation) continue;
      let t: ResolvedTypeLike;
      try { t = resolveTypeExpr(p.annotation, m.registry as never) as ResolvedTypeLike; } catch { continue; }
      if (primitiveName(t) === "integer") { hasBareInt = true; break; }
      if (integerNestings(t).some((n) => n === "array-element")) hasIntArray = true;
    }
    const key = `${relative(REPO_ROOT, m.file)}#${fn.name}`;
    if (hasBareInt) intParamDecls.add(key);
    else if (hasIntArray) intArrayOnlyParamDecls.add(key);
  }
}
const intParamDeclFiles = new Set([...intParamDecls].map((k) => k.split("#")[0]));

if (WANT_JSON) {
  console.log(JSON.stringify({
    watermark: { repoRoot: REPO_ROOT, roots: ROOTS, generatedAt: new Date().toISOString() },
    totals: {
      filesDiscovered: counters.filesDiscovered,
      filesParsed: counters.filesParsed,
      filesFailed: counters.filesFailed,
      parseMs: Math.round(parseMs),
      censusMs: Math.round(censusMs),
    },
    q1: {
      annotationSitesSeen: counters.annotationSitesSeen,
      annotationSitesWithInt: counters.annotationSitesWithInt,
      annotationSitesUnresolvable: counters.annotationSitesUnresolvable,
      structBodiesParsed: counters.structBodiesParsed,
      structBodiesUnparsed: counters.structBodiesUnparsed,
      braceBodiesZeroField: counters.braceBodiesZeroField,
      enumBodiesParsed: counters.enumBodiesParsed,
      enumBodiesUnparsed: counters.enumBodiesUnparsed,
      registryAliasRepairs: counters.aliasRepairs,
      registryStructRepairs: counters.structRepairs,
      registryEnumRepairs: counters.enumRepairs,
      registryBuildFailures: counters.registryBuildFailures,
      duplicateFnNames: counters.duplicateFnNames,
      annotationSitesAsIsNamed: counters.annotationSitesAsIsNamed,
      paramAnnotationsAsIsNamed: counters.paramAnnotationsAsIsNamed,
      unresolvedTypeNames: [...unresolvedTypeNames].sort(),
      byLineKind: Object.fromEntries(tally(annotations, (a) => a.lineKind)),
      schemaBlocksParsed: counters.schemaBlocksParsed,
      schemaBlocksUnparsed: counters.schemaBlocksUnparsed,
      intOccurrences: annotations.length,
      filesWithIntAnnotation: annFiles.size,
      byPosition: Object.fromEntries(tally(annotations, (a) => a.position)),
      byNesting: Object.fromEntries(tally(annotations, (a) => a.nesting)),
      byPositionAndNesting: Object.fromEntries(tally(annotations, (a) => `${a.position}/${a.nesting}`)),
      bySpelling: Object.fromEntries(tally(annotations, (a) => a.spelling || "<unrecoverable>")),
      intParamFnDecls: intParamDecls.size,
      intParamFnDeclFiles: intParamDeclFiles.size,
      intArrayOnlyParamFnDecls: intArrayOnlyParamDecls.size,
      intArrayOnlyParamFnDeclNames: [...intArrayOnlyParamDecls].sort(),
      sites: annotations,
    },
    q2: {
      callExprsSeen: counters.callExprsSeen,
      callsCalleeNotIdent: counters.callsCalleeNotIdent,
      callsUnresolvedCallee: counters.callsUnresolvedCallee,
      callsResolved: counters.callsResolved,
      argsAtIntParam: counters.argsAtIntParam,
      filesWithIntParamCall: intCallFiles.size,
      byBucket: Object.fromEntries(tally(intParamSites, (s) => s.bucket)),
      byResolution: Object.fromEntries(tally(intParamSites, (s) => s.resolution)),
      sites: intParamSites,
    },
    q3: {
      strict: { rejections: strictRejections.length, integralLiteral: strictRejectionsIntegral.length },
      provable: {
        rejections: provableRejections.length,
        integralLiteral: provableRejectionsIntegral.length,
        nonNumericArg: provableRejectionsNonNumeric.length,
      },
      strictByBucket: Object.fromEntries(tally(strictRejections, (s) => s.bucket)),
      provableByBucket: Object.fromEntries(tally(provableRejections, (s) => s.bucket)),
      inferenceGappedWithDeclaredReturn: inferenceGappedWithDeclaredReturn.length,
      gappedWhereCalleeReturnsInt: gappedReturnsInt.length,
      gappedWithDeclaredReturnSites: inferenceGappedWithDeclaredReturn,
    },
    q4: {
      argsAtNumberParam: counters.argsAtNumberParam,
      reverseDirectionSites: reverseSites.length,
      byBucket: Object.fromEntries(tally(numberParamSites, (s) => s.bucket)),
      sites: reverseSites,
    },
    parseFailures,
  }, null, 2));
  process.exit(0);
}

const R = (n: number, m: number) => `${n} of ${m}`;

console.log(`int/number assignability census — SPEC §7.5.1 position 3   (MEASUREMENT, not a gate)`);
console.log(`  root : ${REPO_ROOT}`);
console.log(`  scope: ${ROOTS ? `--roots=${ROOTS.join(",")}` : "WHOLE TREE (2555 here; §7.5.1's own figure is the 1920-file 5-root set — see --roots)"}`);
console.log();
console.log(`CORPUS`);
console.log(`  .scrml files parsed                  : ${R(counters.filesParsed, counters.filesDiscovered)} discovered`);
console.log(`  parse failures                       : ${counters.filesFailed}`);
console.log(`  parse / census time                  : ${(parseMs / 1000).toFixed(1)}s / ${(censusMs / 1000).toFixed(1)}s`);
console.log();

console.log(`Q1 — \`int\` / \`integer\` ANNOTATION POSITIONS`);
console.log(`  annotation sites carrying an int     : ${R(counters.annotationSitesWithInt, counters.annotationSitesSeen)} annotation sites reached`);
console.log(`  int occurrences (an int[] is one)    : ${annotations.length}   across ${annFiles.size} files`);
console.log(`  annotations the resolver refused     : ${counters.annotationSitesUnresolvable}`);
console.log(`  struct bodies parsed                 : ${R(counters.structBodiesParsed, counters.structBodiesParsed + counters.structBodiesUnparsed)}`);
console.log(`  enum bodies parsed                   : ${R(counters.enumBodiesParsed, counters.enumBodiesParsed + counters.enumBodiesUnparsed)}`);
console.log(`  brace bodies w/ ZERO struct fields   : ${counters.braceBodiesZeroField}   (routed to the enum parser, NOT counted as a struct success)`);
console.log(`  registry entries REPAIRED by us       : ${counters.aliasRepairs} alias + ${counters.structRepairs} no-marker struct + ${counters.enumRepairs} no-marker enum`);
console.log(`     ^ type-decls \`buildTypeRegistry\` leaves as \`asIs\` because their \`typeKind\` is "".`);
console.log(`       Without the repair these are INVISIBLE to any int/number question. See the header.`);
console.log(`  registry build FAILURES (fell back)  : ${counters.registryBuildFailures}`);
console.log(`  duplicate fn names within one file   : ${counters.duplicateFnNames}   (later decl wins in the fn index)`);
console.log();
console.log(`  ⚑ FLOOR CAVEAT — annotations that named a type this census could not resolve:`);
console.log(`      annotation sites -> \`asIs\` by NAME : ${counters.annotationSitesAsIsNamed}`);
console.log(`      callee PARAM annots -> \`asIs\`      : ${counters.paramAnnotationsAsIsNamed}`);
console.log(`      distinct unresolved type names    : ${unresolvedTypeNames.size}`);
if (counters.annotationSitesAsIsNamed + counters.paramAnnotationsAsIsNamed > 0) {
  console.log(`    An out-of-file (e.g. IMPORTED) type name collapses SILENTLY to \`asIs\` — SPEC §14.1.2 /`);
  console.log(`    §34 E-TYPE-UNKNOWN-NAME says so, and \`resolveTypeExpr\` is span-free so it cannot report.`);
  console.log(`    If any of those names ALIASES an int, the figures below are a FLOOR. Names: ${[...unresolvedTypeNames].sort().slice(0, 12).join(", ")}${unresolvedTypeNames.size > 12 ? ", …" : ""}`);
} else {
  console.log(`    ZERO — every annotation resolved. The figures below are NOT floored by this cause.`);
}
console.log(`  <schema> blocks parsed               : ${R(counters.schemaBlocksParsed, counters.schemaBlocksParsed + counters.schemaBlocksUnparsed)}`);
console.log();
console.log(`  BY POSITION`);
for (const [k, v] of tally(annotations, (a) => a.position)) console.log(`    ${pad(k, 34)} ${v}`);
console.log(`  BY LINE PRECISION  (decl-head = the enclosing decl's line; the per-field line is not`);
console.log(`                      recoverable — labelled rather than faked)`);
for (const [k, v] of tally(annotations, (a) => a.lineKind)) console.log(`    ${pad(k, 34)} ${v}`);
console.log(`  BY NESTING  (where the int sits inside the annotation)`);
for (const [k, v] of tally(annotations, (a) => a.nesting)) console.log(`    ${pad(k, 34)} ${v}`);
console.log(`  BY SPELLING  (\`int\` is an ALIAS of \`integer\` — presentation, not type; "mixed" = a body`);
console.log(`                using BOTH spellings, where the per-field answer is not recoverable)`);
for (const [k, v] of tally(annotations, (a) => a.spelling || "<unrecoverable>")) console.log(`    ${pad(k, 34)} ${v}`);
console.log();
console.log(`  fn/function decls with >=1 int param : ${intParamDecls.size}   across ${intParamDeclFiles.size} files`);
console.log(`    + decls whose ONLY int-ish param is  : ${intArrayOnlyParamDecls.size}   an \`int[]\` ARRAY (NOT an int param;`);
console.log(`      a line-grep counts these, so grep=${intParamDecls.size + intArrayOnlyParamDecls.size} vs census=${intParamDecls.size} — both right, different questions)`);
console.log();

console.log(`Q2 — CALL SITES REACHING AN \`int\`-ANNOTATED PARAMETER`);
console.log(`  call exprs with a resolvable callee   : ${R(counters.callsResolved, counters.callExprsSeen)} call expressions walked`);
console.log(`    callee was not a plain identifier   : ${counters.callsCalleeNotIdent}   (method calls — no declared scrml signature to reach)`);
console.log(`    callee identifier did not resolve   : ${counters.callsUnresolvedCallee}   (builtin / host / unimported — a FLOOR caveat)`);
console.log(`  arguments at an int-annotated param   : ${R(intParamSites.length, counters.argsAtIntParam)} recorded   across ${intCallFiles.size} files`);
console.log();
console.log(`  BY WHAT IS PASSED`);
for (const [k, v] of tally(intParamSites, (s) => s.bucket)) console.log(`    ${pad(k, 34)} ${v}`);
console.log(`  BY CALLEE RESOLUTION`);
for (const [k, v] of tally(intParamSites, (s) => s.resolution)) console.log(`    ${pad(k, 34)} ${v}`);
console.log();

console.log(`Q3 — THE DIAGONAL  (the claim under test)`);
console.log(`  STRICT name-equality — reject everything not \`int\`-annotated:`);
console.log(`    would REJECT                        : ${R(strictRejections.length, intParamSites.length)} int-param arguments`);
console.log(`    of those, integral literals         : ${R(strictRejectionsIntegral.length, strictRejections.length)} rejections`);
console.log(`  PROVABLE-ONLY — reject only what today's inference can actually type:`);
console.log(`    would REJECT                        : ${R(provableRejections.length, intParamSites.length)} int-param arguments`);
console.log(`    of those, integral literals         : ${R(provableRejectionsIntegral.length, provableRejections.length)} rejections`);
console.log(`    of those, argument is NOT numeric   : ${R(provableRejectionsNonNumeric.length, provableRejections.length)} rejections   (a TRUE positive — no ruling undoes it)`);
console.log(`  NOT A RULING QUESTION — inference gapped, but the callee DECLARES its return type:`);
console.log(`    gapped w/ a declared return         : ${R(inferenceGappedWithDeclaredReturn.length, unProvableSites.length)} un-provable int-param arguments`);
console.log(`    of those, the callee returns \`int\`  : ${R(gappedReturnsInt.length, inferenceGappedWithDeclaredReturn.length)}   <- a return-type-aware inference resolves these WITHOUT a ruling`);
console.log();

console.log(`Q4 — THE REVERSE DIRECTION  (int-typed value into a \`number\` parameter)`);
console.log(`  arguments at a number-annotated param : ${R(numberParamSites.length, counters.argsAtNumberParam)} recorded`);
console.log(`  of those, the argument is int-typed   : ${R(reverseSites.length, numberParamSites.length)}   <- SAFE under a refinement reading`);
console.log();

if (parseFailures.length) {
  console.log(`PARSE FAILURES — complete, no truncation:`);
  for (const p of parseFailures) console.log(`  ${p.file}  |  ${p.error}`);
  console.log();
}

if (!WANT_SUMMARY_ONLY) {
  console.log(`Q1 SITES, BY POSITION — complete, no truncation:`);
  const annByPos = new Map<string, AnnotationSite[]>();
  for (const a of annotations) { if (!annByPos.has(a.position)) annByPos.set(a.position, []); annByPos.get(a.position)!.push(a); }
  for (const [p, rows] of [...annByPos.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${p}  (${rows.length})`);
    for (const a of rows) {
      const mark = a.lineKind === "decl-head" ? " (decl head)" : "";
      console.log(`    ${a.file}:${a.line}${mark}  ${a.owner}  [${a.nesting}]  ${a.annotation}`);
    }
  }

  console.log(`\n\nQ2 SITES — every argument at an int-annotated parameter, complete:`);
  const callByBucket = new Map<string, CallSite[]>();
  for (const s of intParamSites) { if (!callByBucket.has(s.bucket)) callByBucket.set(s.bucket, []); callByBucket.get(s.bucket)!.push(s); }
  for (const [b, rows] of [...callByBucket.entries()].sort((a, b2) => b2[1].length - a[1].length)) {
    console.log(`\n  ${b}  (${rows.length})`);
    for (const s of rows) console.log(`    ${s.file}:${s.line}  ${s.callee}(#${s.paramIndex} ${s.paramName}: ${s.paramAnnotation})  [${s.resolution}]`);
  }

  console.log(`\n\nQ4 SITES — int-typed argument at a number-annotated parameter, complete:`);
  if (reverseSites.length === 0) console.log(`  (none)`);
  for (const s of reverseSites) {
    console.log(`  ${s.file}:${s.line}  ${s.callee}(#${s.paramIndex} ${s.paramName}: ${s.paramAnnotation})  [${s.resolution}]`);
  }
}

process.exit(0);
