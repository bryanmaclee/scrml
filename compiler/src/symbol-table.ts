/**
 * Symbol Table — Stage 3.06 of the scrml compiler pipeline (SYM).
 *
 * Phase A1b Step B1 — V5-strict symbol-table extension. This module
 * constructs a per-scope state-cell registry over the FileAST produced by
 * TAB and decorated by NR. It is FOUNDATIONAL infrastructure that
 * subsequent A1b steps (B2 onward) build on:
 *
 *   B2 — V5-strict bare-name resolution + E-NAME-COLLIDES-STATE  [LANDED]
 *   B3 — `@name` resolution → record back-pointer on each ExprNode  [LANDED]
 *   B4 — Import binding registration + source-position `pinned` forward-ref
 *        check (E-STATE-PINNED-FORWARD-REF) + best-effort
 *        E-IMPORT-PINNED-INVALID  [LANDED]
 *   B5 — Cell classifier (bindable, markup-typed, derived-with-validators)  [LANDED]
 *   B6 — Render-by-tag E-CELL-NO-RENDER-SPEC + E-CELL-RENDER-SPEC-NOT-BINDABLE
 *   B7 — Derived-cell dep DAG + E-DERIVED-CIRCULAR-DEP
 *   B8 — L21 walker (E-DERIVED-VALUE-MUTATE + E-SYNTHESIZED-WRITE)
 *   B11/B12 — Validity-surface synthesized cells (re-entrancy invariant)
 *
 * Phase A1b Step B2 — V5-strict bare-name resolution. The walker now also
 * visits `let-decl`, `const-decl`, `tilde-decl`, and `lin-decl` nodes (the
 * four local declaration kinds). For each local-decl, looks up the decl's
 * name in the current scope (via `lookupStateCell`'s parent-chain walk). If
 * a registered state-cell record is found at any enclosing scope, fires
 * `E-NAME-COLLIDES-STATE` per SPEC §6.1.3 + §34. Local names cannot shadow
 * registered state-cell names — the V5-strict invariant.
 *
 * Phase A1b Step B5 — Cell classifier. PASS 4 walks every registered
 * `state-decl` (via the per-scope `stateCells` map populated in PASS 1) and
 * stamps a `_cellKind` discriminant + `_isBindable` boolean on the AST decl
 * node. Four kinds:
 *
 *   - `"plain"`        — Shape 1 mutable cell (`<count> = 0`) OR Shape 3
 *                        derived with non-markup RHS (`const <doubled> = @count * 2`).
 *   - `"bindable"`     — Shape 2 with `renderSpec.element.tag` in
 *                        {input, textarea, select} (canonical bindable set,
 *                        per `codegen/emit-html.ts` BIND_DIRECTIVE_TAGS).
 *   - `"markup-typed"` — Shape 3 derived with markup RHS (e.g.,
 *                        `const <badge> = <span>...</span>`) OR a non-bindable
 *                        Shape 2 markup-RHS (defensively classified; A1b/B6
 *                        may later reject as illegal Shape-2).
 *   - `"compound-parent"` — Variant C compound (`<formRes> { <name> = ""; ... }`).
 *                           Children classify recursively as standalone state-decls
 *                           in the compound's sub-scope.
 *
 * Per A1b plan §4.6 line 230, B5 RECORDS classification (annotates AST only);
 * B6 will FIRE `E-CELL-NO-RENDER-SPEC` + `E-CELL-RENDER-SPEC-NOT-BINDABLE`
 * based on the `_cellKind` annotation. B7 will filter to plain/markup-typed
 * + isConst when building the derived-cell dep DAG.
 *
 * Phase A1b Step B3 — `@name` resolution. PASS 3 walks every ExprNode payload
 * on every AST node and, for each `@`-prefixed `IdentExpr`, calls
 * `lookupStateCell(currentScope, name.slice(1))`. The result (a
 * `StateCellRecord` or `null`) is stamped onto the IdentExpr as a
 * non-enumerable `_resolvedStateCell` field. This is the annotated-AST
 * contract that B5+ (cell classifier), B7 (derived-cell dep DAG), B10
 * (validator typer cross-field args), and B22 (`reset(@cell)` keyword)
 * consume to know which cell each `@name` read points to without
 * re-resolving by string lookup. Per A1b plan §4.6 line 228, B3 RECORDS
 * resolution; the resolution-fail catch-all is "existing infra" — B3 stamps
 * `null` on failed lookups (no new error code). Compound nav (`@form.name`)
 * resolves the BASE cell only at B3; deeper path resolution defers to
 * `lookupQualifiedStateCell` consumers when leaf-level resolution is needed.
 *
 * What B1 lands:
 *   - A `Scope` data structure (per-file root, child scopes for function /
 *     engine / component / compound state-decl bodies) with a `stateCells`
 *     `Map<string, StateCellRecord>`.
 *   - A registration walker that visits every `state-decl` node (both
 *     `structuralForm:true` `<x> = init` and `structuralForm:false` legacy
 *     `@x = init`) and registers its name in the containing scope.
 *   - Variant C compound (§6.3) recursive registration: parent name in the
 *     enclosing scope; children registered in the parent's compound sub-scope
 *     under qualified-path keys (e.g., `signup.name`).
 *   - Annotated AST: each `state-decl` gains a `_record: StateCellRecord`
 *     back-pointer; each scope-introducing node gains a `_scope: Scope`
 *     back-pointer; FileAST gains a top-level `_scope: Scope`.
 *   - Public lookup API: `lookupStateCell` (parent-chain walk),
 *     `lookupQualifiedStateCell` (multi-segment paths), `getScopeForNode`
 *     (reverse lookup).
 *
 * What B1 + B2 do NOT do (handled by later B-steps):
 *   - Resolve `@name` reads. B3 walks ExprNode trees and records the
 *     resolution back-pointer.
 *   - Synthesize validity-surface cells (`@compound.isValid` etc.). B11/B12
 *     synthesize and add records to existing scopes via the `_scope`
 *     back-pointer (re-entrancy invariant per BRIEF §6).
 *   - Walk engine state-children or component bodies. Today's AST stores
 *     `engine-decl.rulesRaw: string` and `component-def.raw: string` (no
 *     walkable children), so engine + component scope construction defers
 *     to B14+/B17+. The `ScopeKind` enum reserves `"engine"` and
 *     `"component"` for those steps; B1's walker fills `"file"`,
 *     `"function"`, and `"compound"` only.
 *
 * Performance budget: <= 5 ms per file (single AST traversal + Map inserts).
 */

import type {
  ASTNode,
  FileAST,
  ReactiveDeclNode,
  FunctionDeclNode,
  LetDeclNode,
  ConstDeclNode,
  TildeDeclNode,
  LinDeclNode,
  Span,
  IdentExpr,
  CallExpr,
  ImportDeclNode,
  ImportSpecifier,
  ExprNode,
  ResetExpr,
  MemberExpr,
} from "./types/ast.ts";
import {
  forEachIdentInExprNode,
  forEachCallInExprNode,
  emitStringFromTree,
  forEachResetExprInExprNode,
} from "./expression-parser.ts";
import {
  ARRAY_MUTATING_METHODS,
  isDerivedMutatingAssignOp,
} from "./derived-mutation-ops.ts";
// B15 — engine state-child structural parser.
import {
  parseEngineStateChildren,
  isLegacyArrowRulesBody,
  scanForOnIdleEntries,
} from "./engine-statechild-parser.ts";
// B18 — multi-statement event-handler validation helper.
import { scanForTopLevelSemicolon } from "./multi-statement-scan.ts";
// B14 fix — `resolveModulePath` is the path-shape normalizer used by MOD when
// it builds `exportRegistry` (keys are absolute, post-`resolveModulePath`).
// Import-binding `sourcePath` is the LITERAL `imp.source` string — typically
// a relative path. The `lookupExportRegistry` helper below tries the literal
// first (matches test-harness registries that key by relative paths), then
// the absolute-resolved form (matches the production pipeline). Mirrors C15's
// `lookupSourceMap` workaround in `codegen/emit-engine.ts`; both lookups are
// stage-local — there is no shared helper today.
import { resolveModulePath } from "./module-resolver.js";

// S107 Phase 2 — match-statechild-parser for SPEC §18.0.1 block-form arm
// recognition. Mirrors B15's engine-statechild-parser delegation pattern.
import { parseMatchArms, extractEnumVariants } from "./match-statechild-parser.ts";
import type { MatchArmEntry, MatchArmAttr } from "./match-statechild-parser.ts";

// Unit CC (S123 — companion to V-kill): per-file exemption list for the
// E-WRITE-NOT-IN-LOGIC-CONTEXT diagnostic. The 110-ish-file pre-S123 corpus
// uses bare `@x = expr` at `<program>` / `<page>` body-top — a pattern that
// V-kill carved out from its own fire and Unit CC now enforces per Option 2.
// Adopter migration is deferred; each file sunsets by removing its entry
// from the JSON. List shape: repo-relative path strings (e.g.,
// "samples/contact-directory.scrml").
//
// Loaded once at module init via synchronous readFileSync. JSON file lives
// in compiler/src/ so it ships with the compiler. Path normalization in
// isUnitCCExempt() strips the absolute repo prefix, fall-through to a
// best-effort suffix match (covers worktree/checkout-location variance).
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename_unitcc = fileURLToPath(import.meta.url);
const __dirname_unitcc = dirname(__filename_unitcc);
const UNIT_CC_EXEMPTION_LIST: string[] = (() => {
  try {
    const raw = readFileSync(join(__dirname_unitcc, "unit-cc-exemption-list.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
    return [];
  } catch {
    return [];
  }
})();
const UNIT_CC_EXEMPT_SET = new Set<string>(UNIT_CC_EXEMPTION_LIST);

function isUnitCCExempt(filePath: string): boolean {
  if (!filePath) return false;
  // Strict: try direct membership (caller passed a repo-relative path).
  if (UNIT_CC_EXEMPT_SET.has(filePath)) return true;
  // Lenient: peel any known repo prefixes. The list is repo-relative; spans
  // typically carry absolute paths. The worktree harness adds the
  // `.claude/worktrees/agent-XXX/` segment; strip that and the repo root.
  for (const entry of UNIT_CC_EXEMPT_SET) {
    if (filePath.endsWith(entry)) {
      // Guard against accidental short-suffix collisions (e.g., "a.scrml"
      // matching "/foo/bar/a.scrml"): require a `/` boundary just before
      // the entry, OR the entry to BE the full path.
      const idx = filePath.length - entry.length;
      if (idx === 0 || filePath[idx - 1] === "/") return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// B4 — Import binding registry
// ---------------------------------------------------------------------------
//
// Per A1b Step B4, every import specifier that lands in the file's lexical
// scope is registered into the file scope's `importBindings` map. The record
// captures the local binding name, the originally-imported name, the source
// module, the `pinned` flag, and a back-pointer to the ImportDeclNode (for
// span access during the source-position forward-ref check).
//
// Why on `Scope`, not on a separate structure: imports are scope-introducing
// just like state-decls. A future B-step that supports per-function or
// per-component import scoping rides on the same registry shape.

/**
 * A single import-binding entry. Created at registration in SYM PASS-1.
 */
export interface ImportBindingRecord {
  /** Local binding name in the importing file's scope. */
  localName: string;
  /** Original name as exported by the source module (pre-alias). */
  exportedName: string;
  /** Resolved source module path (verbatim from `ImportDeclNode.source`).
   *  May be a relative path (e.g., `"./engines.scrml"`) or a stdlib alias
   *  (e.g., `"scrml:auth"`). Same string the rest of the pipeline carries. */
  sourcePath: string;
  /** True iff the `pinned` bareword modifier was present on this specifier. */
  pinned: boolean;
  /** Back-pointer to the ImportDeclNode for span access. The decl's
   *  `span.start` is the source-position used for forward-ref checks. */
  declNode: ImportDeclNode;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The kind of scope a `Scope` represents.
 *
 * - `"file"` — file-level (per-FileAST) root scope.
 * - `"function"` — body of a `function-decl` node.
 * - `"engine"` — body of an engine declaration. RESERVED for B14+ (today's
 *   AST stores engine bodies as raw text under `engine-decl.rulesRaw`; the
 *   walker does not construct engine scopes yet).
 * - `"component"` — body of a `component-def` node. RESERVED for B17+
 *   (today's AST stores component bodies as raw text under `component-def.raw`).
 * - `"compound"` — body of a Variant C compound state-decl
 *   (`state-decl.children`).
 * - `"field"` — B12 — a per-field synth surface scope attached to a
 *   compound CHILD's decl node. Holds the three per-field synth records
 *   (`isValid`, `errors`, `touched`) per §55.6 / L11 Edge B. Created
 *   unconditionally for every compound child by PASS 8 (B12). Empty
 *   `importBindings`; only synth records ever register here.
 */
export type ScopeKind = "file" | "function" | "engine" | "component" | "compound" | "field";

/**
 * Phase A1b Step B5 — cell-kind discriminant set on each `state-decl` AST node
 * via the non-enumerable `_cellKind` property. Read via `getCellKind`.
 *
 * - `"plain"`           — Shape 1 mutable cell or Shape 3 non-markup derived.
 * - `"bindable"`        — Shape 2 with bindable HTML root (input/textarea/select).
 * - `"markup-typed"`    — Shape 3 markup-RHS derived (display markup), or a
 *                         Shape-2-shaped decl whose render-spec is NOT one of
 *                         the canonical bindable tags.
 * - `"compound-parent"` — Variant C compound parent (has `children[]`).
 * - `"engine"`          — Phase A1b B14 — auto-declared variable of an
 *                         `<engine for=Type>` declaration (§51.0.A-C). Reuses
 *                         B1's StateCellRecord registration path; engine-
 *                         specific data lives on the `_engineMeta` field.
 *                         Per audit Option C (hybrid): single registration
 *                         mechanism for ALL reactive cells; downstream passes
 *                         dispatch on `_cellKind === "engine"` for engine-
 *                         specific behavior.
 */
export type CellKind = "plain" | "bindable" | "markup-typed" | "compound-parent" | "engine";

/**
 * Phase A1b Step B14 — engine-specific metadata attached to a StateCellRecord
 * whose `_cellKind === "engine"`. Captures the engine declaration's surface
 * properties for downstream consumers (B15-B17, A1c codegen, A7 hierarchy).
 *
 * **Forward-compatibility shape (audit §2 brief #1):** the BASIC fields are
 * populated by B14 today. The A7 fields (`parentEngine`, `innerEngines`,
 * `historyAttr`, `internalRules`, `onTimeoutElements`) are
 * declared in the type so downstream passes can reference them without
 * type-system churn when A5-2/A5-3 dispatches land — they remain `undefined`
 * or `null` at this stage to mark "not yet meaningful in this dispatch."
 * (`parallelAttr` was added by A5-2 mirroring §51.0.P recognition; the field
 * was removed 2026-05-08 alongside the §51.0.P spec strike — see
 * `docs/changes/parallel-close-2026-05-08/`.)
 *
 * SPEC cross-references:
 *   §51.0.A — singleton overview
 *   §51.0.B — declaration syntax
 *   §51.0.C — auto-declared variable + var=
 *   §51.0.D — mount position rules
 *   §51.0.E — initial= attribute (RECORD only; B15 validates)
 *   §51.0.J — derived engines (B16 consumes derivedExpr)
 *   §51.0.K — components-vs-engines (E-COMPONENT-ENGINE-SCOPE owner)
 *   §51.0.M-Q — A7 hierarchy + temporal-rule fields (declared, deferred)
 */
export interface EngineMetadata {
  // ---- BASIC fields populated by B14 ----

  /** The enum type the engine is over (`for=Type`). Mirrors
   *  `engine-decl.governedType`. */
  forType: string;
  /** Variant names from the type registry, when known at SYM time.
   *  May be empty if the type is not yet resolved (B14 leaves it empty;
   *  B15 consults the type-system pass to populate the variant set). */
  variants: string[];
  /** Value of `initial=.X` if present; `null` otherwise. B15 validates
   *  against `variants` and emits W-ENGINE-INITIAL-MISSING when null. */
  initialVariant: string | null;
  /** Reactive expression string from `derived=expr`, when present.
   *  Stored as the raw AST shape for B16 to consume in cycle detection.
   *  Today's parser stores `engine-decl.sourceVar` (legacy single-var form)
   *  — B16 will widen this to the §51.0.J expression-tree form. Set to
   *  `null` when absent. */
  derivedExpr: unknown | null;
  /** The auto-declared variable name (§51.0.C). Equals `varNameOverride`
   *  when present, else the literal lowercase-first-character of `forType`,
   *  else (legacy fallback) the value of `name=`. Mirrors the resolution
   *  done in `ast-builder.js`. */
  varName: string;
  /** True iff the engine declaration is exported (`export <engine ...>`).
   *  Set when MOD's exportRegistry annotation lands in B14's MOD extension;
   *  defaults `false` when the engine is same-file-only. */
  isExported: boolean;
  /** True iff the `pinned` bareword modifier was present on the engine
   *  declaration. Per §51.0.B + §6.10. Covers both the engine identifier
   *  AND the auto-declared variable. */
  isPinned: boolean;

  // ---- A7 forward-compat fields (DECLARED but not populated by B14) ----

  /** §51.0.Q — for nested engines (engine declared inside another engine's
   *  state-child body), back-pointer to the parent engine's record. `null`
   *  for file-scope engines. POPULATED by future A5-2 hierarchy dispatch. */
  parentEngine?: StateCellRecord | null;
  /** §51.0.Q — for file-scope engines that host nested engines, the list of
   *  inner engine records. POPULATED by future A5-2 hierarchy dispatch. */
  innerEngines?: StateCellRecord[];
  /** §51.0.N — file-scope summary: `true` iff ANY state-child carries
   *  `historyAttr: true` (OR-reduce over `stateChildren[].historyAttr`).
   *  POPULATED by SYM PASS 16 (A5-3). */
  historyAttr?: boolean;
  /** §51.0.O — file-scope summary: flat list of `internal:rule=` entries
   *  across all state-children, each annotated with the owning state-child
   *  tag for codegen clarity. Only entries whose `internalRule.kind !== "absent"`
   *  are included. POPULATED by SYM PASS 16 (A5-3). */
  internalRules?: Array<{ stateChildTag: string; rule: EngineRuleForm }>;
  /** §51.0.M — file-scope summary: flat list of `<onTimeout>` element
   *  entries across all state-children, each annotated with the owning
   *  state-child tag for codegen clarity. POPULATED by SYM PASS 16 (A5-3). */
  onTimeoutElements?: Array<{ stateChildTag: string; entry: OnTimeoutEntry }>;

  /** §51.0.R (S77, A5-6) — engine-wide event-timeout watchdog. ONE per
   *  engine maximum (E-IDLE-DUPLICATE on multiple). `null` when the engine
   *  declares no `<onIdle>`. Populated by SYM PASS 11 after parsing
   *  `engine-decl.rulesRaw` via `scanForOnIdleEntries`. */
  idleWatchdog?: OnIdleEntry | null;

  // ---- B15 fields (PASS 11 — engine state-child exhaustiveness + rule= typer) ----

  /** §51.0.B + §51.0.F — list of state-child entries parsed out of
   *  `engine-decl.rulesRaw` (the engine body raw text). Each entry records
   *  the variant tag, the parsed rule= form (single / multi / wildcard /
   *  absent / legacy-arrow / parse-error), and the body text (raw, not
   *  walkable today — the parser limitation noted in §13.7 B14 specifics).
   *  POPULATED by SYM PASS 11 (B15). Empty array when the body has no
   *  state-children (legacy `<machine>` arrow rules in `rulesRaw` are NOT
   *  state-children — they remain unparsed by B15 because the legacy form
   *  is handled by the type-system's `parseMachineRules`).
   *  Future B17 will add walkable body content; until then `bodyRaw` is
   *  raw text. */
  stateChildren?: EngineStateChildEntry[];
}

/** §51.0.F three target-only forms — the `rule=` shape recognized by B15.
 *
 *  A5-2 EXTENSION (§51.0.N — `.Variant.history` target form): `single` and
 *  `multi` shapes carry an optional history-form discriminator (`historyForm`
 *  / `historyForms`). Per Phase 0 SURVEY §1.6, Option A is approved — the
 *  flag rides the existing forms transparently to all current consumers
 *  (B15/B16/B17/B18/A1c). Most callsites can ignore the flag; A5-3 typer
 *  and A1c codegen read it when lowering the `.Variant.history` runtime form.
 *
 *  `historyForms` is a parallel array to `targets` on `multi` shapes: one
 *  flag per target, supporting mixed lists like `(.A | .B.history)` per
 *  §51.0.N (no spec prohibition on mixing). When absent, all targets are
 *  non-history form. */
export type EngineRuleForm =
  | { kind: "absent" }                                                                    // no `rule=` attribute (terminal state)
  | { kind: "single"; target: string; historyForm?: boolean }                             // `rule=.NextVariant` (or `.NextVariant.history`)
  | { kind: "multi"; targets: string[]; historyForms?: boolean[] }                        // `rule=(.A | .B | .C)` — history-flag parallel array
  | { kind: "wildcard" }                                                                  // `rule=*`
  | { kind: "legacy-arrow"; raw: string }                                                 // `rule="event -> Variant"` (rejected)
  | { kind: "parse-error"; raw: string; reason: string };                                 // unparseable rule=

/**
 * §51.0.B.1 (S98 amendment) — a payload-binding declaration on an engine
 * state-child opener. Three accepted source forms (all collapse to the
 * same `PayloadBinding[]` after parsing):
 *
 *   1. Bare-attribute form (positional)  — `<Done rows rule=...>`
 *   2. Parenthesized form (positional)   — `<Done(rows) rule=...>`
 *   3. Named form                        — `<Done rows=r rule=...>`
 *
 * Forms 1 + 2 emit `{ kind: "positional", name }`. Form 3 emits
 * `{ kind: "named", field, name }`. Mixed forms within one opener are an
 * `E-ENGINE-PAYLOAD-ARITY-MISMATCH` per §18.7's mixed-form prohibition.
 *
 * `name` is the local identifier introduced into the state-child body's
 * scope. `field` (named form only) is the variant payload field name on
 * the LHS of `=` — must match a declared field per §14.4 / §18.7 named
 * destructuring; mismatch fires `E-TYPE-022` (inherited).
 */
export type PayloadBinding =
  | { kind: "positional"; name: string }
  | { kind: "named"; field: string; name: string };

/**
 * A5-2 (§51.0.M) — a `<onTimeout after=DURATION to=.Variant/>` self-closing
 * structural element parsed out of an engine state-child body. The `after`
 * attribute is captured as the raw literal-or-computed-expression string
 * (e.g., `"500ms"`, `"${@delay}s"`); A5-3 typer parses the duration form
 * and validates the `to=` target against `engineMeta.variants`.
 *
 * `rawOffset` is `bodyRaw`-relative — the absolute file offset is
 * reconstructable by adding `engine-decl.span.start` + the offset of
 * `bodyRaw` start within `rulesRaw` + this `rawOffset`.
 */
export interface OnTimeoutEntry {
  /** Raw `after=` attribute value (literal `Nms`/`Ns`/etc. OR computed
   *  `${expr}<unit>`). A5-3 typer normalizes into milliseconds. */
  after: string;
  /** `to=.Variant` target. Captured as the variant name (no leading dot).
   *  Empty string when malformed (parse-error shape — A5-3 surfaces). */
  to: string;
  /** A5-6 Feature 1 (§51.0.M name= extension, S79). Optional addressable
   *  identifier for the timer. When present, `cancelTimer("<name>")` callable
   *  from the same state-child body cancels JUST this timer. Names are
   *  scope-local to the state-child; two `<onTimeout>` in the same body
   *  with the same `name=` is `E-TIMER-NAME-DUPLICATE`. Non-identifier
   *  shapes are `E-TIMER-NAME-INVALID`. Absent (undefined) for unnamed
   *  timers (current pre-S79 behavior; index-keyed). */
  name?: string;
  /** Substring offset (relative to the enclosing state-child's `bodyRaw`)
   *  of the `<onTimeout` opener. */
  rawOffset: number;
}

/**
 * A5-6 (§51.0.R, S77) — an `<onIdle after=DURATION to=.Variant/>` self-
 * closing element parsed out of an engine's `rulesRaw` (engine-root scope;
 * sibling of state-children).
 *
 * Distinct from `OnTimeoutEntry` in scope and semantics:
 *   - `<onTimeout>` is per-state-child; armed on entry to its state, cleared
 *     on exit. Multiple per state-child are legal.
 *   - `<onIdle>` is per-engine (machine-wide); armed at module-init, RESET
 *     on every successful transition (any `_scrml_engine_direct_set` /
 *     `_scrml_engine_advance` commit), fires after N ms of silence.
 *
 * One `<onIdle>` per engine maximum (E-IDLE-DUPLICATE on multiple).
 * Placement OUTSIDE engine root (e.g., inside a state-child body) fires
 * E-IDLE-MISPLACED — typer cross-references against the state-child boundary
 * map produced by `parseEngineStateChildren`.
 */
export interface OnIdleEntry {
  /** Raw `after=` attribute value. Same shape as `OnTimeoutEntry.after`
   *  (literal `Nms`/`Ns`/etc. OR computed `${expr}<unit>`). */
  after: string;
  /** `to=.Variant` target — variant name (no leading dot). Empty string
   *  when malformed. Strict-validated against engine's enum. */
  to: string;
  /** Substring offset (relative to the engine's `rulesRaw`) of the
   *  `<onIdle` opener. */
  rawOffset: number;
}

/**
 * A5-2 (§51.0.Q.1) — a nested `<engine>` declaration parsed out of a
 * state-child body. Captured as raw text + offset; the inner engine's
 * structural parsing (rules, state-children, etc.) is deferred — A5-3
 * typer (or A1c codegen) walks the raw text via the same engine-decl
 * construction path.
 *
 * Per Phase 0 SURVEY §1.5: A5-2 captures shape ONLY (no recursive parse).
 * The composite-state-child marker is `innerEngines.length > 0`.
 */
export interface NestedEngineEntry {
  /** The full nested-engine source slice — `<engine ...>...</>` (or
   *  `</engine>`) — verbatim from the parent's `bodyRaw`. */
  rawText: string;
  /** Substring offset (relative to the enclosing state-child's `bodyRaw`)
   *  of the `<engine` opener. */
  rawOffset: number;
}

/**
 * B17.2 (§51.0.H) — an `<onTransition>` element parsed out of a state-child
 * body. Captures the four built-in attributes from the opener and the body
 * text verbatim. Per S74 narrow-scope ratification, B17.2 captures shape ONLY;
 * B17.3 typer (forthcoming) walks the captured entries to fire diagnostics
 * (e.g., E-ENGINE-EFFECT-AMBIGUOUS, missing-direction errors).
 *
 * Per BRIEF §scope-IN item 1: built-in attributes per SPEC §51.0.H lines
 * 20563-20570 are `to=.Variant`, `from=.Variant`, `once`, `if=expr`. Other
 * attributes are NOT recognized at the parser layer (the §51.0.J derived-engine
 * example showing `effect=` ON `<onTransition>` is a separate spec
 * disambiguation concern — see SURVEY.md decision 2).
 */
export interface OnTransitionEntry {
  /** §51.0.H — `to=.Variant` value (no leading dot). `null` when not present.
   *  Per SPEC, exactly ONE of {to, from} should be present; the typer (B17.3)
   *  enforces. The parser captures verbatim. */
  to: string | null;
  /** §51.0.H — `from=.Variant` value (no leading dot). `null` when not present.
   *  Inverts directionality (placed in TARGET state-child to fire on incoming
   *  transitions). */
  from: string | null;
  /** §51.0.H — `once` bare attribute. `true` when present (handler runs at
   *  most once per engine lifetime). */
  once: boolean;
  /** §51.0.H — `if=expr` raw value, captured verbatim including any
   *  surrounding parentheses or `${...}` wrapper. `null` when not present.
   *  B17.3 typer normalises (paren-form / logic-context / bare). */
  ifExprRaw: string | null;
  /** Body text between opener and closer. Empty string for self-closing
   *  `<onTransition .../>` (degenerate but harmless per SURVEY.md decision 2).
   *
   *  - For bare-body form, this is the inter-tag text.
   *  - For `:`-shorthand form (§51.0.I, defensively supported per SURVEY.md
   *    decision sub-3a), this is the post-`:` text up to the line end.
   *  - For self-closing, this is empty. */
  bodyRaw: string;
  /** TRUE when this entry's body was parsed via `:`-shorthand. FALSE for
   *  bare-body or self-closing forms. */
  isColonShorthand: boolean;
  /** Substring offset (relative to the enclosing state-child's `bodyRaw`)
   *  of the `<onTransition` opener. */
  rawOffset: number;
}

/** §51.0.B + §51.0.F — a state-child entry parsed out of `engine-decl.rulesRaw`. */
export interface EngineStateChildEntry {
  /** PascalCase tag name, e.g., `"Small"` for `<Small ...>...</>`. */
  tag: string;
  /** Parsed form of the `rule=` attribute. */
  rule: EngineRuleForm;
  /** Raw body text between the opener and closer. Today's AST stores
   *  engine bodies as raw text (parser limitation per §13.7 B14 specifics);
   *  walkable bodies become available in a future dispatch.
   *
   *  - For bare-body form (`<Variant>...</>`), this is the inter-tag text
   *    (children + nested logic + text). Multi-statement is LEGAL here.
   *  - For `:`-shorthand form (`<Variant : single-expression>`), this is
   *    the post-`:` text up to the line end. Multi-statement is FORBIDDEN
   *    here per SPEC §4.14 line 980 — B18 PASS 11 fires
   *    E-MULTI-STATEMENT-HANDLER on top-level `;`.
   *  - For self-closing form (`<Variant/>`), this is empty. */
  bodyRaw: string;
  /** TRUE when this entry's body was parsed via the `:`-shorthand path
   *  (§4.14 / §51.0.I). FALSE for bare-body or self-closing forms.
   *  Drives B18's E-MULTI-STATEMENT-HANDLER fire-site #2 (only `:`-shorthand
   *  bodies are governed by the single-expression discipline; bare-body
   *  contains arbitrary children where `;` is meaningful). */
  isColonShorthand: boolean;
  /** Substring offset (relative to `rulesRaw`) of the state-child's opener.
   *  Useful for span-based diagnostics; absolute file offset can be
   *  reconstructed by adding the engine-decl's `span.start` + the offset
   *  from header-line end to `rulesRaw` start (recorded per ast-builder).
   *  For simplicity, B15 reports span-of-engine-decl on diagnostics; future
   *  span tightening is forward-compatible. */
  rawOffset: number;

  // ---- A5-2 NEW (§51.0.M-Q ratified extensions) ----

  /** §51.0.N — `history` bare attribute on the state-child opener.
   *  `<Variant history rule=...>` sets this `true`. A5-2 records;
   *  A5-3 typer fires E-HISTORY-NO-INNER-ENGINE when `historyAttr === true`
   *  AND `innerEngines.length === 0`. */
  historyAttr: boolean;
  /** §51.0.O — `internal:rule=` parallel attribute. Same six EngineRuleForm
   *  shapes as canonical `rule=`. `kind: "absent"` when the prefix is not
   *  present. A5-3 typer fires E-INTERNAL-RULE-NOT-COMPOSITE when
   *  `internalRule.kind !== "absent"` AND `innerEngines.length === 0`. */
  internalRule: EngineRuleForm;
  /** §51.0.M — `<onTimeout>` siblings inside this state-child body.
   *  Empty array when none are present. */
  onTimeoutElements: OnTimeoutEntry[];
  /** §51.0.Q.1 — nested `<engine>` declarations parsed out of this body.
   *  Empty array when this state-child is non-composite. The composite
   *  marker is downstream-derivable from `innerEngines.length > 0`. */
  innerEngines: NestedEngineEntry[];

  // ---- B17.2 NEW (§51.0.H ratified extensions) ----

  /** §51.0.H — raw text between `${` and matching `}` of the state-child
   *  opener's `effect=` attribute. `null` when `effect=` is absent.
   *
   *  `effect=${ ... }` is a logic-context expression that runs when a
   *  single-target `rule=` transition fires. Parser captures the inner
   *  expression text verbatim (no `${` `}` wrapper). B17.3 typer fires
   *  E-ENGINE-EFFECT-AMBIGUOUS when this is non-null AND `rule.kind` is
   *  multi-target (per §51.0.H lines 20548-20550).
   *
   *  Capture-with-null fallback for malformed `effect=` (unbalanced braces) —
   *  see B17.2 SURVEY.md decision 3. */
  effectRaw: string | null;
  /** §51.0.H — `<onTransition>` siblings inside this state-child body.
   *  Empty array when none are present. */
  onTransitionElements: OnTransitionEntry[];

  // ---- B1 NEW (§51.0.B.1 — S98 amendment, track 2 compiler wiring) ----

  /** §51.0.B.1 — payload-binding declarations extracted from the opener
   *  attribute list. Empty array when the state-child has no bindings (or
   *  when the variant is a unit variant — that case ALSO fires
   *  E-ENGINE-PAYLOAD-ON-UNIT-VARIANT in PASS 11).
   *
   *  Source forms (all unified into `PayloadBinding[]`):
   *    - Bare-attribute `<Done rows>`            → [{kind:"positional", name:"rows"}]
   *    - Parenthesized  `<Done(rows)>`           → [{kind:"positional", name:"rows"}]
   *    - Named          `<Done rows=r>`          → [{kind:"named", field:"rows", name:"r"}]
   *
   *  The parser distinguishes positional vs named by the attribute value
   *  shape: `{value: {kind: "absent"}}` is bareword (positional);
   *  `{value: {kind: "variable-ref"}}` with a single ident is named.
   *  Reserved attribute names (`rule`, `effect`, `history`, `internal:rule`)
   *  are SKIPPED — they take precedence per §51.0.B.1. Collision between a
   *  payload field name and a reserved attribute name surfaces as
   *  `E-ENGINE-PAYLOAD-RESERVED-COLLISION` in PASS 11 by examining the
   *  variant's declared payload field names. */
  payloadBindings: PayloadBinding[];
}

/**
 * A single state-cell symbol-table entry. Created at registration; mutated
 * by no later B-step (records are append-only). Cross-references the AST
 * decl node (`declNode`) and its containing scope (`scope`).
 */
export interface StateCellRecord {
  /** Bare cell name (no `@` prefix). For compound children, the LEAF name
   *  (e.g., `"name"` for `signup.name`); use `qualifiedPath` for the full
   *  dotted path. */
  name: string;
  /** Fully-qualified dotted path, scope-relative.  For top-level cells,
   *  equals `name`. For compound children, parent path + `.` + leaf
   *  (e.g., `"signup.name"`, `"outer.inner.leaf"`). */
  qualifiedPath: string;
  /** Back-pointer to the AST decl node. Pre-existing AST shape from TAB. */
  declNode: ReactiveDeclNode;
  /** Back-pointer to the scope this record was registered into. */
  scope: Scope;
  /** True iff the decl used the structural `<x> = init` form (V5-strict
   *  canonical). False iff the legacy `@x = init` form (still legal but
   *  emits no W-DEPRECATED at this phase). Mirrors
   *  `ReactiveDeclNode.structuralForm`. */
  structuralForm: boolean;
  /** RHS-shape discriminant per AST-CONTRACTS-AND-DECOMPOSITION §1.1.
   *  Mirrors `ReactiveDeclNode.shape`. */
  shape: "plain" | "decl-with-spec" | "derived" | undefined;
  /** True iff `const <x> = expr` derived form. Mirrors
   *  `ReactiveDeclNode.isConst`. */
  isConst: boolean;
  /** True iff `pinned` bareword modifier present on the decl. Mirrors
   *  `ReactiveDeclNode.pinned`. Used by B4 for forward-ref legality
   *  (E-STATE-PINNED-FORWARD-REF). */
  isPinned: boolean;
  /** True iff this record is a compound parent (Variant C, has non-empty
   *  `children`). The parent record is registered in the enclosing scope;
   *  child records are registered in the parent's compound sub-scope. */
  isCompoundParent: boolean;
  /** True iff this record is a compound child (registered inside a
   *  `kind:"compound"` scope). The leaf name lives at `name`; the full
   *  dotted path lives at `qualifiedPath`. */
  isCompoundChild: boolean;
  /** True iff `validators[]` is non-empty on the decl node. Used by B5
   *  cell classifier and B11/B12 validity-surface synthesis. Cheap boolean
   *  shorthand; consumers needing the array walk `declNode.validators`. */
  hasValidators: boolean;
  /** True iff `defaultExpr` is non-null on the decl node. Used by B22 for
   *  `reset(@cell)` target validation. */
  hasDefaultExpr: boolean;
  /** True iff `typeAnnotation` is set on the decl node. Used by B20 for
   *  bare-variant inference (M9, §14.10). */
  hasTypeAnnotation: boolean;
  /** B11 — true iff this record was synthesized by PASS 8 (auto-synthesized
   *  validity surface per §55.5 / §55.7 / L11). Synth records have NO underlying
   *  source AST decl — they are virtual cells the compiler creates so that
   *  `@form.isValid` / `@form.errors` / `@form.touched` / `@form.submitted`
   *  resolve to a registered entry. The `declNode` field still references the
   *  COMPOUND PARENT's decl node (not a fresh node — synth records are
   *  metadata, not AST insertions). */
  isSynthesized?: boolean;
  /** B11 — when `isSynthesized` is `true`, identifies which synth-surface
   *  property this record represents. Mirrors the four §55.5 / §55.7 properties
   *  exactly; per-field properties (B12 future scope) reuse the same enum
   *  except `submitted` which is COMPOUND-LEVEL ONLY (per §55.7 line 24468). */
  synthProperty?: SynthProperty;
  /** B11 — when `isSynthesized` is `true`, back-pointer to the parent compound
   *  record. Codegen reads this to know which compound's value-cells the synth
   *  cell rolls up over. For B12 per-field synth records, this is the
   *  ENCLOSING compound (the same record `parentField.scope`-resolves to). */
  parentCompound?: StateCellRecord;
  /** B12 — when `isSynthesized` is `true` AND this is a PER-FIELD synth
   *  record (per §55.6), back-pointer to the field cell whose surface this
   *  represents (e.g., for `@signup.name.isValid`, `parentField` is the
   *  `name` cell record). For COMPOUND-LEVEL synth records (B11), this is
   *  `undefined`. The presence/absence of `parentField` is the
   *  compound-vs-per-field discriminant on synth records. */
  parentField?: StateCellRecord;
  /** B11 — runtime-hook requirement annotation per §55.7 line 24449-24461.
   *  Pure-reactive synth cells (`isValid`, `errors`) have `null`; event-driven
   *  cells (`touched`, `submitted`) have `"touch"` or `"submit"`. A1c codegen
   *  emits the actual hooks (`bind:value` change / focus-out for touch; form
   *  submit for submit). NOT set on non-synth records. */
  runtimeHookKind?: "touch" | "submit" | null;
  /** B14 — engine-specific metadata. Set ONLY when this record represents an
   *  auto-declared engine variable (§51.0.A-C); `_cellKind` will be `"engine"`.
   *  Forward-compatible shape per audit §2 brief #1; A7 hierarchy fields
   *  remain undefined until A5-2/A5-3 dispatches populate them. See
   *  `EngineMetadata` above. */
  engineMeta?: EngineMetadata;
}

/**
 * The four synthesized-validity-surface property names per SPEC §55.5 / §55.6 /
 * §55.7.
 *
 * - `isValid` — boolean reactive rollup (compound-level: `true ↔ all fields pass`;
 *               per-field: `true ↔ this field's validators pass`).
 * - `errors`  — object map at compound scope (`{fieldName: [...errorTags]}`),
 *               array of `ValidationError` enum tags at per-field scope (B12).
 * - `touched` — object map at compound scope (`{fieldName: bool}`), boolean
 *               at per-field scope. Latched on first interaction.
 * - `submitted` — boolean. **COMPOUND-LEVEL ONLY** per §55.7 line 24468.
 */
export type SynthProperty = "isValid" | "errors" | "touched" | "submitted";

/**
 * The four synth-property names as a frozen set, for use in walkers that need
 * to discriminate "is this member-access targeting a synth surface property?"
 */
export const SYNTH_PROPERTY_NAMES: ReadonlySet<SynthProperty> = new Set(
  ["isValid", "errors", "touched", "submitted"] as const,
);

/**
 * The compound-level synth-property names per §55.5. All four are synthesized
 * at compound scope; B12 replicates `isValid`, `errors`, `touched` at
 * per-field scope but `submitted` stays compound-only.
 */
export const COMPOUND_SYNTH_PROPERTIES: readonly SynthProperty[] = [
  "isValid",
  "errors",
  "touched",
  "submitted",
] as const;

/**
 * The per-field synth-property names per §55.6. Three of the four — `submitted`
 * is COMPOUND-LEVEL ONLY per §55.7 line 24468 (audit §1.6 boundary). B12 PASS 8
 * extension registers exactly these three into each compound child's field
 * scope.
 */
export const PER_FIELD_SYNTH_PROPERTIES: readonly SynthProperty[] = [
  "isValid",
  "errors",
  "touched",
] as const;

/**
 * A single lexical scope. Forms a tree via `parent` back-pointers.
 *
 * Scopes are constructed top-down by the SYM walker:
 *   1. File-level root scope (kind `"file"`, parent `null`, qualifiedPath `""`).
 *   2. Function-body scope (kind `"function"`, parent = enclosing scope).
 *   3. Compound-decl sub-scope (kind `"compound"`, parent = enclosing scope,
 *      qualifiedPath = parent's path + parent name + `"."`).
 *   4. Engine / component sub-scopes RESERVED for B14+/B17+.
 *
 * Re-entrancy invariant (per BRIEF §6): scopes are NOT frozen after
 * construction. B11/B12 will add validity-surface synthesized records to
 * existing scopes; the symbol-table API supports `stateCells.set()` calls
 * post-B1.
 */
export interface Scope {
  /** Discriminant — see `ScopeKind`. */
  kind: ScopeKind;
  /** Parent scope, or `null` for the file-level root. */
  parent: Scope | null;
  /** Per-scope state-cell registry. Key is the scope-LOCAL name (the
   *  `StateCellRecord.name` value). For compound sub-scopes, this is the
   *  child's leaf name; the qualified path is recoverable via the
   *  `record.qualifiedPath` field. */
  stateCells: Map<string, StateCellRecord>;
  /** B4 — per-scope import-binding registry. Key is the LOCAL binding name
   *  in the importing scope. Populated only on file-level scopes today
   *  (imports hoist to file scope per existing AST shape — `FileAST.imports`).
   *  Reserved as a `Scope`-level field so a future per-function or
   *  per-component import surface rides the same shape without a schema
   *  change. Empty `Map` on non-file scopes. */
  importBindings: Map<string, ImportBindingRecord>;
  /** Path prefix used to compute child `qualifiedPath` values. For the
   *  file root, `""`. For a function scope, the enclosing scope's prefix
   *  (functions don't extend the dotted path). For a compound scope, the
   *  parent record's `qualifiedPath` followed by `.` (e.g., `"signup."`). */
  qualifiedPath: string;
}

/**
 * Per-file SYM result. Mirrors `NRResult`'s shape (filePath + diagnostic
 * count + summary stats). B1 emitted NO diagnostics, but B2 populates
 * `errors[]` with `E-NAME-COLLIDES-STATE` whenever a local declaration
 * (let/const/tilde/lin) shadows a registered state-cell name.
 */
export interface SYMResult {
  filePath: string;
  /** Errors and warnings emitted by SYM. Empty at B1; B2+ populates. */
  errors: SYMDiagnostic[];
  /** The file-level root scope. Cross-referenced from `FileAST._scope`. */
  fileScope: Scope;
  /** Summary stats (debugging aid). */
  stats: SYMStats;
}

export interface SYMDiagnostic {
  code: string;
  message: string;
  span: Span;
  /** "error" — blocking; "warning" — surfaced; "info" — informational lint
   *  surfaced through the existing diagnostic channel (mirrors SPA-INFERRED
   *  + I-MATCH-PROMOTABLE precedent — see SPEC §34 "Info" severity rows). */
  severity: "error" | "warning" | "info";
}

export interface SYMStats {
  /** Total number of state-cell records registered (top-level + nested). */
  totalRecords: number;
  /** Number of compound parent records. */
  compoundParents: number;
  /** Number of compound child records. */
  compoundChildren: number;
  /** Number of scopes constructed (file + function + compound at B1). */
  totalScopes: number;
  /** B4 — number of import-binding records registered at file scope. */
  totalImportBindings: number;
}

export interface SYMInput {
  filePath: string;
  ast: FileAST;
  /**
   * B4 — optional MOD exportRegistry (the `moduleResult.exportRegistry` map
   * of `Map<sourcePath, Map<exportName, {kind, category, isComponent}>>`).
   * When provided, SYM emits `E-IMPORT-PINNED-INVALID` for `pinned` imports
   * of definitively-not-cell-not-engine kinds (function/fn/type/channel).
   * When absent, the check is skipped — back-compat for pre-MOD callers
   * (test harnesses, self-host shim) which only rely on registration +
   * forward-ref check.
   *
   * **Best-effort scope (Option A, S66 dispatch):** const/let imports are
   * ACCEPTED without firing because they may be engine-shaped (Form 1
   * `export <engine var=appPhase>` desugars to `export const appPhase`
   * which is indistinguishable today). B14 (cross-file engine binding,
   * M18) lands engine-aware export-registry annotation; until then, the
   * check trades false negatives for zero false positives. See in-code
   * comment near the const/let accept-branch.
   */
  exportRegistry?: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>>;
}

// ---------------------------------------------------------------------------
// Internal: AST node decoration shape
// ---------------------------------------------------------------------------
//
// SYM mutates the AST in place by adding two annotation fields:
//
//   - `state-decl._record: StateCellRecord`
//     Back-pointer attached to each `state-decl` node after registration.
//     Consumers (B2-B22) recover the record without re-walking the tree.
//
//   - `<scope-introducing-node>._scope: Scope`
//     Attached to each scope-creating AST node (currently `function-decl`
//     and compound `state-decl`). FileAST also gains `_scope: Scope`
//     (the file-level root).
//
// These fields are typed loosely as `any` at the site of mutation (matching
// existing convention in NR's walker — see `name-resolver.ts:305-378` where
// `anyN.resolvedKind = ...`). Reverse lookup via `getScopeForNode` reads
// the field with a typed cast.

interface ScopeAnnotated {
  _scope?: Scope;
}

interface RecordAnnotated {
  _record?: StateCellRecord;
}

/**
 * B3 annotation shape — back-pointer stamped on every `@`-prefixed IdentExpr.
 *
 * Value:
 *   - `StateCellRecord` if the bare name (with `@` stripped) resolves to a
 *     registered cell anywhere on the parent-chain.
 *   - `null` if no such cell exists. Stamping `null` (rather than leaving
 *     the field absent) makes the annotation contract explicit:
 *     "B3 ran on this node; no resolution was found." Distinguishes a
 *     resolved-to-null from an un-walked node (which has no field at all).
 */
interface ResolvedAtNameAnnotated {
  _resolvedStateCell?: StateCellRecord | null;
}

/**
 * B5 annotation shape — back-pointers stamped on every `state-decl` AST node.
 *
 * - `_cellKind`: discriminant per `CellKind` doc.
 * - `_isBindable`: convenience accessor (`_cellKind === "bindable"`); used by
 *   B6's render-by-tag check at `<varname/>` use-sites without a re-switch.
 *
 * Both fields are non-enumerable (Object.defineProperty), mirroring B1's
 * `_record` and B3's `_resolvedStateCell` cycle-safety convention. Generic
 * structural walkers (BP/CG/codegen) skip them.
 */
interface CellKindAnnotated {
  _cellKind?: CellKind;
  _isBindable?: boolean;
}

// ---------------------------------------------------------------------------
// Scope construction primitives
// ---------------------------------------------------------------------------

function createScope(
  kind: ScopeKind,
  parent: Scope | null,
  qualifiedPath: string,
): Scope {
  return {
    kind,
    parent,
    stateCells: new Map(),
    importBindings: new Map(),
    qualifiedPath,
  };
}

function createRecord(
  declNode: ReactiveDeclNode,
  scope: Scope,
  qualifiedPath: string,
  isCompoundChild: boolean,
): StateCellRecord {
  const isCompoundParent = Array.isArray(declNode.children);
  const validators = (declNode as any).validators;
  return {
    name: declNode.name,
    qualifiedPath,
    declNode,
    scope,
    structuralForm: declNode.structuralForm === true,
    shape: declNode.shape,
    isConst: declNode.isConst === true,
    isPinned: declNode.pinned === true,
    isCompoundParent,
    isCompoundChild,
    hasValidators: Array.isArray(validators) && validators.length > 0,
    hasDefaultExpr: declNode.defaultExpr != null,
    hasTypeAnnotation: typeof declNode.typeAnnotation === "string"
      && declNode.typeAnnotation.length > 0,
  };
}

/**
 * Register a single `state-decl` into the given scope. Compound parents
 * (Variant C) recursively register their children in a sub-scope.
 *
 * Returns the created record (the parent record for compound parents).
 */
function registerStateDecl(
  declNode: ReactiveDeclNode,
  parentScope: Scope,
  stats: SYMStats,
  visited: WeakSet<object>,
): StateCellRecord {
  const isCompoundChild = parentScope.kind === "compound";
  const qualifiedPath = parentScope.qualifiedPath + declNode.name;

  const record = createRecord(declNode, parentScope, qualifiedPath, isCompoundChild);
  parentScope.stateCells.set(declNode.name, record);
  // Non-enumerable so generic structural AST walkers (BP/CG/codegen) don't
  // descend through `_record → record.scope → scope.stateCells → record`
  // cycle. Recovered via `getScopeForNode` or direct property access.
  Object.defineProperty(declNode, "_record", {
    value: record,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  stats.totalRecords++;
  if (record.isCompoundParent) stats.compoundParents++;
  if (isCompoundChild) stats.compoundChildren++;

  // Variant C compound: recurse into children in a fresh compound sub-scope.
  if (record.isCompoundParent && Array.isArray(declNode.children)) {
    const compoundScope = createScope(
      "compound",
      parentScope,
      qualifiedPath + ".",
    );
    Object.defineProperty(declNode, "_scope", {
      value: compoundScope,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    stats.totalScopes++;

    for (const child of declNode.children) {
      if (child && child.kind === "state-decl" && !visited.has(child)) {
        visited.add(child);
        registerStateDecl(child, compoundScope, stats, visited);
      }
    }
  }

  return record;
}

// ---------------------------------------------------------------------------
// B4 — Import-binding registration (PASS 1 sub-step)
// ---------------------------------------------------------------------------
//
// Imports are hoisted onto `FileAST.imports[]` by TAB. Walking that array
// (rather than re-discovering imports inside the AST tree) is the canonical
// path. Default imports (`import X from '...'`) bind a single LOCAL name
// equal to `imp.names[0]` with `pinned:false`; named imports populate
// `imp.specifiers[]` with full `{imported, local, pinned}` data.
//
// Collision policy: if the local name is ALREADY registered in the file
// scope's importBindings (duplicate-import-of-same-local-name), the second
// registration wins last-write. This mirrors how `Map.set` behaves and is
// consistent with the existing E-IMPORT-001/003/004 surface; no new
// diagnostic is fired here at B4.

function registerImportBindings(
  imports: ImportDeclNode[] | undefined,
  fileScope: Scope,
): void {
  if (!Array.isArray(imports)) return;
  for (const imp of imports) {
    if (!imp || imp.kind !== "import-decl") continue;
    if (imp.source == null) continue; // parse-failed import; skip silently.
    const sourcePath = imp.source;

    if (imp.isDefault) {
      // Default imports: single binding, no specifier shape, no pinned modifier.
      const localName = imp.names && imp.names.length > 0 ? imp.names[0] : null;
      if (!localName) continue;
      fileScope.importBindings.set(localName, {
        localName,
        exportedName: localName, // default exports have no separate exported name
        sourcePath,
        pinned: false,
        declNode: imp,
      });
      continue;
    }

    // Named imports: walk specifiers[]. The parser populates specifiers for
    // the braced form (`import { a, b as c pinned } from '...'`); the
    // bare names array is the parallel imported-name list.
    const specs: ImportSpecifier[] = Array.isArray(imp.specifiers) ? imp.specifiers : [];
    for (const spec of specs) {
      if (!spec || typeof spec.local !== "string") continue;
      fileScope.importBindings.set(spec.local, {
        localName: spec.local,
        exportedName: typeof spec.imported === "string" ? spec.imported : spec.local,
        sourcePath,
        pinned: spec.pinned === true,
        declNode: imp,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// B4 — E-IMPORT-PINNED-INVALID best-effort fire (Option A)
// ---------------------------------------------------------------------------
//
// SPEC §21.8.1: "`pinned` on a non-engine non-state-cell import (e.g.,
// `pinned` on a regular function) is E-IMPORT-PINNED-INVALID — `pinned` is
// only meaningful for cell-typed and engine-typed names."
//
// The MOD exportRegistry's per-name shape is `{kind, category, isComponent}`.
// `kind` is the canonical export kind: one of
// `{type, function, fn, const, let, channel, engine (B14), rename, local,
// re-export, re-export-all, unknown}`. The `"engine"` kind landed at B14
// (cross-file engine import via §51.0.D + §21.8 / M18); engines that flow
// through MOD's exportRegistry as `kind: "engine"` are LEGAL pinning
// targets (engines satisfy "engine-typed" per §21.8.1).
//
// Pinning policy:
//
// | Source export kind     | pinned import → action            |
// | ---------------------- | --------------------------------- |
// | function, fn           | FIRE E-IMPORT-PINNED-INVALID      |
// | type                   | FIRE                              |
// | channel                | FIRE (channels aren't cells)      |
// | engine                 | ACCEPT (engine-typed per §21.8.1) |
// | const, let             | ACCEPT (best-effort — engine-form |
// |                        | const exports indistinguishable   |
// |                        | from arbitrary const today)       |
// | re-export(-all),       | ACCEPT if not chasable            |
// |   rename, local,       |                                   |
// |   unknown              |                                   |
//
// Why fire on channel: channels are file-level synchronization primitives,
// not cells. A `pinned` import of a channel name is meaningless (the channel
// IS the binding; "identity-stability" doesn't apply). The spec's definition
// of "cell-typed and engine-typed" excludes channels by enumeration.
//
// Why ACCEPT const/let: even with B14's engine-kind annotation, parser
// support for `export <engine ...>` (Form 1) is incremental — Form 2
// `export const X = <engine ...>` desugars to `export const`. The B14 MOD
// hookup point reads `file.ast.machineDecls` for engine-shaped exports, so
// any engine-decl carrying `isExported: true` (set by future ast-builder
// work on `export <engine ...>` Form 1) becomes a `kind: "engine"` export
// regardless of its surface syntax. Until both forms are wired, const/let
// imports remain best-effort accepts.

const B4_IMPORT_PINNED_FIRE_KINDS: ReadonlySet<string> = new Set([
  "function",
  "fn",
  "type",
  "channel",
]);

/**
 * Look up the source file's exportRegistry entry by trying both path shapes.
 *
 * **Why this exists:** import-binding `sourcePath` carries the LITERAL
 * `imp.source` string (typically a relative path like `./engines.scrml`), but
 * MOD's `exportRegistry` is keyed by ABSOLUTE paths post-`resolveModulePath`
 * resolution. The asymmetry causes `exportRegistry.get(sourcePath)` to silently
 * miss in the production pipeline — false-negative B4 + B14 PASS 10.B fires.
 *
 * **Strategy:** try the literal first (matches unit-test harnesses that build
 * `exportRegistry` with relative path keys, e.g. `engine-binding-b14.test.js`);
 * if that misses AND the path is relative AND we have an importer path, try
 * the absolute-resolved form (matches the production pipeline). The literal-
 * first ordering is faster on the common-case test path; the absolute fallback
 * costs one extra resolve+Map.get when the relative key misses.
 *
 * **Shape:** mirrors C15's `lookupSourceMap` in `codegen/emit-engine.ts`
 * (parallel fix in a different stage). The two helpers are stage-local; no
 * shared module today.
 *
 * @param exportRegistry — MOD's exportRegistry (or undefined).
 * @param sourcePath — the binding's `sourcePath` (literal `imp.source`).
 * @param importerPath — absolute path of the SYM-input file (may be empty
 *   in synthetic harness paths; the absolute lookup is then skipped).
 * @returns the inner Map (export name → category) or undefined when neither
 *   shape resolves.
 */
function lookupExportRegistry(
  exportRegistry: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>>,
  sourcePath: string,
  importerPath: string,
): Map<string, { kind: string; category: string; isComponent: boolean }> | undefined {
  // (1) Literal lookup — relative-keyed test harnesses + non-relative
  // specifiers (stdlib `scrml:`, vendor `vendor:`, raw absolute paths) all
  // hit here.
  const direct = exportRegistry.get(sourcePath);
  if (direct) return direct;
  // (2) Absolute fallback — only meaningful for relative specifiers AND when
  // we know the importer path. `resolveModulePath` would return non-relative
  // specifiers as-is, so the second lookup would just repeat (1). Skip.
  if (!sourcePath.startsWith("./") && !sourcePath.startsWith("../")) return undefined;
  if (!importerPath || importerPath.length === 0) return undefined;
  try {
    const absSource = resolveModulePath(sourcePath, importerPath);
    return exportRegistry.get(absSource);
  } catch {
    // resolveModulePath threw (bad input, fs error, etc.) — treat as a miss.
    return undefined;
  }
}

function fireImportPinnedInvalid(
  fileScope: Scope,
  exportRegistry: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>> | undefined,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  if (!exportRegistry) return;
  for (const rec of fileScope.importBindings.values()) {
    if (!rec.pinned) continue;
    const sourceMap = lookupExportRegistry(exportRegistry, rec.sourcePath, filePath);
    if (!sourceMap) continue; // unknown source (path-shape miss + absolute fallback miss); skip.
    const exportInfo = sourceMap.get(rec.exportedName);
    if (!exportInfo) continue; // E-IMPORT-004 (unknown name) handled by MOD.
    const exportKind = exportInfo.kind;
    if (!B4_IMPORT_PINNED_FIRE_KINDS.has(exportKind)) {
      // ACCEPT branch — const/let/re-export/rename/local/unknown.
      //
      // B14 follow-up: const/let exports include both engine-shaped (Form 1
      // `export <engine var=appPhase>` desugars to `export const appPhase = ...`)
      // and arbitrary-value exports. B4 cannot distinguish today; B14 lands
      // engine-aware export-registry annotation. Until then, pinned on
      // const/let imports is accepted (false negatives possible).
      continue;
    }
    const declSpan = rec.declNode.span;
    errors.push({
      code: "E-IMPORT-PINNED-INVALID",
      message:
        `E-IMPORT-PINNED-INVALID: \`pinned\` modifier on imported \`${rec.localName}\``
        + (rec.localName !== rec.exportedName ? ` (originally \`${rec.exportedName}\`)` : "")
        + ` from \`${rec.sourcePath}\`. The exported name is a \`${exportKind}\`; `
        + `\`pinned\` is meaningful only for cell-typed and engine-typed names. `
        + `Remove the \`pinned\` modifier (SPEC §21.8.1 + §34).`,
      span: declSpan ?? { file: "", start: 0, end: 0, line: 1, col: 1 },
      severity: "error",
    });
  }
}

// ---------------------------------------------------------------------------
// AST walker — discovers state-decls and scope-introducing nodes
// ---------------------------------------------------------------------------
//
// Walks an arbitrary list of AST nodes within the given scope. State-decls
// register into `currentScope`. Function-decls open a child scope before
// recursing into the body. Compound state-decls handle their own sub-scope
// (in `registerStateDecl`).
//
// B2 extension: visits the four local-decl kinds (`let-decl`, `const-decl`,
// `tilde-decl`, `lin-decl`); for each, looks up its name in the current
// scope's parent chain and fires E-NAME-COLLIDES-STATE if a registered
// state-cell shadows it. The B2 check is a localized extension, not a new
// pass — the SYM walker already passes through let/const/tilde/lin nodes
// when descending function-body / logic-block containers; B1 ignored them,
// B2 consults the table.
//
// Mirrors NR's walker recursion (name-resolver.ts:301-378): visits
// `children`, `body`, `consequent`, `alternate`, `arms[].body`,
// `lift-expr.expr.node`. Engine + component bodies are NOT walked here —
// today's AST stores them as strings (see ScopeKind doc).

/**
 * B2: emit `E-NAME-COLLIDES-STATE` if `decl.name` is registered as a state
 * cell at any enclosing scope (parent-chain walk). Diagnostic carries the
 * decl's span and the name of the collided cell + its qualified path.
 */
function checkLocalDeclCollidesState(
  decl: LetDeclNode | ConstDeclNode | TildeDeclNode | LinDeclNode,
  currentScope: Scope,
  errors: SYMDiagnostic[],
): void {
  if (!decl.name) return;
  const collided = lookupStateCell(currentScope, decl.name);
  if (!collided) return;
  // Render the local-decl keyword display: `let x`, `const x`, `lin x`, or
  // bare `x` (for tilde-decl which has no leading keyword).
  let declDisplay: string;
  switch (decl.kind) {
    case "let-decl":   declDisplay = `let ${decl.name}`;   break;
    case "const-decl": declDisplay = `const ${decl.name}`; break;
    case "lin-decl":   declDisplay = `lin ${decl.name}`;   break;
    case "tilde-decl": declDisplay = `${decl.name}`;       break;
    default:           declDisplay = decl.name;
  }
  // The collision is detected by parent-chain walk; the registered record's
  // qualifiedPath disambiguates which cell is being shadowed (relevant for
  // compound-child collisions where the user's `let` sits in an outer
  // function but the state cell lives at a nested compound qualifiedPath).
  //
  // W13-Z hint: for `let-decl` collisions specifically, add a "did you mean"
  // hint covering the JS-transliteration shape (`let p = 0` + `@p = @p + 1`).
  // The hint names both fix paths in scrml-author terms (no compiler jargon).
  // `const`/`lin`/`tilde` decls don't get the hint — `const`/`lin` are
  // once-bound (mutation path doesn't apply); `tilde-decl` is a v0.next form
  // with distinct semantics. The base message remains the same for those.
  let hint = "";
  if (decl.kind === "let-decl" && typeof decl.name === "string") {
    const n = decl.name;
    const qp = collided.qualifiedPath;
    hint =
      `\n\nhint: This often arises when JS-style code uses \`let ${n} = ...\` `
      + `then writes \`@${n} = ...\` as if mutating the local. `
      + `The structural cell \`<${qp}>\` is the reactive store. Two fixes:\n`
      + `  (a) If you wanted to mutate the state cell, remove the \`let ${n}\` `
      + `line and use \`@${qp}\` directly (read) and \`@${qp} = expr\` (write).\n`
      + `  (b) If you wanted a separate local, rename it (e.g., \`let ${n}Local = ...\`) `
      + `and use the plain name in subsequent reassignments.`;
  }
  errors.push({
    code: "E-NAME-COLLIDES-STATE",
    message:
      `E-NAME-COLLIDES-STATE: local \`${declDisplay}\` shadows registered state cell \`<${collided.qualifiedPath}>\`. `
      + `Local names cannot shadow registered state-cell names (V5-strict, SPEC §6.1.3). `
      + `Rename the local, or use \`@${collided.qualifiedPath}\` to read the cell directly.`
      + hint,
    span: decl.span,
    severity: "error",
  });
}

function walk(
  nodes: ASTNode[] | undefined,
  currentScope: Scope,
  stats: SYMStats,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    if (kind === "state-decl") {
      // V-kill (S123) — Skip registration for fn/function/${} body `@x = expr`
      // emissions tagged `_isReactiveAssign: true` by ast-builder. These are
      // REASSIGNMENTS to (presumed pre-existing) structural decls — not new
      // declarations. Pre-S123, the parser unconditionally emitted state-decl
      // here, the registrator silently overwrote any prior cell record (Test
      // 5/6 in the auto-state-cell-synthesis DD), and downstream consumers
      // saw a synthesised phantom cell. Per V5-strict (SPEC §6.1.1 + §6.2)
      // the only legal declaration form is structural `<name>`; bare `@name
      // = expr` reassignments must NOT register a new cell. PASS 3
      // (`resolveAtNameOnExprNode`) fires E-STATE-UNDECLARED when the
      // target name doesn't resolve to a structurally-declared cell.
      if ((anyN as any)._isReactiveAssign === true) {
        // Recurse into the initExpr to walk any nested @-refs in the RHS via
        // B3 (PASS 3). The recursion below is for child decls (compound) and
        // doesn't apply here; we just continue past this node without
        // registering it as a cell.
        continue;
      }
      // The state-decl itself registers + (if compound) opens a sub-scope.
      registerStateDecl(n as ReactiveDeclNode, currentScope, stats, visited);
      // No further recursion: children are handled by registerStateDecl;
      // initExpr / renderSpec are EXPRESSION trees walked by B3 (not B1).
      continue;
    }

    if (kind === "function-decl") {
      // Function body opens a new function-scoped child scope.
      // qualifiedPath unchanged: functions don't introduce a dotted prefix.
      const fnScope = createScope("function", currentScope, currentScope.qualifiedPath);
      Object.defineProperty(anyN, "_scope", {
        value: fnScope,
        enumerable: false,
        configurable: true,
        writable: true,
      });
      stats.totalScopes++;
      walk(anyN.body, fnScope, stats, visited);
      continue;
    }

    // Recurse into common AST containers. Mirrors NR's recursion shape.
    // The `visited` WeakSet guards against `block`/`parent` back-refs that
    // some BS-derived nodes carry (mirroring the test helper's findKind walk).
    if (Array.isArray(anyN.children)) walk(anyN.children, currentScope, stats, visited);
    if (Array.isArray(anyN.body)) walk(anyN.body, currentScope, stats, visited);
    if (Array.isArray(anyN.consequent)) walk(anyN.consequent, currentScope, stats, visited);
    if (Array.isArray(anyN.alternate)) walk(anyN.alternate, currentScope, stats, visited);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walk(arm.body, currentScope, stats, visited);
      }
    }
    // Phase A10 (S78) — descend into engine-decl.bodyChildren so any state-
    // decls / nested scope-introducing constructs inside engine state-child
    // bodies are registered. Pre-A10, engine bodies were stored only as
    // raw text (rulesRaw); B14 PASS 10.A still registers the engine cell
    // itself (independent of body walking). This branch covers the rare
    // case where body content introduces a decl that PASS 1 should record.
    // Most engine bodies introduce no decls; this is mostly for completeness
    // + scope-chain extension consistency with PASSes 2/3/5/6/13/14.
    if (kind === "engine-decl" && Array.isArray(anyN.bodyChildren)) {
      walk(anyN.bodyChildren, currentScope, stats, visited);
    }
    // P3-FOLLOW alignment: lift-expr carries a markup tree under expr.node.
    // B1 doesn't have state-cell concerns inside lift-exprs (markup is the
    // value, not a decl-site), but mirroring NR's recursion shape avoids
    // surprises if a downstream B-step extends the walker.
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walk([anyN.expr.node], currentScope, stats, visited);
    }
  }
}

// ---------------------------------------------------------------------------
// B2: Local-decl collision walker (separate from PASS 1)
// ---------------------------------------------------------------------------
//
// Walks the same AST tree as `walk`, but ONLY fires E-NAME-COLLIDES-STATE
// diagnostics on local-decl nodes. Re-uses the `_scope` annotations PASS 1
// attached to scope-introducing nodes (function-decls, compound state-decls,
// FileAST). State-decl registration is NOT performed here — by the time
// PASS 2 runs, the symbol table is fully populated, so `lookupStateCell`
// sees every cell regardless of source-order forward refs.

function walkLocalDeclsForCollisions(
  nodes: ASTNode[] | undefined,
  currentScope: Scope,
  visited: WeakSet<object>,
  errors: SYMDiagnostic[],
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    // B2 — V5-strict local-decl shadow check. The four local declaration
    // kinds (let / const / tilde / lin) cannot use a name registered as a
    // state cell at any enclosing scope. SPEC §6.1.3 + §34
    // E-NAME-COLLIDES-STATE.
    if (
      kind === "let-decl"
      || kind === "const-decl"
      || kind === "tilde-decl"
      || kind === "lin-decl"
    ) {
      checkLocalDeclCollidesState(
        n as LetDeclNode | ConstDeclNode | TildeDeclNode | LinDeclNode,
        currentScope,
        errors,
      );
      // No early-continue: a local-decl may carry an if-/for-/match-as-
      // expression body that contains nested decls. Generic-recursion
      // fallthrough handles its child arrays.
    }

    if (kind === "state-decl") {
      // PASS 2 does not register; descend only into the compound sub-scope
      // (if any) so nested local-decls inside compound bodies are checked.
      const stateScope = (anyN as ReactiveDeclNode & ScopeAnnotated)._scope;
      if (stateScope && Array.isArray(anyN.children)) {
        walkLocalDeclsForCollisions(anyN.children, stateScope, visited, errors);
      }
      continue;
    }

    if (kind === "function-decl") {
      // Use the function scope PASS 1 already created.
      const fnScope = (anyN as ScopeAnnotated)._scope ?? currentScope;
      walkLocalDeclsForCollisions(anyN.body, fnScope, visited, errors);
      continue;
    }

    // Generic recursion. Same shape as PASS 1.
    if (Array.isArray(anyN.children)) walkLocalDeclsForCollisions(anyN.children, currentScope, visited, errors);
    if (Array.isArray(anyN.body)) walkLocalDeclsForCollisions(anyN.body, currentScope, visited, errors);
    if (Array.isArray(anyN.consequent)) walkLocalDeclsForCollisions(anyN.consequent, currentScope, visited, errors);
    if (Array.isArray(anyN.alternate)) walkLocalDeclsForCollisions(anyN.alternate, currentScope, visited, errors);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkLocalDeclsForCollisions(arm.body, currentScope, visited, errors);
      }
    }
    // Phase A10 (S78) — descend into engine-decl.bodyChildren so locals
    // declared inside engine state-child bodies (e.g., let-decl in event
    // handlers) get B2 collision-checked against the surrounding state cells.
    if (kind === "engine-decl" && Array.isArray(anyN.bodyChildren)) {
      walkLocalDeclsForCollisions(anyN.bodyChildren, currentScope, visited, errors);
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkLocalDeclsForCollisions([anyN.expr.node], currentScope, visited, errors);
    }
  }
}

// ---------------------------------------------------------------------------
// B3: `@name` resolution walker (PASS 3)
// ---------------------------------------------------------------------------
//
// Walks every ExprNode payload on every AST node. For each `@`-prefixed
// IdentExpr encountered, calls `lookupStateCell(currentScope, name.slice(1))`
// and stamps the result onto the IdentExpr as a non-enumerable
// `_resolvedStateCell` field. The stamped value is either a StateCellRecord
// (resolved) or null (resolution failed — no error fired at B3 per A1b plan
// §4.6 line 228; the resolution-fail catch-all is "existing infra").
//
// Why non-enumerable: the resolved record back-points to its scope which
// owns a Map<string, StateCellRecord> — the same cycle pattern that motivated
// B1's `_record` non-enumerable choice. Generic structural walkers (BP/CG)
// must skip the field.
//
// Compound nav (`@form.name.toUpperCase()`): the BASE IdentExpr (`@form`)
// resolves to the compound-parent record. The MemberExpr's `.name` /
// `.toUpperCase()` segments are NOT IdentExprs (they are static property
// names) — `forEachIdentInExprNode` correctly walks `member.object` only.
// Consumers needing the leaf record (B22 `reset(@form.name)`) re-resolve
// via `lookupQualifiedStateCell` using the parsed path.
//
// EXPR_FIELDS: the canonical list of AST-node fields that may carry an
// ExprNode. Mirrors `dependency-graph.ts:227-240` and
// `type-system.ts:7732-7735` (parseVariant Phase 2 walker).

const B3_EXPR_FIELDS: readonly string[] = [
  "exprNode",
  "initExpr",
  "argsExpr",
  "condExpr",
  "headerExpr",
  "iterExpr",
  "conditionExpr",
  "guardExpr",
  "valueExpr",
  "rhsExpr",
  "defaultExpr",
];

/**
 * Resolve every `@name` IdentExpr in an ExprNode subtree, stamp
 * `_resolvedStateCell`, and fire E-STATE-PINNED-FORWARD-REF when the read
 * source-position precedes the pinned cell's (or pinned import's) decl-span
 * end.
 *
 * **Read-position note (load-bearing).** IdentExpr `span` values are produced
 * by `expression-parser.ts → spanFromEstree(node, file, baseOffset)`. When an
 * ExprNode is parsed via `safeParseExprToNode` from inside an isolated
 * substring (function bodies / interpolation segments), `baseOffset` is 0 —
 * so the IdentExpr's `span.start` is the offset WITHIN the substring, not
 * within the whole source file. That makes IdentExpr spans unsuitable as
 * absolute read-positions for the source-position forward-ref check.
 *
 * The fallback is the **enclosing AST node's `span.start`** — passed in via
 * the walker as `readPos`. Every container that B3 traverses
 * (`function-decl`, `state-decl`, statement nodes, etc.) has an absolute
 * span set by ast-builder. That position is the lower bound of the read's
 * source-position; using it is conservative-correct:
 *
 *   - `function f() { return @x } ; <x pinned> = 0` — function.span.start
 *     (~14) < x.span.end (~66) → fires (correct).
 *   - `<x pinned> = 0 ; function f() { return @x }` — function.span.start
 *     (>x.span.end) → no fire (correct).
 *   - `<x pinned> = @x + 1` — state-decl.span.start (=decl.span.start)
 *     < decl.span.end → fires (self-init; correct per spec).
 *
 * The conservative aspect: a read at `function.start + 50` syntactically
 * AFTER a pinned decl that sits at `function.start + 100` would still see
 * the read-position as `function.start`. But that scenario can't occur:
 * pinned decls live at file/program scope and at compound scope, never
 * inside function bodies — function bodies don't open a state-cell decl
 * surface. So the read-position approximation is exact for the cases the
 * spec normatively addresses.
 */
function resolveAtNameOnExprNode(
  exprNode: unknown,
  currentScope: Scope,
  errors: SYMDiagnostic[],
  readPos: number,
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  forEachIdentInExprNode(exprNode as any, (ident: IdentExpr) => {
    if (typeof ident.name !== "string") return;
    if (!ident.name.startsWith("@")) return;
    // Strip the `@` prefix to get the bare cell name. The compound-nav case
    // (e.g., `@form.name`) is handled by MemberExpr → `forEachIdentInExprNode`
    // walks `member.object` and produces the BASE `@form` IdentExpr; the leaf
    // `.name` is a static property string, not an ident. So the `bareName`
    // here is always the cell-name root.
    const bareName = ident.name.slice(1);
    if (!bareName) return; // `@` alone — defensive; tokenizer wouldn't produce this here.
    const resolved = lookupStateCell(currentScope, bareName);
    Object.defineProperty(ident, "_resolvedStateCell", {
      value: resolved,
      enumerable: false,
      configurable: true,
      writable: true,
    });

    // B4 — E-STATE-PINNED-FORWARD-REF source-position check.
    //
    // A read of a `pinned` cell is a forward-reference (per SPEC §6.9.3 /
    // §6.10.2 / §6.10.5 / §7.6.1) when the enclosing-container source-position
    // (`readPos`) precedes the cell's declaration-span end. `decl.span.end`
    // (not `start`) catches both:
    //   - Reads in code before the pinned decl (readPos < decl.start ≤ decl.end).
    //   - Self-init reads inside the cell's own initialiser (the state-decl IS
    //     the enclosing container, so readPos === decl.span.start, which is
    //     < decl.span.end).
    if (resolved && resolved.isPinned) {
      const declSpan = resolved.declNode.span;
      if (
        declSpan
        && typeof declSpan.end === "number"
        && readPos < declSpan.end
      ) {
        const identSpan = makeReportSpan(ident, declSpan.file);
        errors.push({
          code: "E-STATE-PINNED-FORWARD-REF",
          message:
            `E-STATE-PINNED-FORWARD-REF: forward reference to \`pinned\` state cell `
            + `\`<${resolved.qualifiedPath}>\`. The \`pinned\` modifier opts the cell `
            + `out of hoisting; reads before its declaration site (or inside its own `
            + `initialiser) are unsafe (SPEC §6.10 + §34).`,
          span: identSpan,
          severity: "error",
        });
      }
      return; // resolved as state-cell; importBinding fallback irrelevant.
    }

    // B4 — pinned-import forward-ref. When the @-name does NOT resolve to a
    // registered same-file state cell, fall back to importBindings. A pinned
    // import behaves as a same-file pinned cell at file scope (SPEC §21.8.1):
    // reads BEFORE the import-decl's span end fire E-STATE-PINNED-FORWARD-REF.
    //
    // V-kill (S123) — READ-side E-STATE-UNDECLARED deferred. The DD §6
    // verdict-B prescription called for firing E-STATE-UNDECLARED on both
    // bare WRITES and bare READS of undeclared cells. The WRITE-side fire is
    // landed at `walkResolveAtNames` (state-decl with `_isReactiveAssign`)
    // because the parser tag makes the diagnostic surface decisive. The
    // READ-side fire was attempted here but blocked on a second-order
    // engine-auto-decl normalization mismatch: `< machine name=UI for=...>`
    // registers the cell as `UI` (verbatim engineName) via
    // `registerEngineDecl` (line ~4271), but the markup-side `${@ui}` (per
    // §51.0.C lowercased-first-char convention) reads as `ui` — `lookupStateCell`
    // misses despite the cell BEING declared. Pre-V-kill the null resolution
    // was silently propagated to codegen, which separately rewrote `@ui` from
    // the `<machine name=>` attribute. Firing E-STATE-UNDECLARED on the
    // read here would surface false-positives across the engine corpus until
    // the SYM-side engine var-name canonicalisation is fixed (separate unit).
    //
    // Read-side fires DEFERRED to a follow-up unit (post-V-kill). The
    // WRITE-side fire is the primary V-kill safety win: the write-creates-
    // phantom-cell auto-synth path is GONE, surfaced via E-STATE-UNDECLARED
    // at the write site. See auto-state-cell-synthesis DD §6 + §8 follow-up.
    if (!resolved) {
      const imp = lookupImportBinding(currentScope, bareName);
      if (imp && imp.pinned) {
        const impSpan = imp.declNode.span;
        if (
          impSpan
          && typeof impSpan.end === "number"
          && readPos < impSpan.end
        ) {
          const identSpan = makeReportSpan(ident, impSpan.file);
          errors.push({
            code: "E-STATE-PINNED-FORWARD-REF",
            message:
              `E-STATE-PINNED-FORWARD-REF: forward reference to \`pinned\` imported `
              + `binding \`${imp.localName}\` (from \`${imp.sourcePath}\`). A pinned `
              + `import behaves as a same-file pinned declaration at file scope; `
              + `reads before the import statement are unsafe (SPEC §21.8.1 + §34).`,
            span: identSpan,
            severity: "error",
          });
        }
      }
    }
  });
}

/**
 * Build the diagnostic-reporting span for an `@name` read. IdentExpr spans
 * are NOT reliable absolute offsets (see `resolveAtNameOnExprNode` doc), so
 * for diagnostics we report a synthetic span anchored at `fileFromDecl` with
 * `start: 0, end: 0`. Callers that need a richer span (LSP / IDE) recover the
 * actual source position from the enclosing AST node — the `readPos` value
 * the walker already tracks. (A future B-step that propagates absolute
 * baseOffsets through expression-parser will let us upgrade this to an
 * exact span; today the diagnostic is correct on code/severity/file even if
 * the column is approximate.)
 */
function makeReportSpan(ident: IdentExpr, fileFromDecl: string): Span {
  const ispan = (ident as any).span;
  return {
    file: (ispan && typeof ispan.file === "string" && ispan.file.length > 0)
      ? ispan.file
      : fileFromDecl,
    start: typeof ispan?.start === "number" ? ispan.start : 0,
    end: typeof ispan?.end === "number" ? ispan.end : 0,
    line: typeof ispan?.line === "number" ? ispan.line : 1,
    col: typeof ispan?.col === "number" ? ispan.col : 1,
  };
}

/**
 * Extract a node's read-position. Prefers `node.span.start` when present;
 * otherwise inherits from the parent walker's `readPos`. The conservative
 * inheritance ensures every IdentExpr reached from a container with a
 * known absolute span uses that span's start as its read-position.
 */
function nodeReadPos(node: any, parentReadPos: number): number {
  const sp = node && node.span;
  if (sp && typeof sp.start === "number") return sp.start;
  return parentReadPos;
}

function walkResolveAtNames(
  nodes: ASTNode[] | undefined,
  currentScope: Scope,
  visited: WeakSet<object>,
  errors: SYMDiagnostic[],
  parentReadPos: number,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;
    const readPos = nodeReadPos(anyN, parentReadPos);

    // Resolve any ExprNode payloads this node carries.
    for (const f of B3_EXPR_FIELDS) {
      const v = anyN[f];
      if (v && typeof v === "object") {
        resolveAtNameOnExprNode(v, currentScope, errors, readPos);
      }
    }
    // Special case for c-style for: `cStyleParts: { initExpr, condExpr,
    // updateExpr }`. Each sub-field carries an ExprNode root.
    if (anyN.cStyleParts && typeof anyN.cStyleParts === "object") {
      for (const f of ["initExpr", "condExpr", "updateExpr"]) {
        const v = anyN.cStyleParts[f];
        if (v && typeof v === "object") {
          resolveAtNameOnExprNode(v, currentScope, errors, readPos);
        }
      }
    }
    // For state-decl with `renderSpec` (decl-with-spec / Shape 2 forms),
    // the renderSpec may itself be (or contain) markup or an ExprNode. The
    // `forEachIdentInExprNode` walker silently no-ops on non-ExprNode shapes,
    // and the structural recursion below covers the markup case.

    if (kind === "state-decl") {
      // V-kill (S123): for `_isReactiveAssign`-tagged state-decls (bare
      // `@name = expr` writes inside fn/function/${} body contexts), fire
      // E-STATE-UNDECLARED if the target name has no structurally-declared
      // cell or import binding in scope. PASS 1 skipped registration for
      // these tags, so a `lookupStateCell` miss here is decisive — the write
      // would have silently synthesised a phantom cell pre-V-kill. See the
      // auto-state-cell-synthesis DD §6 + SPEC §6.1.1 + §6.2 + §6.1.3.
      if ((anyN as any)._isReactiveAssign === true && typeof anyN.name === "string") {
        // V-kill EXEMPTION (S123) — native-parser `.scrml` self-host mirrors.
        // The 5 files at `compiler/native-parser/parse-{css,error,markup,sql,state}-body.scrml`
        // are pre-M6-self-host source. They rely heavily on the legacy
        // auto-synth pattern (~176 fires aggregate). All five sunset at the
        // M6.7/M6.8 cutover when the JS native-parser becomes the only
        // implementation (the `.scrml` mirrors are deleted). Per pa.md Rule 3
        // (right answer beats easy answer): migrating files scheduled for
        // imminent deletion is wasted work; the SPEC normative rule (§6.1.1)
        // is preserved at the LANGUAGE level — this is an IMPLEMENTATION
        // exemption for source files in the M6 deletion queue. Sunset is
        // automatic — when the files disappear, the exemption becomes inert.
        // File path is read from the node's span (not scope's qualifiedPath,
        // which is the SCOPE's dotted compound-parent chain, NOT a file path).
        const filePath = (anyN.span && typeof anyN.span.file === "string") ? anyN.span.file : "";
        const isNativeParserSelfHost =
          filePath.includes("/compiler/native-parser/") &&
          filePath.endsWith(".scrml");
        if (isNativeParserSelfHost) {
          // Exempt — skip the fire. Sunsets at M6.7/M6.8.
          continue;
        }
        const targetName: string = anyN.name;
        const targetResolved = lookupStateCell(currentScope, targetName);
        if (!targetResolved) {
          const targetImp = lookupImportBinding(currentScope, targetName);
          if (!targetImp) {
            const declSpan = anyN.span ?? {
              file: currentScope.qualifiedPath || "",
              start: 0,
              end: 0,
              line: 1,
              col: 1,
            };
            errors.push({
              code: "E-STATE-UNDECLARED",
              message:
                `E-STATE-UNDECLARED: bare \`@${targetName} = ...\` write without a `
                + `structural declaration in scope. Reactive state cells SHALL be `
                + `declared via the structural form \`<${targetName}>\` (SPEC §6.1.1 + §6.2). `
                + `The canonical form \`@${targetName} = expr\` is a write to a `
                + `pre-declared cell, not a declaration. Fix: add a \`<${targetName}> = <init>\` `
                + `declaration before this write, or remove the \`@\` prefix if a `
                + `local identifier was intended.`,
              span: declSpan as Span,
              severity: "error",
            });
          }
        }
      }
      // Unit CC (S123 — companion to V-kill): for `_isUnitCCWrite`-tagged
      // state-decls (bare `@name = expr` writes at default-logic body-top —
      // the §40.8 auto-lifted `<program>` / `<page>` / `<channel>` body),
      // fire E-WRITE-NOT-IN-LOGIC-CONTEXT regardless of whether the target
      // cell is declared. Per the S122 user-voice Option-2 ratification,
      // §40.8 auto-lift covers DECLARATIONS only (`<x> = 0`, `function f()
      // { }`) — NOT writes. Writes are LOGIC; logic goes in `${...}`.
      //
      // The diagnostic is a SHAPE error, not a name-resolution error: the
      // cell may or may not exist; the wrong is the bare write at body-top.
      // PASS 1 deliberately STILL registers the auto-synthesised cell for
      // _isUnitCCWrite nodes (unlike V-kill which skips registration), so
      // downstream stages remain unchanged — only the loud diagnostic is
      // new. The user fixes by either:
      //   (a) wrapping the write in `${...}`: `${ @name = expr }`, OR
      //   (b) converting to a structural decl: `<name> = expr`.
      //
      // EXEMPTION: per-file path-based suppression for the 110-file corpus
      // that pre-dates Unit CC's enforcement. Each exempted file sunsets
      // per-file as adopters migrate (remove the file's path from
      // `unit-cc-exemption-list.json`). Sunset is intentionally manual
      // (vs V-kill's auto-sunset on file deletion) because these files are
      // not scheduled for deletion — they are adopter source that needs
      // migration. The exemption set is loaded once at module init time
      // (UNIT_CC_EXEMPT_SET); `isUnitCCExempt(filePath)` checks repo-
      // relative paths.
      if ((anyN as any)._isUnitCCWrite === true && typeof anyN.name === "string") {
        const filePath = (anyN.span && typeof anyN.span.file === "string") ? anyN.span.file : "";
        if (isUnitCCExempt(filePath)) {
          // Exempt — skip the fire. Sunset is per-file (remove entry from JSON).
          continue;
        }
        const targetName: string = anyN.name;
        const declSpan = anyN.span ?? {
          file: currentScope.qualifiedPath || "",
          start: 0,
          end: 0,
          line: 1,
          col: 1,
        };
        errors.push({
          code: "E-WRITE-NOT-IN-LOGIC-CONTEXT",
          message:
            `E-WRITE-NOT-IN-LOGIC-CONTEXT: bare \`@${targetName} = ...\` write at `
            + `default-logic body-top. Default-logic mode (SPEC §40.8) auto-lifts `
            + `DECLARATIONS only (\`<${targetName}> = ...\`, \`function f() {}\`) — `
            + `NOT writes. Writes are logic; wrap in \`\${...}\`: `
            + `\`\${ @${targetName} = ... }\`. `
            + `Alternative: if this was meant to be a declaration, use the `
            + `structural form \`<${targetName}> = ...\`.`,
          span: declSpan as Span,
          severity: "error",
        });
      }
      // Use the compound sub-scope for nested @-refs inside compound bodies.
      const stateScope = (anyN as ReactiveDeclNode & ScopeAnnotated)._scope;
      if (stateScope && Array.isArray(anyN.children)) {
        walkResolveAtNames(anyN.children, stateScope, visited, errors, readPos);
      }
      continue;
    }

    if (kind === "function-decl") {
      // Use the function scope PASS 1 attached.
      const fnScope = (anyN as ScopeAnnotated)._scope ?? currentScope;
      walkResolveAtNames(anyN.body, fnScope, visited, errors, readPos);
      continue;
    }

    // Generic recursion. Same shape as PASS 1 / PASS 2.
    if (Array.isArray(anyN.children)) walkResolveAtNames(anyN.children, currentScope, visited, errors, readPos);
    if (Array.isArray(anyN.body)) walkResolveAtNames(anyN.body, currentScope, visited, errors, readPos);
    if (Array.isArray(anyN.consequent)) walkResolveAtNames(anyN.consequent, currentScope, visited, errors, readPos);
    if (Array.isArray(anyN.alternate)) walkResolveAtNames(anyN.alternate, currentScope, visited, errors, readPos);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkResolveAtNames(arm.body, currentScope, visited, errors, readPos);
      }
    }
    // Phase A10 (S78) — load-bearing branch. Every `@cell` reference inside
    // an engine state-child body (event handlers, ${...} interpolation,
    // attribute expressions, transition writes) MUST resolve. Without this
    // recursion, `<button onclick=${@phase = .Loading}>Retry</button>` inside
    // an Error state-child body would leave `@phase` unresolved (no
    // _resolvedStateCell stamp) — downstream B22 reset-target / B8 derived-
    // mutate / TS-stage scope checks all rely on the stamp. Body content
    // inherits the surrounding scope (file scope at engine-decl site +
    // engine var registered by PASS 10.A).
    //
    // Payload-binding scope injection (e.g., `<Error msg>` introducing `msg`
    // as a local in the arm body sub-scope) is handled by the type-system
    // pass (`type-system.ts` engine-decl case, S81 Phase A10 follow-on).
    // B3 here resolves `@`-prefixed identifiers (state cells); bare-identifier
    // references inside arm bodies (e.g., `${msg}`) are TS territory.
    if (kind === "engine-decl" && Array.isArray(anyN.bodyChildren)) {
      walkResolveAtNames(anyN.bodyChildren, currentScope, visited, errors, readPos);
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkResolveAtNames([anyN.expr.node], currentScope, visited, errors, readPos);
    }
  }
}

// ---------------------------------------------------------------------------
// B5: Cell classifier (PASS 4)
// ---------------------------------------------------------------------------
//
// Walks every registered state-cell record (recovered via the scope tree) and
// classifies its decl node into one of four `CellKind` values. Stamps both
// `_cellKind` and `_isBindable` on the AST decl as non-enumerable properties.
//
// Why iterate the scope tree (not the raw AST)? Every state-decl was
// registered into a scope's `stateCells` map by PASS 1 — that's the canonical
// inventory. Walking it directly:
//   1. Skips ALL non-state-decl nodes (no shape predicates needed).
//   2. Naturally descends into compound sub-scopes (each child's `_record` is
//      already in the compound scope's map).
//   3. Avoids touching engine/component bodies (they're raw text today; their
//      future scopes will simply be empty maps until B14+/B17+ register).
//
// No diagnostics fired. B6 reads `_cellKind` to decide render-vs-error; B7
// reads `_cellKind === "plain" | "markup-typed"` + `record.isConst` to filter
// derived-cell dep-DAG inputs.

/**
 * The canonical bindable HTML element set. Mirrors
 * `codegen/emit-html.ts:19-20` BIND_DIRECTIVE_TAGS["bind:value"]. If this
 * set drifts, both sites must update — a single-line change in each.
 */
const B5_BINDABLE_TAGS: ReadonlySet<string> = new Set(["input", "textarea", "select"]);

/**
 * Classify a single state-decl node. Pure switch over A1a Step 4-6 fields:
 * `children` (Variant C parent), `isConst` (Shape 3 derived), `renderSpec`
 * (markup RHS), `renderSpec.element.tag` (bindable set).
 *
 * Algorithm (in priority order):
 *   1. `children` is an array (incl. empty `[]`)            → "compound-parent"
 *   2. `isConst === true` AND `renderSpec` present          → "markup-typed"
 *   3. `isConst === true` (non-markup derived)              → "plain"
 *   4. `renderSpec.element.tag` ∈ {input, textarea, select} → "bindable"
 *   5. `renderSpec` present (non-bindable tag, non-const)   → "markup-typed"
 *   6. Otherwise (Shape 1)                                  → "plain"
 *
 * Notes:
 *   - Step 2 captures Shape 3 markup-typed derived (`const <badge> = <span>...`).
 *     ast-builder routes the markup into `renderSpec` today — see
 *     `tests/integration/kickstarter-v2-smoke.test.js:278-296`.
 *   - Step 5 is defensive: a structural decl with markup RHS that ISN'T
 *     bindable AND isn't `const` is currently classified as markup-typed so
 *     B6's `<varname/>` use-site can render the markup. A1b/B6 may later
 *     tighten and reject this form.
 */
function classifyStateDecl(decl: ReactiveDeclNode): CellKind {
  if (Array.isArray(decl.children)) return "compound-parent";
  const renderSpec = decl.renderSpec;
  const renderTag = renderSpec && renderSpec.element ? renderSpec.element.tag : undefined;
  if (decl.isConst === true) {
    return renderSpec ? "markup-typed" : "plain";
  }
  if (renderTag && B5_BINDABLE_TAGS.has(renderTag)) return "bindable";
  if (renderSpec) return "markup-typed";
  return "plain";
}

/**
 * Stamp `_cellKind` + `_isBindable` on a single decl. Non-enumerable to keep
 * structural-walker invariants intact (mirrors B1's `_record` choice).
 */
function annotateCellKind(decl: ReactiveDeclNode, kind: CellKind): void {
  Object.defineProperty(decl, "_cellKind", {
    value: kind,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(decl, "_isBindable", {
    value: kind === "bindable",
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/**
 * Walk the AST classifying every `state-decl` node. Mirrors PASS 1's recursion
 * shape (children/body/consequent/alternate/arms/lift-expr) so any state-decl
 * that PASS 1 registered is also reached here. Variant C compound children are
 * naturally covered: a compound parent's `children[]` contains nested
 * state-decl nodes which the recursion descends into.
 */
function walkClassifyCells(
  nodes: ASTNode[] | undefined,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    if (kind === "state-decl") {
      const decl = n as ReactiveDeclNode;
      const cellKind = classifyStateDecl(decl);
      annotateCellKind(decl, cellKind);
      // Descend into compound children (each child is itself a state-decl).
      if (Array.isArray(decl.children)) {
        walkClassifyCells(decl.children as ASTNode[], visited);
      }
      continue;
    }

    if (kind === "function-decl") {
      walkClassifyCells(anyN.body, visited);
      continue;
    }

    if (Array.isArray(anyN.children)) walkClassifyCells(anyN.children, visited);
    if (Array.isArray(anyN.body)) walkClassifyCells(anyN.body, visited);
    if (Array.isArray(anyN.consequent)) walkClassifyCells(anyN.consequent, visited);
    if (Array.isArray(anyN.alternate)) walkClassifyCells(anyN.alternate, visited);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkClassifyCells(arm.body, visited);
      }
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkClassifyCells([anyN.expr.node], visited);
    }
  }
}

// ---------------------------------------------------------------------------
// B6: Render-by-tag classifier (PASS 5)
// ---------------------------------------------------------------------------
//
// Walks every MarkupNode in the AST. For each lowercase self-closed tag
// (`<x/>`) that resolves to a registered state cell, fires one of:
//
//   E-CELL-NO-RENDER-SPEC          — cell has no render-spec (Shape 1, Shape 3
//                                    derived plain, Shape 3 markup-typed
//                                    derived, or Variant C compound parent).
//   E-CELL-RENDER-SPEC-NOT-BINDABLE — Shape 2 with non-bindable RHS markup
//                                    (e.g., `<msg> = <div>...</div>`). Use
//                                    Shape 3 (`const`) for display-only markup.
//
// The walker reads B5's `_cellKind` annotation + `decl.isConst` to disambiguate
// the spec-distinct cases collapsed into B5's `"markup-typed"` bucket:
//
//   markup-typed && isConst === true  → Shape 3 markup-typed derived
//                                       → E-CELL-NO-RENDER-SPEC (SPEC §6.6.17 line 3027)
//   markup-typed && isConst === false → Shape 2 non-bindable RHS
//                                       → E-CELL-RENDER-SPEC-NOT-BINDABLE
//
// **Phase 0 dispositions (Bryan-ratified):**
//
//   §3.1 — Compound-parent self-tag (`<formRes/>`) fires E-CELL-NO-RENDER-SPEC.
//          Spec is silent on this exact form; the spec-faithful extension
//          treats compound parents as "cell has no render-spec" (compound
//          parents structurally have `children[]`, mutually exclusive with
//          `renderSpec`). Error message tightens to mention the wrapping form
//          (`<formRes><field/></>`) and `${@formRes.field}` interpolation as
//          spec-canonical alternatives.
//
//   §3.2 — Component RHS render-specs (PascalCase tag in the decl's renderSpec,
//          e.g., `<x> = <MyComp/>`) are DEFERRED. SPEC line 1341 requires
//          component-prop-catalog inspection (B14/M18/M20 territory); B6 v1
//          accepts these silently rather than mis-firing. PascalCase USE-sites
//          (`<MyComponent/>` in markup) are also accepted — the lowercase-tag
//          predicate filters them out before lookup.
//
// **Use-site detection.** A render-by-tag use is:
//   1. `node.kind === "markup"`
//   2. `node.selfClosing === true`
//   3. `node.tag` starts with a lowercase letter (`/^[a-z]/`)
//   4. `lookupStateCell(fileScope, node.tag)` returns non-null
//
// Step 3 is the deferral filter (Phase 0 §3.2). Step 4 is the decisive filter
// — HTML built-ins (`<br/>`, `<input/>`, `<img/>`, ...) are also self-closed
// lowercase markup, but they don't resolve to a state cell, so the walker
// no-ops on them.
//
// **Scope handling.** B6 uses file-scope lookup (`lookupStateCell(fileScope,
// tag)`). Compound sub-scope cells are not addressable as bare `<childName/>`
// from outside the compound — they're addressed as `<parent><childName/></>`
// (the wrapping form, SPEC line 1882). File-scope lookup matches the spec's
// documented use-cases. A compound-internal sibling render-by-tag (rare; only
// possible inside a Shape 3 markup-typed RHS that contains a sibling tag) is
// a known scope-limitation noted in Phase 0 §2.4.

const B6_NO_RENDER_SPEC = "E-CELL-NO-RENDER-SPEC";
const B6_NOT_BINDABLE = "E-CELL-RENDER-SPEC-NOT-BINDABLE";

/** Minimal MarkupNode shape we read here. Avoids importing the full type. */
interface MinimalMarkupNode {
  kind: "markup";
  tag: string;
  selfClosing: boolean;
  span: Span;
  children?: ASTNode[];
}

/**
 * Build the diagnostic for E-CELL-NO-RENDER-SPEC at a `<tag/>` use-site.
 * Message text mirrors §34 line 14205 + tightens for compound parents.
 */
function makeNoRenderSpecDiagnostic(
  use: MinimalMarkupNode,
  decl: ReactiveDeclNode,
  cellKind: CellKind,
): SYMDiagnostic {
  const cellName = decl.name;
  let alternatives: string;
  if (cellKind === "compound-parent") {
    // Phase 0 §3.1 — compound-parent message tightening.
    alternatives =
      `Compound parents have no individual render-spec. Use the wrapping form `
      + `\`<${cellName}><field/></>\` to render a child cell, or \`\${@${cellName}.field}\` `
      + `interpolation to display a field's value.`;
  } else {
    alternatives = `Use \`\${@${cellName}}\` interpolation to display the value.`;
  }
  return {
    code: B6_NO_RENDER_SPEC,
    message:
      `${B6_NO_RENDER_SPEC}: \`<${cellName}/>\` used as render-by-tag in markup, but `
      + `the cell has no render-spec (${describeShape(cellKind, decl)}). ${alternatives} `
      + `(SPEC §6.4 + §34.)`,
    span: use.span,
    severity: "error",
  };
}

/**
 * Build the diagnostic for E-CELL-RENDER-SPEC-NOT-BINDABLE at a `<tag/>`
 * use-site. The decl is Shape 2 with a non-bindable HTML element as the RHS
 * markup (e.g., `<msg> = <div>...</div>`). Spec mandates Shape 3 (`const`)
 * for display-only markup cells.
 */
function makeNotBindableDiagnostic(
  use: MinimalMarkupNode,
  decl: ReactiveDeclNode,
): SYMDiagnostic {
  const cellName = decl.name;
  const renderTag = decl.renderSpec?.element?.tag ?? "(non-bindable)";
  return {
    code: B6_NOT_BINDABLE,
    message:
      `${B6_NOT_BINDABLE}: \`<${cellName}/>\` render-by-tag use is illegal — `
      + `the cell's render-spec root is \`<${renderTag}>\`, which is not a bindable `
      + `form element. Shape 2 (\`<${cellName}> = <markup>\`) requires a bindable `
      + `element (input, textarea, select). For display-only markup, use Shape 3: `
      + `\`const <${cellName}> = <${renderTag}>...</${renderTag}>\` and reference via `
      + `\`\${@${cellName}}\` interpolation. (SPEC §6.2 + §34.)`,
    span: use.span,
    severity: "error",
  };
}

/**
 * Brief shape descriptor for the diagnostic message.  Spec-faithful enumeration
 * matching §34 row text + Phase 0 §3.1 extension for compound-parent.
 */
function describeShape(cellKind: CellKind, decl: ReactiveDeclNode): string {
  switch (cellKind) {
    case "plain":
      return decl.isConst === true
        ? "Shape 3 non-markup derived"
        : "Shape 1 plain cell";
    case "markup-typed":
      // Only reached via the isConst === true branch (markup-typed derived).
      return "Shape 3 markup-typed derived — derived cells do not have render-specs (SPEC §6.6.17)";
    case "compound-parent":
      return "Variant C compound parent";
    case "bindable":
      // Defensive — bindable should not reach this fn.
      return "Shape 2 bindable";
  }
}

/**
 * Check a single MarkupNode for render-by-tag use. If it qualifies as a
 * use-site (lowercase self-closed tag matching a registered cell), apply the
 * cell-kind switch and push the appropriate diagnostic. Returns silently for
 * non-use-site nodes.
 */
function checkRenderByTag(
  node: MinimalMarkupNode,
  fileScope: Scope,
  errors: SYMDiagnostic[],
): void {
  if (!node.selfClosing) return;
  if (typeof node.tag !== "string" || node.tag.length === 0) return;
  // Phase 0 §3.2 — PascalCase use-sites are deferred (component territory).
  const first = node.tag.charCodeAt(0);
  // Lowercase letter range: 'a'-'z' = 97-122. Anything outside (uppercase,
  // digits, special) is not a state-cell render-by-tag use.
  if (first < 97 || first > 122) return;
  const decl = lookupStateCell(fileScope, node.tag);
  if (!decl) return; // HTML built-in, unresolved tag, or compound child — out of scope.
  const declNode = decl.declNode;
  const cellKind = getCellKind(declNode);
  if (cellKind === undefined) return; // not classified — defensive (shouldn't happen post-PASS-4).
  switch (cellKind) {
    case "bindable":
      // Shape 2 with bindable HTML root — accept.
      return;
    case "plain":
      // Shape 1 plain OR Shape 3 non-markup derived — both fire.
      errors.push(makeNoRenderSpecDiagnostic(node, declNode, cellKind));
      return;
    case "compound-parent":
      // Phase 0 §3.1 — spec-silent extension; fire E-CELL-NO-RENDER-SPEC.
      errors.push(makeNoRenderSpecDiagnostic(node, declNode, cellKind));
      return;
    case "markup-typed": {
      const isConst = declNode.isConst === true;
      if (isConst) {
        // Shape 3 markup-typed derived (SPEC §6.6.17 line 3027). Fires
        // E-CELL-NO-RENDER-SPEC regardless of whether the RHS markup looks
        // bindable — derived cells do not have render-specs.
        errors.push(makeNoRenderSpecDiagnostic(node, declNode, cellKind));
        return;
      }
      // Shape 2 non-bindable RHS — but defer if PascalCase RHS (component).
      // Phase 0 §3.2 — deferred to B14/M18/M20 component-prop-catalog work.
      const renderTag = declNode.renderSpec?.element?.tag;
      if (typeof renderTag === "string" && renderTag.length > 0) {
        const rFirst = renderTag.charCodeAt(0);
        if (rFirst >= 65 && rFirst <= 90) {
          // PascalCase RHS — component render-spec; needs prop-catalog.
          // B6 v1 accepts silently; B14/M18/M20 will extend with the
          // bindable-prop check.
          return;
        }
      }
      errors.push(makeNotBindableDiagnostic(node, declNode));
      return;
    }
  }
}

/**
 * Walk the AST checking every MarkupNode for render-by-tag use. Mirrors
 * PASS-1's recursion shape (children/body/consequent/alternate/arms/lift-expr)
 * with the added discrimination that `kind === "markup"` triggers the
 * use-site check before recursing into the markup's own `children`.
 *
 * State-decl nodes are recursed-into for compound children but their own
 * `renderSpec` markup is NOT walked — the renderSpec markup is the cell's
 * VALUE, not a render-by-tag use surface. Walking it would mis-fire on
 * legitimate markup like the `<input/>` inside a Shape 2 RHS.
 */
function walkRenderByTagUses(
  nodes: ASTNode[] | undefined,
  fileScope: Scope,
  visited: WeakSet<object>,
  errors: SYMDiagnostic[],
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    if (kind === "markup") {
      // Use-site check on this markup node BEFORE recursion. Recursion is
      // unconditional — even if this node is a self-closed render-by-tag
      // that fires, descendants (none, by selfClosing definition) are still
      // walked for consistency. For non-self-closed markup, children are
      // walked normally.
      checkRenderByTag(n as MinimalMarkupNode, fileScope, errors);
      if (Array.isArray(anyN.children)) {
        walkRenderByTagUses(anyN.children, fileScope, visited, errors);
      }
      continue;
    }

    if (kind === "state-decl") {
      // Don't walk renderSpec markup (the cell's value, not a use-site).
      // DO descend into compound children, but render-by-tag inside a
      // compound's nested context is rare and uses the file-scope lookup
      // (matching Phase 0 §2.4 limitation note).
      if (Array.isArray(anyN.children)) {
        walkRenderByTagUses(anyN.children, fileScope, visited, errors);
      }
      continue;
    }

    if (kind === "function-decl") {
      walkRenderByTagUses(anyN.body, fileScope, visited, errors);
      continue;
    }

    // Generic recursion (mirrors PASS-1 shape).
    if (Array.isArray(anyN.children)) walkRenderByTagUses(anyN.children, fileScope, visited, errors);
    if (Array.isArray(anyN.body)) walkRenderByTagUses(anyN.body, fileScope, visited, errors);
    if (Array.isArray(anyN.consequent)) walkRenderByTagUses(anyN.consequent, fileScope, visited, errors);
    if (Array.isArray(anyN.alternate)) walkRenderByTagUses(anyN.alternate, fileScope, visited, errors);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkRenderByTagUses(arm.body, fileScope, visited, errors);
      }
    }
    // Phase A10 (S78) — descend into engine-decl.bodyChildren so render-by-tag
    // use-sites (e.g., `<derivedName/>` inside an engine state-child body)
    // are validated. Walks with file-scope (B6 lookups are file-scoped).
    if (kind === "engine-decl" && Array.isArray(anyN.bodyChildren)) {
      walkRenderByTagUses(anyN.bodyChildren, fileScope, visited, errors);
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkRenderByTagUses([anyN.expr.node], fileScope, visited, errors);
    }
  }
}

// ---------------------------------------------------------------------------
// B8: L21 walker — E-DERIVED-VALUE-MUTATE (PASS 6)
// ---------------------------------------------------------------------------
//
// Per SPEC §6.6.18 (lock L21), in-place mutation of a `const`-derived cell
// SHALL be rejected at compile time. Three forbidden form classes:
//
//   1. Array mutating method calls — `@derivedArr.push(x)`, etc. (9 methods
//      per §6.5.1: push, pop, shift, unshift, splice, reverse, sort, fill,
//      copyWithin).
//   2. Object property writes / compound-assignments / delete —
//      `@derivedObj.foo = x`, `@derivedObj.foo += 1`, `delete @derivedObj.foo`,
//      and the 14 compound forms (+=, -=, *=, /=, %=, **=, &=, |=, ^=, <<=,
//      >>=, >>>=, ??=, ||=, &&=).
//   3. In-compound derived sub-cell — `@form.derivedField.method(...)` /
//      `@form.derivedField.foo = x` where `derivedField` is `const`-declared
//      inside a Variant C compound parent.
//
// AST shape paths (per `tests/integration/parse-mutation-shapes.test.js`):
//
//   - `reactive-array-mutation` (specialized lowering, single-segment receiver,
//     method ∈ ARRAY_MUTATIONS) → check via `target` string + `method`.
//   - `reactive-nested-assign` (specialized lowering, `=` only) → check via
//     `target` string + `path[]`.
//   - `bare-expr` containing one of:
//       - `assign` (compound assigns; computed-index assigns; multi-segment
//         receivers; plain `=` on chained members) → check via leaf-ident
//         walk on `target`.
//       - `call` with `callee.kind === "member"` and method name ∈
//         ARRAY_MUTATING_METHODS — covers compound-receiver chains
//         `@form.errors.push(x)`.
//       - `unary` with `op === "delete"` and `argument.kind ∈ {"member",
//         "index"}` → check via leaf-ident walk on `argument`.
//
// **NEXT-STEP HOOK (E-DERIVED-WRITE):** §6.6.18 normative requires this check
// to share a pass with §6.6.8 E-DERIVED-WRITE (reassignment form). When that
// rule is implemented, it should join this walker — `@derived = newval` is an
// `assign` ExprNode whose `target` is a bare ident (not a member chain), so
// the dispatch is a sibling discriminator, not a separate walk.
//
// **OUT OF B8 SCOPE (deferred):**
//   - E-SYNTHESIZED-WRITE (§55.7) — depends on B11/B12's synth-cell registry
//     which doesn't exist yet. B11 will extend this walker.
//   - Markup-typed derived cells: per §6.6.18, the rule applies uniformly;
//     markup APIs today expose no mutators so the rule is non-firing in
//     practice but no special exemption is needed in the walker.

/**
 * Walk a chained member/index expression to its leaf IdentExpr. Mirrors the
 * `leafIdent` helper in `tests/integration/parse-mutation-shapes.test.js`.
 * Returns the leaf `ident` ExprNode, or null if the chain doesn't terminate
 * in an ident (e.g., `(@a)[0]` parens-wrapped — defensive).
 */
function leafIdentInChain(node: any): any | null {
  let cur = node;
  while (cur && typeof cur === "object") {
    if (cur.kind === "ident") return cur;
    if (cur.kind === "member") { cur = cur.object; continue; }
    if (cur.kind === "index") { cur = cur.object; continue; }
    return null;
  }
  return null;
}

/**
 * Collect dotted-path segments from a chained member/index expression.
 * Stops at the leaf ident; returns segments in receiver-to-leaf order
 * EXCLUDING the leaf ident's name. Computed-index segments produce no
 * string segment (compound nav must use static dotted paths to find a
 * registered sub-cell — `@form[i]` cannot resolve to a named compound child).
 *
 * Returns `null` if the chain terminates in something other than an ident
 * (defensive — same shape as leafIdentInChain).
 */
function collectMemberPath(node: any): string[] | null {
  const segments: string[] = [];
  let cur = node;
  while (cur && typeof cur === "object") {
    if (cur.kind === "ident") {
      segments.reverse();
      return segments;
    }
    if (cur.kind === "member") {
      // `member.property` is a static string per ESTree-flat scrml AST.
      if (typeof cur.property === "string") segments.push(cur.property);
      cur = cur.object;
      continue;
    }
    if (cur.kind === "index") {
      // Computed index — cannot contribute to a static path. Bail; B8
      // resolves the BASE cell via leaf ident only (case 2-3 still fires
      // when the base is derived; sub-path resolution unavailable).
      return null;
    }
    return null;
  }
  return null;
}

/**
 * Build the full path used to look up the receiver cell record in the scope:
 * `[leafIdentNameWithoutAt, ...memberPathSegments]`. The leaf ident's `@`
 * prefix is stripped. For a single-segment receiver (e.g., `@arr` in
 * `@arr.push(1)`), returns `["arr"]`. For a compound receiver
 * (e.g., `@form.errors` in `@form.errors.push(1)`), returns `["form", "errors"]`.
 */
function buildReceiverPath(chainRoot: any): string[] | null {
  const leaf = leafIdentInChain(chainRoot);
  if (!leaf || typeof leaf.name !== "string") return null;
  if (!leaf.name.startsWith("@")) return null;
  const baseName = leaf.name.slice(1);
  if (!baseName) return null;
  const segments = collectMemberPath(chainRoot);
  if (segments === null) return null;
  return [baseName, ...segments];
}

/**
 * Resolve a receiver chain to its `StateCellRecord` if any, returning the
 * record + the qualified path used to look it up. The record's `isConst`
 * field tells the caller whether this is a derived cell.
 *
 * For specialized-lowering kinds (`reactive-array-mutation`,
 * `reactive-nested-assign`), the caller passes the constructed path
 * directly (cheaper than walking the ExprNode).
 */
function resolveReceiverRecord(
  scope: Scope,
  path: string[],
): StateCellRecord | null {
  if (path.length === 0) return null;
  if (path.length === 1) return lookupStateCell(scope, path[0]);
  return lookupQualifiedStateCell(scope, path);
}

/**
 * Construct a synthetic Span for a B8 diagnostic anchored at the AST node
 * that carries the mutation. Mirrors B6/B4 synthetic-span pattern: `start`
 * and `end` may be 0 if the underlying ExprNode lacks reliable absolute
 * offsets, but `file` is always set.
 */
function spanFromMutationNode(node: any, fileFromScope: string): Span {
  const sp = node && node.span;
  return {
    file: (sp && typeof sp.file === "string" && sp.file.length > 0)
      ? sp.file
      : fileFromScope,
    start: typeof sp?.start === "number" ? sp.start : 0,
    end: typeof sp?.end === "number" ? sp.end : 0,
    line: typeof sp?.line === "number" ? sp.line : 1,
    col: typeof sp?.col === "number" ? sp.col : 1,
  };
}

/**
 * Build the human-readable cell-reference string used in diagnostic messages.
 * `["form", "derivedField"]` → `"@form.derivedField"`. For single-segment,
 * `["doubled"]` → `"@doubled"`.
 */
function formatReceiver(path: string[]): string {
  return "@" + path.join(".");
}

/**
 * Fire E-DERIVED-VALUE-MUTATE for a method-call form (case 1).
 * Caller has already verified the receiver resolves to a derived cell.
 */
function fireMethodCall(
  errors: SYMDiagnostic[],
  receiverPath: string[],
  method: string,
  span: Span,
): void {
  const ref = formatReceiver(receiverPath);
  errors.push({
    code: "E-DERIVED-VALUE-MUTATE",
    message:
      `E-DERIVED-VALUE-MUTATE: in-place mutation of derived cell \`${ref}\` `
      + `via \`.${method}(...)\`. \`${ref}\` is \`const\`-derived; mutating its `
      + `value is forbidden — the mutation would be silently clobbered the next `
      + `time upstream dependencies fire (SPEC §6.6.18 + §34). Fix: mutate the `
      + `upstream cell instead, or declare a separate mutable cell for `
      + `independent storage.`,
    span,
    severity: "error",
  });
}

/**
 * Fire E-DERIVED-VALUE-MUTATE for a property-assignment form (case 2 plain
 * `=` or compound-assign `+=` etc.).
 */
function firePropertyAssign(
  errors: SYMDiagnostic[],
  receiverPath: string[],
  op: string,
  pathTail: string[],
  span: Span,
): void {
  const ref = formatReceiver(receiverPath);
  const tailDesc = pathTail.length > 0 ? `.${pathTail.join(".")}` : "";
  errors.push({
    code: "E-DERIVED-VALUE-MUTATE",
    message:
      `E-DERIVED-VALUE-MUTATE: in-place mutation of derived cell \`${ref}\` `
      + `via property write \`${ref}${tailDesc} ${op} ...\`. \`${ref}\` is `
      + `\`const\`-derived; mutating its value is forbidden — the mutation `
      + `would be silently clobbered the next time upstream dependencies `
      + `fire (SPEC §6.6.18 + §34). Fix: mutate the upstream cell instead, `
      + `or declare a separate mutable cell for independent storage.`,
    span,
    severity: "error",
  });
}

/**
 * Fire E-DERIVED-VALUE-MUTATE for a delete form (`delete @derivedObj.foo`).
 */
function fireDelete(
  errors: SYMDiagnostic[],
  receiverPath: string[],
  span: Span,
): void {
  const ref = formatReceiver(receiverPath);
  errors.push({
    code: "E-DERIVED-VALUE-MUTATE",
    message:
      `E-DERIVED-VALUE-MUTATE: in-place mutation of derived cell \`${ref}\` `
      + `via \`delete\`. \`${ref}\` is \`const\`-derived; deleting properties of `
      + `its value is forbidden — the deletion would be silently clobbered the `
      + `next time upstream dependencies fire (SPEC §6.6.18 + §34). Fix: mutate `
      + `the upstream cell instead, or declare a separate mutable cell.`,
    span,
    severity: "error",
  });
}

/**
 * Scan path prefixes longest→shortest, looking for a registered StateCell
 * record. The deepest registered record on the prefix is the leaf cell
 * (handles single-segment `["copy"]` and compound-nav
 * `["form", "derivedField"]` uniformly).
 *
 * Returns the matched record + the prefix path that resolved it, or null.
 */
function findDeepestRegisteredOnPrefix(
  scope: Scope,
  fullPath: string[],
): { record: StateCellRecord; path: string[] } | null {
  for (let len = fullPath.length; len >= 1; len--) {
    const prefix = fullPath.slice(0, len);
    const rec = resolveReceiverRecord(scope, prefix);
    if (rec) return { record: rec, path: prefix };
  }
  return null;
}

/**
 * Fire E-DERIVED-VALUE-MUTATE for an assign-form (`+=`, plain `=`, etc.) when
 * the receiver chain root resolves to a derived cell. Returns true if fired.
 *
 * `assignNode.target` is the (member|index) being assigned to; the receiver
 * is `assignNode.target.object`. `fullReceiverPath` was built from that
 * object.
 */
function scanPrefixesAndFireAssign(
  fullReceiverPath: string[],
  assignNode: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  containerSpan: Span,
): boolean {
  const hit = findDeepestRegisteredOnPrefix(scope, fullReceiverPath);
  if (!hit || !hit.record.isConst) return false;
  // Compute the property tail — segments AFTER the matched derived cell, plus
  // the final assigned property.
  const tail: string[] = fullReceiverPath.slice(hit.path.length);
  if (assignNode.target.kind === "member" && typeof assignNode.target.property === "string") {
    tail.push(assignNode.target.property);
  } else if (assignNode.target.kind === "index") {
    tail.push("[…]");
  }
  firePropertyAssign(errors, hit.path, assignNode.op, tail, containerSpan);
  return true;
}

/**
 * Inspect an ExprNode subtree for embedded mutation forms targeting a
 * derived cell. Walks `assign`, `call`, and `unary` expressions; for each
 * matching shape that resolves to a derived receiver, fires the
 * appropriate diagnostic.
 *
 * `containerSpan` is the source-anchor for diagnostic spans (the enclosing
 * statement-level node); ExprNode spans are not reliable absolute offsets
 * (see B3 doc).
 */
function checkExprNodeForMutations(
  exprNode: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  containerSpan: Span,
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  const seen = new WeakSet<object>();
  function walk(n: any): void {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    const k = n.kind;
    if (k === "assign" && n.target && typeof n.op === "string"
        && (n.target.kind === "member" || n.target.kind === "index")
        && isDerivedMutatingAssignOp(n.op)) {
      // B11 extension: check FIRST for synth-property writes at compound
      // scope. E-SYNTHESIZED-WRITE is the more specific rule — fire it when
      // applicable, then short-circuit the derived-mutate check (the dev's
      // intent is "I'm trying to set a synth surface property", which is a
      // distinct error class with distinct fix-advice from "I'm mutating a
      // derived cell").
      const synthFired = checkSynthAssignFire(n, scope, errors, containerSpan);
      if (synthFired) {
        // Don't double-fire derived-mutate — the synth message is canonical.
        // Continue ExprNode descent for nested mutations elsewhere.
      } else {
        // The receiver chain is `n.target.object` (everything BEFORE the
        // final property/index segment). The final segment IS the assign
        // target; it's not part of the receiver path.
        const fullPath = buildReceiverPath(n.target.object);
        if (fullPath) {
          // Walk prefixes longest→shortest; the deepest registered record is
          // the leaf cell (covers single-segment `["copy"]`, compound-nav
          // `["form", "derivedField"]`, etc.). Fire if `isConst`.
          const fired = scanPrefixesAndFireAssign(fullPath, n, scope, errors, containerSpan);
          // (no-op when not derived; scan returns boolean for future use)
          void fired;
        }
      }
    }
    if (k === "call" && n.callee && n.callee.kind === "member"
        && typeof n.callee.property === "string"
        && ARRAY_MUTATING_METHODS.has(n.callee.property)) {
      // The receiver is `n.callee.object` (everything BEFORE `.method`).
      const fullPath = buildReceiverPath(n.callee.object);
      if (fullPath) {
        const hit = findDeepestRegisteredOnPrefix(scope, fullPath);
        if (hit && hit.record.isConst) {
          fireMethodCall(errors, hit.path, n.callee.property, containerSpan);
        }
      }
    }
    if (k === "unary" && n.op === "delete" && n.argument
        && (n.argument.kind === "member" || n.argument.kind === "index")) {
      // The DELETED property is `n.argument.property` (or computed index);
      // the receiver chain is `n.argument.object`.
      const fullPath = buildReceiverPath(n.argument.object);
      if (fullPath) {
        const hit = findDeepestRegisteredOnPrefix(scope, fullPath);
        if (hit && hit.record.isConst) {
          fireDelete(errors, hit.path, containerSpan);
        }
      }
    }
    // Recurse into structural sub-fields. ExprNode shapes carry various child
    // ExprNodes (operands, arguments, callees, properties, etc.). A generic
    // walk over enumerable object/array properties is sufficient and safe.
    for (const key of Object.keys(n)) {
      if (key === "span" || key === "_resolvedStateCell") continue;
      const v = (n as any)[key];
      if (v && typeof v === "object") {
        if (Array.isArray(v)) {
          for (const item of v) walk(item);
        } else {
          walk(v);
        }
      }
    }
  }
  walk(exprNode);
}

/**
 * Check a `reactive-array-mutation` AST node (specialized lowering, case 1).
 * Receiver is single-segment (`target` is the cell name); method is one of
 * the ARRAY_MUTATIONS list per ast-builder. We re-validate against the
 * canonical 9-method set from SPEC §6.5.1 (defensive — ast-builder list may
 * drift from spec).
 */
function checkReactiveArrayMutation(
  n: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  fileFromScope: string,
): void {
  if (typeof n.target !== "string" || typeof n.method !== "string") return;
  if (!ARRAY_MUTATING_METHODS.has(n.method)) return;
  const rec = lookupStateCell(scope, n.target);
  if (rec && rec.isConst) {
    fireMethodCall(errors, [n.target], n.method, spanFromMutationNode(n, fileFromScope));
  }
}

/**
 * Check a `reactive-nested-assign` AST node (specialized lowering, case 2
 * plain `=` on dotted-path receiver). Receiver path is `target` (cell name)
 * + `path[]` LESS the final segment (which is the assign target property).
 *
 * For `@obj.foo = 1` → `target: "obj"`, `path: ["foo"]`. The receiver IS
 * `@obj`; the property being assigned is `foo`.
 *
 * For `@form.config.mode = "x"` → `target: "form"`, `path: ["config", "mode"]`.
 * Receiver chain is `@form.config`; final assigned property is `mode`. To
 * fire correctly when the LEAF cell (`@form.config` resolved through compound
 * lookup) or the BASE cell (`@form`) is derived, we resolve the deepest
 * registered record on the prefix path and check `isConst`.
 */
function checkReactiveNestedAssign(
  n: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  fileFromScope: string,
): void {
  if (typeof n.target !== "string" || !Array.isArray(n.path)) return;
  // B11 extension: check FIRST for synth-property writes at compound scope.
  // If the target.path leaf is a synth-property name and the prefix resolves
  // to a compound parent, fire E-SYNTHESIZED-WRITE and short-circuit (audit
  // §1.3 — synth-write is more specific than derived-value-mutate).
  if (checkSynthNestedAssignFire(n, scope, errors, fileFromScope)) return;

  // Receiver path = [target, ...path[0..length-1]] — the assigned property
  // is the LAST element of `path` (or `path` itself is the property if
  // length === 1).
  // We try resolving from the longest prefix down. The deepest registered
  // record wins; if any registered record on the prefix is derived, fire.
  // Spec §6.6.18 case 2 fires when the receiver root resolves to a `const`-
  // declared cell — so we scan prefixes including [target] alone.
  const fullPrefix = [n.target, ...n.path.slice(0, n.path.length - 1)];
  // For length=1 path (e.g., `@obj.foo = x`), fullPrefix = ["obj"].
  // For length=2 path (e.g., `@form.config.mode = x`), fullPrefix = ["form", "config"].
  // Try the deepest qualified path first; if that doesn't resolve, walk shorter.
  let derivedRec: StateCellRecord | null = null;
  let derivedPath: string[] = [];
  for (let len = fullPrefix.length; len >= 1; len--) {
    const prefix = fullPrefix.slice(0, len);
    const rec = resolveReceiverRecord(scope, prefix);
    if (rec && rec.isConst) {
      derivedRec = rec;
      derivedPath = prefix;
      break;
    }
  }
  if (derivedRec) {
    const tail = n.path.slice(derivedPath.length - 1);
    firePropertyAssign(
      errors,
      derivedPath,
      "=",
      tail,
      spanFromMutationNode(n, fileFromScope),
    );
  }
}

/**
 * PASS 6 walker — descends the AST tree visiting every statement-level
 * node. For each candidate mutation form, dispatches to one of the three
 * checkers above. Mirrors the structural-recursion pattern used by PASS 3
 * (walkResolveAtNames) and PASS 5 (walkRenderByTagUses).
 */
function walkDerivedValueMutate(
  nodes: ASTNode[] | undefined,
  currentScope: Scope,
  visited: WeakSet<object>,
  errors: SYMDiagnostic[],
  fileFromScope: string,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    // Specialized-lowering kinds (case 1 single-segment, case 2 plain `=`).
    if (kind === "reactive-array-mutation") {
      checkReactiveArrayMutation(anyN, currentScope, errors, fileFromScope);
      // No body recursion — these are leaf statement nodes. argsExpr may
      // contain nested ExprNodes (e.g., `@a.push(@b.push(1))`); walk them
      // for nested mutations.
      if (anyN.argsExpr) {
        checkExprNodeForMutations(
          anyN.argsExpr,
          currentScope,
          errors,
          spanFromMutationNode(anyN, fileFromScope),
        );
      }
      continue;
    }
    if (kind === "reactive-nested-assign") {
      checkReactiveNestedAssign(anyN, currentScope, errors, fileFromScope);
      if (anyN.valueExpr) {
        checkExprNodeForMutations(
          anyN.valueExpr,
          currentScope,
          errors,
          spanFromMutationNode(anyN, fileFromScope),
        );
      }
      continue;
    }

    // Generic ExprNode-bearing nodes — walk all carried ExprNodes for
    // embedded mutations. Mirrors B3_EXPR_FIELDS coverage.
    const containerSpan = spanFromMutationNode(anyN, fileFromScope);
    for (const f of B3_EXPR_FIELDS) {
      const v = anyN[f];
      if (v && typeof v === "object") {
        checkExprNodeForMutations(v, currentScope, errors, containerSpan);
      }
    }
    if (anyN.cStyleParts && typeof anyN.cStyleParts === "object") {
      for (const f of ["initExpr", "condExpr", "updateExpr"]) {
        const v = anyN.cStyleParts[f];
        if (v && typeof v === "object") {
          checkExprNodeForMutations(v, currentScope, errors, containerSpan);
        }
      }
    }

    // Scope-aware recursion.
    if (kind === "state-decl") {
      const stateScope = (anyN as ReactiveDeclNode & ScopeAnnotated)._scope;
      if (stateScope && Array.isArray(anyN.children)) {
        walkDerivedValueMutate(anyN.children, stateScope, visited, errors, fileFromScope);
      }
      continue;
    }
    if (kind === "function-decl") {
      const fnScope = (anyN as ScopeAnnotated)._scope ?? currentScope;
      walkDerivedValueMutate(anyN.body, fnScope, visited, errors, fileFromScope);
      continue;
    }

    // Generic recursion (mirrors PASS 3 / PASS 5 structural recursion).
    if (Array.isArray(anyN.children)) walkDerivedValueMutate(anyN.children, currentScope, visited, errors, fileFromScope);
    if (Array.isArray(anyN.body)) walkDerivedValueMutate(anyN.body, currentScope, visited, errors, fileFromScope);
    if (Array.isArray(anyN.consequent)) walkDerivedValueMutate(anyN.consequent, currentScope, visited, errors, fileFromScope);
    if (Array.isArray(anyN.alternate)) walkDerivedValueMutate(anyN.alternate, currentScope, visited, errors, fileFromScope);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkDerivedValueMutate(arm.body, currentScope, visited, errors, fileFromScope);
      }
    }
    // Phase A10 (S78) — descend into engine-decl.bodyChildren so mutation
    // of a const-derived cell inside an engine state-child body fires
    // E-DERIVED-VALUE-MUTATE per L21. Body inherits the surrounding scope.
    if (kind === "engine-decl" && Array.isArray(anyN.bodyChildren)) {
      walkDerivedValueMutate(anyN.bodyChildren, currentScope, visited, errors, fileFromScope);
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkDerivedValueMutate([anyN.expr.node], currentScope, visited, errors, fileFromScope);
    }
  }
}

// ---------------------------------------------------------------------------
// B10: Validator type-check walker (PASS 7)
// ---------------------------------------------------------------------------
//
// Per SPEC §55.1 (universal-core vocabulary, L4) + §55.10 (4-level error
// message resolution chain, L12 Edge F). For every state-decl with
// validators, B10 looks up each validator against the
// `validator-catalog.ts` module's predicate signature catalog and verifies:
//
//   1. Predicate name is in the universal-core (14 predicates per §55.1).
//      Library-surface predicates (`email`/`url`/`numeric`/`integer` from
//      `scrml:data`) are NOT in the universal-core catalog; B10 silently
//      passes through unknown names — a future tightening will register
//      stdlib predicates and convert this to a strict reject.
//
//   2. Arity matches:
//      - bareword (args: null) → must be `arity: 0` or `"0+inline"` predicate
//      - call-form with 1 arg → leading slot must match required-shape
//      - call-form with 2 args → leading slot + trailing inline-message-override
//      - call-form with > 2 args → reject (no spec predicate takes more)
//
//   3. Per-positional-arg shape matches the catalog signature:
//      - `relational-predicate` slot ↔ RelationalPredicateNode (B9 sibling kind)
//      - `regex` slot ↔ ESTree-`Literal`-via-escape-hatch with raw=`/.../`
//                       OR a string literal (alternative-form acceptance)
//      - `numeric` slot ↔ NumLit ExprNode (or numeric-typed expression —
//                          for now any non-string literal accepted; deeper
//                          type-inference deferred)
//      - `comparable-with-cell` / `any-equatable-with-cell` slots ↔ any
//                          ExprNode (full cell-type compatibility deferred
//                          per audit §1.3 cost-control)
//      - `array-of-cell-type` slot ↔ ArrayLit ExprNode
//      - `inline-message-override` slot ↔ string literal (StringLit). Dynamic
//                          override (anything else) is fired as a separate
//                          diagnostic — though B13 ultimately owns the formal
//                          extraction + inline-override-record.
//
// Failures fire `E-TYPE-031` (the existing umbrella per §55.1 line 24295)
// with a per-violation descriptive message.
//
// **DEFERRED to follow-up steps:**
//   - Cell-type compatibility check (`pattern(re)` on a `number` cell): needs
//     type-system.ts type inference. Audit §1.3 budgets this for a later
//     tightening.
//   - B13 owns formal Level-1 inline-override extraction onto the validator
//     record + explicit dynamic-override rejection error code.
//   - Cycle detection (E-VALIDATOR-CIRCULAR-DEP) is Phase 3 of B10 and lives
//     in dependency-graph.ts (Stage 7) per audit §1.4.
//   - B3 cross-field `@cell` resolution is read by Phase 3 (cycle detection);
//     B10 Phase 2 (this walker) does shape checks only.
//
// **WHY HERE (not type-system.ts):** B10's check is symbol-table-shaped —
// iterates state-decls, reads decl.validators, dispatches per-arg. Doesn't
// need full type inference. Follows the B6/B8 walker pattern (PASS 5 / PASS 6).

import {
  lookupPredicate,
  type PredicateSignature,
  type PredicateArgKind,
} from "./validator-catalog.js";
import type { ValidatorEntry, ValidatorArg } from "./types/ast.js";

/**
 * Walker over the AST tree. For every `state-decl` node with `hasValidators`
 * set on its `_record` annotation, type-checks each validator entry against
 * the universal-core catalog. Mirrors the structural-recursion pattern used
 * by PASS 4 (walkClassifyCells) and PASS 5 (walkRenderByTagUses).
 *
 * Scope is parent-pointer-only (no `children` enumeration), so iteration is
 * AST-driven; the state-decl's `_record` back-pointer (set by PASS 1) is the
 * source of truth for "has validators?" without re-scanning the array.
 */
function walkValidatorTypeCheck(
  nodes: any,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) walkValidatorTypeCheck(n, errors, filePath, visited);
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes;
  const kind = node.kind;

  if (kind === "state-decl") {
    const record: StateCellRecord | undefined = (node as any)._record;
    if (record && record.hasValidators) {
      const validators: ValidatorEntry[] = (node as any).validators ?? [];
      for (const validator of validators) {
        checkValidator(validator, record, errors, filePath);
      }
    }
    // Recurse into compound children (each is a state-decl too).
    if (Array.isArray(node.children)) {
      walkValidatorTypeCheck(node.children, errors, filePath, visited);
    }
    // Don't descend into renderSpec / initExpr — validator AST is on the
    // decl node itself, not nested in init expressions.
    return;
  }

  // Generic recursion. Mirror the PASS 5 / PASS 6 structural walk.
  for (const k of [
    "body", "consequent", "alternate", "expr", "node", "renderSpec",
    "children", "value", "argument",
  ]) {
    if ((node as any)[k]) {
      walkValidatorTypeCheck((node as any)[k], errors, filePath, visited);
    }
  }
  if (Array.isArray((node as any).arms)) {
    for (const arm of (node as any).arms) {
      if (arm && Array.isArray(arm.body)) {
        walkValidatorTypeCheck(arm.body, errors, filePath, visited);
      }
    }
  }
}

/**
 * Check a single validator entry against its catalog signature.
 *
 * Fires E-TYPE-031 with a descriptive message per failure mode.
 */
function checkValidator(
  validator: ValidatorEntry,
  cellRecord: StateCellRecord,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const signature = lookupPredicate(validator.name);
  if (!signature) {
    // Unknown predicate name. May be a library-surface predicate
    // (`email`, `url`, `numeric`, `integer` from scrml:data) which has a
    // separate registration path. Silent pass-through; a future tightening
    // can convert this to a strict reject once stdlib predicates register.
    return;
  }

  const cellName = cellRecord.qualifiedPath || cellRecord.name;
  const span = (validator as any).span ?? cellRecord.declNode.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };

  const args = validator.args;

  // Arity check.
  if (signature.arity === 0) {
    // Strictly bareword. Currently no predicate uses this arity.
    if (args !== null) {
      errors.push({
        code: "E-TYPE-031",
        message:
          `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` is bareword-only; `
          + `it does not accept arguments. Remove the parentheses (SPEC §55.1).`,
        span,
        severity: "error",
      });
    }
    return;
  }

  if (signature.arity === "0+inline") {
    // Bareword OR one optional trailing string-literal inline-override.
    if (args === null) return; // bareword form — legal.
    if (args.length === 0) return; // empty-paren call — legal but uncommon.
    if (args.length > 1) {
      errors.push({
        code: "E-TYPE-031",
        message:
          `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` accepts at most `
          + `one argument (the optional inline message override per SPEC §55.10). `
          + `Got ${args.length} arguments.`,
        span,
        severity: "error",
      });
      return;
    }
    // Single arg present — must be string-literal (inline-message-override).
    if (!isInlineMessageOverride(args[0])) {
      errors.push({
        code: "E-TYPE-031",
        message:
          `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` accepts only a `
          + `static string literal as the inline message override (SPEC §55.10 / L12 Edge F). `
          + `Dynamic expressions defeat i18n tooling extraction.`,
        span,
        severity: "error",
      });
    }
    return;
  }

  if (signature.arity === 1) {
    // Strictly one required arg, no inline override. Currently no predicate
    // uses this arity.
    if (args === null || args.length !== 1) {
      errors.push({
        code: "E-TYPE-031",
        message:
          `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` requires exactly `
          + `one argument (SPEC §55.1). Got ${args === null ? "bareword" : args.length}.`,
        span,
        severity: "error",
      });
      return;
    }
    checkArgShape(args[0], signature.args![0]!, validator, cellName, errors, span);
    return;
  }

  // arity === "1+inline"
  if (args === null) {
    errors.push({
      code: "E-TYPE-031",
      message:
        `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` requires at least `
        + `one argument (SPEC §55.1). Did you mean \`${validator.name}(...)\`? `
        + `Bareword form is not legal for this predicate.`,
      span,
      severity: "error",
    });
    return;
  }
  if (args.length === 0) {
    errors.push({
      code: "E-TYPE-031",
      message:
        `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` requires at least `
        + `one argument (SPEC §55.1). Got empty parentheses.`,
      span,
      severity: "error",
    });
    return;
  }
  if (args.length > 2) {
    errors.push({
      code: "E-TYPE-031",
      message:
        `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` accepts at most `
        + `two arguments (the required arg per SPEC §55.1, plus an optional inline `
        + `message override per §55.10). Got ${args.length} arguments.`,
      span,
      severity: "error",
    });
    return;
  }

  // Required leading arg.
  checkArgShape(args[0], signature.args![0]!, validator, cellName, errors, span);

  // Optional trailing inline-message-override.
  if (args.length === 2) {
    if (!isInlineMessageOverride(args[1])) {
      errors.push({
        code: "E-TYPE-031",
        message:
          `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\`: the trailing `
          + `argument must be a static string literal (the inline message override per `
          + `SPEC §55.10 / L12 Edge F). Dynamic expressions defeat i18n tooling extraction.`,
        span,
        severity: "error",
      });
    }
  }
}

/**
 * Check a single arg's shape against the expected slot kind.
 *
 * NOTE: cell-type compatibility (e.g., `pattern(re)` on a `number` cell)
 * is DEFERRED per audit §1.3 — needs type-system inference. This check
 * verifies AST shape only.
 */
function checkArgShape(
  arg: ValidatorArg,
  expected: PredicateArgKind,
  validator: ValidatorEntry,
  cellName: string,
  errors: SYMDiagnostic[],
  span: SYMDiagnostic["span"],
): void {
  switch (expected.kind) {
    case "relational-predicate": {
      if (!arg || (arg as any).kind !== "relational-predicate") {
        errors.push({
          code: "E-TYPE-031",
          message:
            `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` expects a `
            + `relational predicate (e.g., \`>=2\`, \`<=10\`, \`<5\`) per SPEC §55.1.`,
          span,
          severity: "error",
        });
      }
      return;
    }
    case "regex": {
      // Regex literals fall to the escape-hatch path with raw="/.../" per
      // B9 specifics (esTreeToExprNode routes RegExp through BigInt/exotic).
      // String literals are accepted as an alternative form.
      if (!isRegexLikeArg(arg) && !isStringLit(arg)) {
        errors.push({
          code: "E-TYPE-031",
          message:
            `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` expects a `
            + `regex literal (e.g., \`/^[a-z]+$/\`) or string-literal regex per SPEC §55.1.`,
          span,
          severity: "error",
        });
      }
      return;
    }
    case "numeric": {
      // Numeric literal OR an expression of numeric type (typing deferred).
      // For now: reject obviously-non-numeric forms (string literals, regex,
      // array literals, RelationalPredicateNode).
      if (isStringLit(arg) || isRegexLikeArg(arg) || isArrayLikeArg(arg)
          || (arg as any)?.kind === "relational-predicate") {
        errors.push({
          code: "E-TYPE-031",
          message:
            `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` expects a `
            + `numeric value per SPEC §55.1.`,
          span,
          severity: "error",
        });
      }
      return;
    }
    case "comparable-with-cell":
    case "any-equatable-with-cell": {
      // Any ExprNode is acceptable at the shape level. Full cell-type
      // compatibility check deferred per audit §1.3.
      return;
    }
    case "array-of-cell-type": {
      if (!isArrayLikeArg(arg)) {
        errors.push({
          code: "E-TYPE-031",
          message:
            `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` expects an `
            + `array literal (e.g., \`[.Admin, .Editor]\`) per SPEC §55.1.`,
          span,
          severity: "error",
        });
      }
      return;
    }
    case "inline-message-override": {
      // The inline-override slot when it appears as a leading required arg —
      // catalog never declares this for slot 0 of any predicate today, but
      // exhaustive switch defensiveness.
      if (!isStringLit(arg)) {
        errors.push({
          code: "E-TYPE-031",
          message:
            `E-TYPE-031: validator \`${validator.name}\` on \`${cellName}\` expects a `
            + `static string literal per SPEC §55.10 / L12 Edge F.`,
          span,
          severity: "error",
        });
      }
      return;
    }
  }
}

function isStringLit(arg: ValidatorArg): boolean {
  if (!arg || typeof arg !== "object") return false;
  const a = arg as any;
  // Canonical scrml ExprNode for literals: kind:"lit", litType:"string".
  if (a.kind === "lit" && a.litType === "string") return true;
  // ESTree-flavored escape-hatch fallback (Literal with string value).
  if (a.kind === "escape-hatch" && a.nativeKind === "Literal"
      && typeof a.value === "string") return true;
  return false;
}

function isInlineMessageOverride(arg: ValidatorArg): boolean {
  return isStringLit(arg);
}

/**
 * Is the arg a regex-shaped value? Per B9 specifics, regex literals fall
 * through to the escape-hatch path because `esTreeToExprNode` routes RegExp
 * values through the BigInt/exotic branch — they arrive as
 * `{kind: "escape-hatch", nativeKind: "Literal", raw: "/.../"}`.
 */
function isRegexLikeArg(arg: ValidatorArg): boolean {
  if (!arg || typeof arg !== "object") return false;
  const a = arg as any;
  if (a.kind === "regex") return true;
  if (a.kind === "escape-hatch" && a.nativeKind === "Literal"
      && typeof a.raw === "string" && a.raw.startsWith("/")) return true;
  return false;
}

/**
 * Is the arg an array-literal-shaped value? Two paths:
 *  - Canonical scrml ExprNode: `kind: "array-lit"` (or future `kind: "lit"`
 *    with `litType: "array"` if grammar evolves).
 *  - Escape-hatch fallbacks: `nativeKind: "ArrayExpression"` for clean
 *    array literals; OR `nativeKind: "ParseError"` with `raw` starting with
 *    `[` — covers `[.Admin, .Editor]` bare-variant arrays which fail
 *    standalone JS parse but ARE valid scrml array literals.
 */
function isArrayLikeArg(arg: ValidatorArg): boolean {
  if (!arg || typeof arg !== "object") return false;
  const a = arg as any;
  if (a.kind === "array-lit") return true;
  if (a.kind === "lit" && a.litType === "array") return true;
  // Canonical scrml ExprNode for array literals (post-S69 / B20 parser fix —
  // bare-variant arrays now parse as clean `kind:"array"` instead of
  // escape-hatch ParseError).
  if (a.kind === "array") return true;
  if (a.kind === "escape-hatch") {
    if (a.nativeKind === "ArrayExpression") return true;
    // Bare-variant arrays: ParseError with raw starting "[" — legacy shape
    // preserved for any path that still produces it (defensive).
    if (a.nativeKind === "ParseError" && typeof a.raw === "string"
        && a.raw.trimStart().startsWith("[")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// B11: Auto-synthesized validity surface — compound-level (PASS 8)
// ---------------------------------------------------------------------------
//
// Per SPEC §55.5 / §55.7 (locks L11 + L12) — every COMPOUND state-decl gets
// four synthesized properties registered into its compound scope:
//
//   `@compound.isValid`   — boolean rollup (true ↔ ALL fields pass validators).
//   `@compound.errors`    — object map { fieldName: [...errorTags] }.
//   `@compound.touched`   — object map { fieldName: bool }.
//   `@compound.submitted` — boolean (compound-level only per §55.7 line 24468).
//
// **Trigger predicate (per audit §1.1):** `_cellKind === "compound-parent"`.
// Synthesis is UNCONDITIONAL for compound parents — even no-validator compounds
// get the surface, with trivially-valid defaults per §55.5 line 24415-24418
// ("predictability over namespace savings"). Single-value Tier-1 cells (L11
// Edge A) DO NOT get the surface (compound parent check filters them naturally).
//
// **Canonical types per §55, NOT §6.11 stub (per audit §1.2):**
//   - compound `errors` is OBJECT MAP keyed by field name (NOT `string[]`).
//   - per-field `errors` (B12 future) is array of `ValidationError` enum tags
//     (NOT singular `error: string`).
//
// **Runtime-hook annotations per §55.7 line 24449-24461 (audit §1.5):**
//   - `isValid`, `errors` are pure reactive derivations → `runtimeHookKind: null`.
//   - `touched` has runtime trigger (bind:value/bind:checked change OR first
//     focus-out) → `runtimeHookKind: "touch"`.
//   - `submitted` has runtime trigger (form's submit handler) →
//     `runtimeHookKind: "submit"`.
//   - B11 RECORDS the hook requirement on each synth record. A1c codegen reads
//     the annotation and emits the actual hook plumbing.
//
// **Cross-field deps via predicate args:** B10 Phase 3 already emits
// `validator-reads` edges in the dep-graph. B11 emits NO new DG edges — the
// reactive wiring for compound rollup (`isValid` reading each field's
// `isValid`) is logically a consequence of the synth records' annotations and
// is materialized by A1c codegen via the existing `validator-reads` machinery.
//
// **`submitted` is COMPOUND-LEVEL ONLY** per §55.7 line 24468 (audit §1.6).
// B12 (per-field surface) MUST NOT register per-field `submitted`.
//
// **E-SYNTHESIZED-WRITE** is fired by the EXTENDED PASS 6 walker (see below).
// PASS 8 only registers — diagnostic firing rides on the existing walker
// pattern (audit §1.3 wave-ordering correction).

/**
 * The runtime-hook requirement table for synth-surface properties at
 * compound scope. Per §55.7 line 24463-24468.
 */
const B11_RUNTIME_HOOK: Readonly<Record<SynthProperty, "touch" | "submit" | null>> = {
  isValid: null,    // pure reactive
  errors: null,     // pure reactive
  touched: "touch", // event-driven
  submitted: "submit", // event-driven
};

/**
 * Construct a single synth-cell `StateCellRecord` for a compound parent's
 * `_scope`. The `declNode` field references the compound parent (NOT a
 * fresh AST node — synth records are metadata) so that consumers walking
 * `record.declNode.span` get a usable source-anchor for diagnostics.
 *
 * Conformance with `StateCellRecord` shape:
 *   - `name` = the synth-property name.
 *   - `qualifiedPath` = compound's qualified path + "." + name.
 *   - `scope` = the compound's `_scope` (where the record is being registered).
 *   - `structuralForm: true` (synth cells are spec-canonical).
 *   - `shape: "derived"` — synth cells are READ-ONLY derived; mutation fires
 *     `E-SYNTHESIZED-WRITE` per §55.5 line 24422 + §34.
 *   - `isConst: true` — read-only invariant.
 *   - `isPinned: false` — synth cells aren't pinnable.
 *   - `isCompoundParent: false` — synth cells aren't compounds themselves.
 *   - `isCompoundChild: true` — registered inside a compound's `_scope`.
 *   - `hasValidators: false` — synth cells have no validators of their own.
 *   - `hasDefaultExpr: false` — defaults are §55.7 table values, not AST.
 *   - `hasTypeAnnotation: false` — types are spec-fixed per §55.5.
 *   - `isSynthesized: true` — the discriminant.
 *   - `synthProperty` — which of the four.
 *   - `parentCompound` — back-pointer to the compound's record.
 *   - `runtimeHookKind` — per §55.7 update-timing table.
 */
function makeSynthRecord(
  parentCompound: StateCellRecord,
  property: SynthProperty,
  compoundScope: Scope,
): StateCellRecord {
  return {
    name: property,
    qualifiedPath: parentCompound.qualifiedPath + "." + property,
    declNode: parentCompound.declNode, // anchor for span; no fresh AST node.
    scope: compoundScope,
    structuralForm: true,
    shape: "derived",
    isConst: true,
    isPinned: false,
    isCompoundParent: false,
    isCompoundChild: true,
    hasValidators: false,
    hasDefaultExpr: false,
    hasTypeAnnotation: false,
    isSynthesized: true,
    synthProperty: property,
    parentCompound,
    runtimeHookKind: B11_RUNTIME_HOOK[property],
  };
}

/**
 * Register the four synth-surface records into a single compound's
 * `_scope.stateCells`. Idempotent — if a synth record with the same name
 * already exists (e.g., the dev declared `<isValid>` as a compound child),
 * the existing record wins (DEV INTENT > SYNTH). This is consistent with
 * the spec's predictability rule but is also a future-tightening hook: a
 * later B-step might fire E-SYNTH-NAME-COLLIDES on user fields named
 * `isValid` / `errors` / `touched` / `submitted`. For B11, silent skip is
 * the conservative choice.
 *
 * Per audit §1.7: B5's `_cellKind` annotation is the trigger predicate; the
 * caller (`walkRegisterSynthSurface`) walks every state-decl with
 * `_cellKind === "compound-parent"` and calls this for each.
 */
function registerCompoundSynthSurface(
  compoundRecord: StateCellRecord,
): void {
  const compoundDecl = compoundRecord.declNode as ReactiveDeclNode & ScopeAnnotated;
  const compoundScope = compoundDecl._scope;
  // Defensive: every compound parent should have a `_scope` set by PASS 1's
  // `registerStateDecl`. If absent (test-harness construction or AST shape
  // drift), skip silently — synth registration is best-effort.
  if (!compoundScope) return;

  // ── B11: compound-level surface ──────────────────────────────────────────
  for (const property of COMPOUND_SYNTH_PROPERTIES) {
    if (compoundScope.stateCells.has(property)) {
      // Dev declared a child with this name. Preserve dev intent; skip synth.
      // Future tightening: fire E-SYNTH-NAME-COLLIDES.
      continue;
    }
    const synthRec = makeSynthRecord(compoundRecord, property, compoundScope);
    compoundScope.stateCells.set(property, synthRec);
  }

  // ── B12: per-field surface for each non-synth child ──────────────────────
  // Iterate the compound's child records. Snapshot the keys first because
  // B11 may have just inserted synth keys into the same map; we filter those
  // out via the `isSynthesized` discriminant. Order matters only for
  // diagnostic determinism — fields land in source-declaration order
  // because `Map` preserves insertion order and B1 registers in source
  // order.
  const childKeys = [...compoundScope.stateCells.keys()];
  for (const childName of childKeys) {
    const childRec = compoundScope.stateCells.get(childName);
    if (!childRec) continue;
    if (childRec.isSynthesized) continue; // skip B11's just-registered synth records
    registerPerFieldSynthSurface(childRec, compoundRecord);
  }
}

/**
 * PASS 8 walker — visit every state-decl, find compound parents, register
 * synth-surface records into each compound's `_scope`. Mirrors the
 * structural-recursion shape used by PASS 4 / PASS 5 / PASS 6.
 *
 * Reads `_cellKind` (set by PASS 4) to identify compound parents. Per audit
 * §1.1, ALL compound parents get the surface — no conditionalization on
 * "has any field validators?" (predictability per §55.5).
 *
 * Reads `_record` (set by PASS 1) to recover the compound's `StateCellRecord`
 * for the `parentCompound` back-pointer.
 */
function walkRegisterSynthSurface(
  nodes: ASTNode[] | undefined,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    if (kind === "state-decl") {
      const cellKind: CellKind | undefined = anyN._cellKind;
      const record: StateCellRecord | undefined = anyN._record;
      if (cellKind === "compound-parent" && record) {
        registerCompoundSynthSurface(record);
        // Recurse into compound children — nested compounds need their own
        // synth surface (e.g., `<form><address><street>...</></>` registers
        // `@form.address.isValid` etc. on the address sub-compound).
        if (Array.isArray(anyN.children)) {
          walkRegisterSynthSurface(anyN.children, visited);
        }
      }
      continue;
    }

    // Generic recursion (mirrors PASS 4 / PASS 5 structural walk).
    if (Array.isArray(anyN.children)) walkRegisterSynthSurface(anyN.children, visited);
    if (Array.isArray(anyN.body)) walkRegisterSynthSurface(anyN.body, visited);
    if (Array.isArray(anyN.consequent)) walkRegisterSynthSurface(anyN.consequent, visited);
    if (Array.isArray(anyN.alternate)) walkRegisterSynthSurface(anyN.alternate, visited);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkRegisterSynthSurface(arm.body, visited);
      }
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkRegisterSynthSurface([anyN.expr.node], visited);
    }
  }
}

// Helper: walk the AST top-level so the walker re-enters nested arrays under
// `body`/`children` correctly. The wrapper ensures the recursion shape mirrors
// other passes (PASS 4 / PASS 5 / PASS 6) — top-level dispatch on array.
function dispatchWalkSynth(
  nodes: ASTNode[] | undefined,
): void {
  const visited = new WeakSet<object>();
  walkRegisterSynthSurface(nodes, visited);
}

// ---------------------------------------------------------------------------
// B12: Auto-synthesized validity surface — per-field (PASS 8 extension)
// ---------------------------------------------------------------------------
//
// Per SPEC §55.6 (locks L11 + L12) — every COMPOUND CHILD gets three
// synthesized properties registered into its per-field scope:
//
//   `@compound.field.isValid` — boolean (true ↔ this field's validators pass).
//   `@compound.field.errors`  — array of `ValidationError` enum tags for THIS field.
//   `@compound.field.touched` — boolean. Latched on first interaction.
//
// **`submitted` is NOT registered per-field** per §55.7 line 24468 (audit §1.6
// boundary clarification) — `submitted` is compound-level only.
//
// **Trigger predicate (per audit §1.1):** EVERY compound child gets the per-
// field surface, regardless of whether the child has validators. Per §55.6
// (L11 Edge B): "Per L11 Edge B, a per-field surface exists EVEN when the
// field has no validators". Predictability over selectivity (audit §1.1
// substantive drift correction — SCOPE wording "per validator-tagged child
// cell" was narrower than the spec).
//
// **Type shapes per §55.6, NOT §6.11 stub (audit §1.3):**
//   - per-field `errors` is ARRAY of `ValidationError` enum tags (NOT
//     singular `error: string`).
//
// **Runtime-hook annotations** (audit §1.6):
//   - per-field `isValid` and `errors` are pure-reactive → `null`.
//   - per-field `touched` is event-driven (bind:value/bind:checked change OR
//     focus-out) → `"touch"`. Per-field timing per §55.7 line 24457.
//
// **Per-field scope shape:** B12 attaches a `kind: "field"` `Scope` onto each
// compound child's decl node via `declNode._scope`. The three per-field synth
// records register into this scope. `lookupQualifiedStateCell` was extended
// to descend through ANY cell that has `_scope` (not just compound parents),
// so `@signup.name.isValid` resolves naturally via the existing API.
//
// **Cross-field deps:** B10 Phase 3 already wires `validator-reads` edges in
// the dep-graph (via `forEachIdentInValidatorArg` walking `@signup.password`
// references in `eq(@signup.password)` validator args). B12 emits NO new DG
// edges — the cross-field reactive wiring is materialized by A1c codegen
// reading the synth-record annotations + the existing edge machinery
// (mirrors B11's stance per audit §1.5 + B11 spec §"NO new DG edges").
//
// **E-SYNTHESIZED-WRITE per-field scope:** B11 fires E-SYNTHESIZED-WRITE only
// at compound scope (`@signup.isValid = false`). B12 extends the same PASS 6
// walker to fire on per-field writes (`@signup.name.isValid = false`).
// Implementation: relax B11's `hit.path.length !== receiverPath.length`
// guard to ALSO accept the case where the prefix resolves to a compound +
// the next segment is a registered field (the synth-property is the leaf).
// `findDeepestRegisteredOnPrefix` walks longest→shortest (B8's helper); for
// `@signup.name.isValid` the deepest registered prefix is `["signup","name"]`
// (the field cell), and the leaf `isValid` is the synth-property name. The
// extension is depth-2 instead of depth-1.

/**
 * The runtime-hook requirement table for per-field synth-surface properties.
 * Three entries (no `submitted`); same semantics as the compound table for
 * the three shared properties per §55.7. Defined separately for clarity —
 * a future spec extension could differentiate per-field vs compound timing.
 */
const B12_PER_FIELD_RUNTIME_HOOK: Readonly<
  Record<"isValid" | "errors" | "touched", "touch" | null>
> = {
  isValid: null,    // pure reactive
  errors: null,     // pure reactive
  touched: "touch", // event-driven (per-field timing per §55.7 line 24457)
};

/**
 * Construct a single per-field synth `StateCellRecord` for a compound child's
 * `_scope`. Mirrors `makeSynthRecord` but stamps:
 *   - `qualifiedPath` = parentField's qualified path + "." + property
 *     (e.g., `"signup.name.isValid"` for the `name` field of `@signup`).
 *   - `parentField` — back-pointer to the field cell record (B12 discriminant).
 *   - `parentCompound` — back-pointer to the field's enclosing compound
 *     (same record `parentField.scope`-resolves to via parent-chain walk; we
 *     stamp it explicitly for codegen ergonomics so per-field synth records
 *     don't need a re-walk to find the compound).
 *   - `declNode` references the FIELD's decl node (NOT the compound's) so
 *     consumers walking `record.declNode.span` get the field-anchored span.
 *   - `runtimeHookKind` per `B12_PER_FIELD_RUNTIME_HOOK`.
 *
 * `parentCompound` is computed from `parentField.scope` (the scope the field
 * was registered into, which is the compound's `_scope` per `registerStateDecl`)
 * — but that scope's _owner_ record isn't directly accessible from the scope
 * itself. We thread `parentCompoundRecord` through as a parameter; the caller
 * (`walkRegisterSynthSurface`) has both records in hand.
 */
function makePerFieldSynthRecord(
  parentField: StateCellRecord,
  parentCompoundRecord: StateCellRecord,
  property: "isValid" | "errors" | "touched",
  fieldScope: Scope,
): StateCellRecord {
  return {
    name: property,
    qualifiedPath: parentField.qualifiedPath + "." + property,
    declNode: parentField.declNode, // anchor at the field, not the compound.
    scope: fieldScope,
    structuralForm: true,
    shape: "derived",
    isConst: true,
    isPinned: false,
    isCompoundParent: false,
    isCompoundChild: true,
    hasValidators: false,
    hasDefaultExpr: false,
    hasTypeAnnotation: false,
    isSynthesized: true,
    synthProperty: property,
    parentCompound: parentCompoundRecord,
    parentField,
    runtimeHookKind: B12_PER_FIELD_RUNTIME_HOOK[property],
  };
}

/**
 * Register the three per-field synth-surface records for a single compound
 * child. Idempotent on the field's `_scope` — if the field already has a
 * `_scope` (defensive against test-harness re-runs), reuse it. Per audit
 * §1.1: registration is unconditional for ALL compound children, including
 * those without validators (trivially-valid defaults per §55.6 / L11 Edge B).
 *
 * Compound-child-that-IS-also-a-compound case: the field is itself a
 * compound parent (e.g., `<form><address><street>...</></>` — `address` is
 * a child of `form` AND a compound parent registering `street`). B11 already
 * attached a `kind:"compound"` scope to `address.declNode._scope` to hold
 * `street`. B12 must NOT clobber that scope. Decision: attach the per-field
 * synth surface to the SAME `_scope` (the compound scope holds both compound
 * children + the per-field synth properties). The synth-property names
 * (`isValid`/`errors`/`touched`) are reserved at compound scope (B11 already
 * registers them as compound-level synth there). For a compound-typed
 * child like `address`:
 *   - the compound scope holds `street` (dev child) + the four B11 compound
 *     synth records.
 *   - B12 must NOT add a DUPLICATE per-field synth record at the same scope
 *     — `@form.address.isValid` resolves to the COMPOUND-LEVEL synth (B11
 *     attached to `address`'s compound scope), which IS the per-field
 *     surface for `address` viewed from `form`'s perspective. The two
 *     interpretations coincide on a compound-typed child.
 *
 * So this function SKIPS registration when the child is a compound parent —
 * B11's compound synth records already serve as the per-field surface.
 */
function registerPerFieldSynthSurface(
  fieldRecord: StateCellRecord,
  parentCompoundRecord: StateCellRecord,
): void {
  // Skip compound-typed children — B11 already registered compound-level
  // synth records on the child's compound scope (audit §1.1 + per the
  // analysis above; the compound view IS the per-field view here).
  if (fieldRecord.isCompoundParent) return;

  // Build / reuse the field's `_scope`. For non-compound children, the decl
  // node has no `_scope` after PASS 1; B12 attaches one here.
  const fieldDecl = fieldRecord.declNode as ReactiveDeclNode & ScopeAnnotated;
  let fieldScope = fieldDecl._scope;
  if (!fieldScope) {
    fieldScope = createScope(
      "field",
      fieldRecord.scope,
      fieldRecord.qualifiedPath + ".",
    );
    Object.defineProperty(fieldDecl, "_scope", {
      value: fieldScope,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  for (const property of PER_FIELD_SYNTH_PROPERTIES) {
    if (fieldScope.stateCells.has(property)) {
      // Defensive: should never happen in practice (no other pass writes to
      // a `kind:"field"` scope). If it does, preserve the existing record
      // (consistent with B11's dev-shadow handling).
      continue;
    }
    const synthRec = makePerFieldSynthRecord(
      fieldRecord,
      parentCompoundRecord,
      property as "isValid" | "errors" | "touched",
      fieldScope,
    );
    fieldScope.stateCells.set(property, synthRec);
  }
}

// ---------------------------------------------------------------------------
// B11 + B12: E-SYNTHESIZED-WRITE — extends B8's PASS 6 walker (audit §1.3)
// ---------------------------------------------------------------------------
//
// Per SPEC §55.5 + §55.6 + §55.7 line 24470 + §34: writing to any auto-
// synthesized validity-surface property is `E-SYNTHESIZED-WRITE`. Examples:
//
//   COMPOUND scope (B11):
//     `@form.isValid = false`            → fire.
//     `@form.errors = {}`                → fire.
//     `@form.touched = {}`               → fire.
//     `@form.submitted = true`           → fire.
//
//   PER-FIELD scope (B12, §55.6):
//     `@form.email.isValid = false`      → fire.
//     `@form.email.errors = []`          → fire.
//     `@form.email.touched = false`      → fire.
//     `@form.email.submitted = true`     → does NOT fire (`submitted` is
//                                           compound-level only per §55.7
//                                           line 24468; the dev is writing
//                                           to a non-synth member, which is
//                                           outside the synth-write rule).
//
// **Implementation strategy (audit §1.3):** B11 EXTENDED B8's PASS 6 walker
// with a fourth dispatch path keyed on synth property names. B12 RELAXES the
// compound-vs-field guard so per-field paths fire too — receiver discrimination
// is now (compound-parent → all 4 properties) | (compound-child → 3 properties
// excluding `submitted`). B8's walker structure was prepared for this join
// (per primer §13.7 B8 specifics).
//
// **Receiver-chain root resolution** mirrors B8 (audit §1.7 integration story):
// the assignment target is `@compound.[.field.]synthProp = ...`; the chain
// root resolves via the existing `findDeepestRegisteredOnPrefix` helper, which
// after B12's `lookupQualifiedStateCell` extension descends through ANY cell
// with a `_scope` (compound parent's `kind:"compound"` scope OR compound
// child's `kind:"field"` scope). Fire fires unconditionally — both B11 and
// B12 unconditionally register all synth records for every compound parent +
// every compound child (audit §1.1).

/**
 * Construct the `E-SYNTHESIZED-WRITE` diagnostic message per §34 catalog row
 * line 14218 + §55.5 line 24422 fix-recommendation.
 */
function fireSynthesizedWrite(
  errors: SYMDiagnostic[],
  compoundPath: string[],
  property: SynthProperty,
  op: string,
  span: Span,
): void {
  const compoundRef = formatReceiver(compoundPath);
  errors.push({
    code: "E-SYNTHESIZED-WRITE",
    message:
      `E-SYNTHESIZED-WRITE: assignment to auto-synthesized property `
      + `\`${compoundRef}.${property}\`. Synthesized validity-surface properties `
      + `(\`isValid\`, \`errors\`, \`touched\`, \`submitted\`) are READ-ONLY `
      + `(SPEC §55.5 + §34). The form was \`${compoundRef}.${property} ${op} ...\`. `
      + `Fix: change the underlying input cells (the synth surface recomputes `
      + `automatically); use \`reset(${compoundRef})\` to clear validity state `
      + `(SPEC §55.13).`,
    span,
    severity: "error",
  });
}

/**
 * Check an `assign` ExprNode (B8 form 2-style) for synth-property writes at
 * compound OR per-field scope. Returns `true` iff fired (so the caller can
 * short-circuit derived-cell-mutate firing — synth-write IS a different rule
 * and shouldn't double-fire as derived-mutate).
 *
 * Receiver-path shapes (B11 + B12 combined):
 *
 *   `@form.isValid = false` (compound, B11):
 *     - target = `member { object: ident("@form"), property: "isValid" }`
 *     - receiverPath = ["form"]; hit = formRec (compound-parent) → fires.
 *
 *   `@form.address.isValid = false` (nested compound, B11):
 *     - receiverPath = ["form", "address"]; hit = addressRec (compound-parent) → fires.
 *
 *   `@form.email.isValid = false` (per-field, B12):
 *     - receiverPath = ["form", "email"]; hit = emailRec (compound-child,
 *       NOT compound-parent) → fires.
 *
 *   `@form.email.submitted = true` (per-field write to compound-only prop, B12):
 *     - receiverPath = ["form", "email"]; hit = emailRec (compound-child)
 *     - property is "submitted" → does NOT fire (per-field surface excludes
 *       `submitted` per §55.7 line 24468).
 */
function checkSynthAssignFire(
  assignNode: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  containerSpan: Span,
): boolean {
  const target = assignNode.target;
  if (!target || target.kind !== "member" || typeof target.property !== "string") return false;
  const property = target.property as string;
  if (!SYNTH_PROPERTY_NAMES.has(property as SynthProperty)) return false;

  // Receiver chain path = path-to-(compound|field). Build it from the assign
  // target's object (everything before `.property`).
  const receiverPath = buildReceiverPath(target.object);
  if (!receiverPath || receiverPath.length === 0) return false;

  // Resolve the receiver to a registered cell. Use the B8 deepest-prefix
  // scan — for nested compounds + per-field, we want the deepest registered
  // record that the entire receiver path resolves to.
  const hit = findDeepestRegisteredOnPrefix(scope, receiverPath);
  if (!hit) return false;
  // Ensure the resolved prefix is the FULL receiver path. A shorter prefix
  // would mean the tail segments aren't registered cells — e.g., a write to
  // `@form.foo.bar.isValid` where `foo` is a compound but `bar` isn't
  // registered. Such writes don't target a synth surface.
  if (hit.path.length !== receiverPath.length) return false;

  // B11 (compound scope): receiver is a compound parent; any synth property
  // including `submitted` fires. B12 (per-field scope): receiver is a
  // compound child; only `isValid`/`errors`/`touched` fire — `submitted`
  // is COMPOUND-LEVEL ONLY per §55.7 line 24468. A write to
  // `@signup.name.submitted` does NOT fire E-SYNTHESIZED-WRITE (the property
  // doesn't exist at per-field scope; the dev is writing to a non-synth
  // member, which is its own affair).
  const isCompoundReceiver = hit.record.isCompoundParent === true;
  const isCompoundChildReceiver = hit.record.isCompoundChild === true && !isCompoundReceiver;
  if (!isCompoundReceiver && !isCompoundChildReceiver) return false;
  if (isCompoundChildReceiver && property === "submitted") return false;

  fireSynthesizedWrite(errors, receiverPath, property as SynthProperty,
    assignNode.op ?? "=", containerSpan);
  return true;
}

/**
 * Check a `reactive-nested-assign` AST node (specialized lowering, plain `=`)
 * for synth-property writes at compound OR per-field scope. Mirrors
 * `checkSynthAssignFire` for the specialized form.
 *
 * For `@form.isValid = false` lowered as reactive-nested-assign:
 *   - n.target = "form" (cell name)
 *   - n.path = ["isValid"] (the property segments — last is the assigned property)
 *
 * For `@form.address.isValid = false` (nested compound):
 *   - n.target = "form"
 *   - n.path = ["address", "isValid"]
 *
 * For `@form.email.isValid = false` (B12 per-field):
 *   - n.target = "form"
 *   - n.path = ["email", "isValid"]
 *   - receiverPath = ["form", "email"]; resolves to email field cell → fires.
 *
 * For `@form.email.submitted = true` (B12 — does NOT fire, see B11/B12 doc).
 *
 * Returns `true` iff fired.
 */
function checkSynthNestedAssignFire(
  n: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  fileFromScope: string,
): boolean {
  if (typeof n.target !== "string" || !Array.isArray(n.path) || n.path.length === 0) {
    return false;
  }
  const path: string[] = n.path;
  const property = path[path.length - 1];
  if (typeof property !== "string") return false;
  if (!SYNTH_PROPERTY_NAMES.has(property as SynthProperty)) return false;

  // Receiver path = [target, ...path[0..length-1]] (the compound|field chain).
  const receiverPath = [n.target, ...path.slice(0, path.length - 1)];

  // Resolve the deepest registered record on the prefix.
  const hit = findDeepestRegisteredOnPrefix(scope, receiverPath);
  if (!hit) return false;
  if (hit.path.length !== receiverPath.length) return false;

  // B11 + B12 receiver discrimination — see `checkSynthAssignFire` for the
  // shape. Compound parent → all 4 properties fire; compound child →
  // {isValid, errors, touched} fire (no `submitted` per §55.7 line 24468).
  const isCompoundReceiver = hit.record.isCompoundParent === true;
  const isCompoundChildReceiver = hit.record.isCompoundChild === true && !isCompoundReceiver;
  if (!isCompoundReceiver && !isCompoundChildReceiver) return false;
  if (isCompoundChildReceiver && property === "submitted") return false;

  fireSynthesizedWrite(
    errors,
    receiverPath,
    property as SynthProperty,
    "=",
    spanFromMutationNode(n, fileFromScope),
  );
  return true;
}

// ---------------------------------------------------------------------------
// B13: E-DERIVED-WITH-VALIDATORS + Level-1 inline-override extraction (PASS 9)
// ---------------------------------------------------------------------------
//
// Per SPEC §55.14 (validators on derived cells: REJECTED) + §55.10 (4-level
// error message resolution chain). Two responsibilities, one walker pass:
//
//   1. **E-DERIVED-WITH-VALIDATORS rejection** — every state-decl with
//      `isConst === true` AND non-empty validators fires the diagnostic.
//      Per audit §1.7 + §55.14 line 24692, the message recommends the
//      refinement-type alternative (`const <x>: number(>=0) = ...`).
//
//      Per audit §1.5: engine auto-declared variables are NOT `isConst`, so
//      they pass through silently — engine-cell validators are LEGAL but
//      typically REDUNDANT per §55.14. Engine-derived (`<engine derived=>`)
//      with validators is REJECTED per §55.14 line 24689 but requires
//      engine-decl annotations not yet present (B14 sequencing). The walker's
//      `state-decl` filter skips engine-decls; the engine-derived case is
//      deferred to a B13.5/B14 follow-up.
//
//   2. **Level-1 inline-override extraction** — for non-derived cells with
//      validators, walk each `ValidatorEntry` and extract the trailing
//      string-literal arg as `inlineOverride: string` on the entry, when the
//      catalog declares an `inline-message-override` slot for that predicate
//      and the runtime arg-list has the slot populated. When the trailing
//      slot is present but the arg is NOT a static string literal, fire
//      `E-VALIDATOR-INLINE-DYNAMIC` (per L12 Edge F static-string rule).
//
// **Walker type:** AST-driven structural recursion, mirrors PASS 5 / PASS 6 /
// PASS 7 / PASS 8. Runs FOR FREE on top of B5 (cellKind), B9 (ExprNode args),
// B10 (catalog) — no new infrastructure.

/**
 * PASS 9 walker — for every `state-decl` node:
 *
 *   - If `isConst:true` AND validators non-empty → fire
 *     E-DERIVED-WITH-VALIDATORS (one per cell, listing the offending
 *     validator names) and skip per-validator processing on this cell.
 *   - Else (non-derived) → for each validator, extract Level-1 inline
 *     override (if present) onto `validator.inlineOverride`; fire
 *     E-VALIDATOR-INLINE-DYNAMIC if the inline-override slot is populated
 *     by a non-string-literal expression.
 */
function walkRejectDerivedWithValidatorsAndExtractOverride(
  nodes: any,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkRejectDerivedWithValidatorsAndExtractOverride(n, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes;
  const kind = node.kind;

  if (kind === "state-decl") {
    const validators: ValidatorEntry[] | undefined = (node as any).validators;
    if (Array.isArray(validators) && validators.length > 0) {
      const isConst = (node as any).isConst === true;
      if (isConst) {
        fireDerivedWithValidators(node, validators, errors, filePath);
      } else {
        for (const validator of validators) {
          extractInlineOverride(validator, node, errors, filePath);
        }
      }
    }
    if (Array.isArray(node.children)) {
      walkRejectDerivedWithValidatorsAndExtractOverride(
        node.children, errors, filePath, visited,
      );
    }
    return;
  }

  for (const k of [
    "body", "consequent", "alternate", "expr", "node", "renderSpec",
    "children", "value", "argument",
  ]) {
    if ((node as any)[k]) {
      walkRejectDerivedWithValidatorsAndExtractOverride(
        (node as any)[k], errors, filePath, visited,
      );
    }
  }
  if (Array.isArray((node as any).arms)) {
    for (const arm of (node as any).arms) {
      if (arm && Array.isArray(arm.body)) {
        walkRejectDerivedWithValidatorsAndExtractOverride(
          arm.body, errors, filePath, visited,
        );
      }
    }
  }
}

/**
 * Fire E-DERIVED-WITH-VALIDATORS per SPEC §55.14 + §34. One diagnostic per
 * derived cell that has validators; recommends refinement-type alternative
 * per §55.14 line 24692.
 */
function fireDerivedWithValidators(
  declNode: any,
  validators: ValidatorEntry[],
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const cellName = declNode.name ?? "<anonymous>";
  const offendingNames = validators.map((v) => v.name).join(", ");
  const span: SYMDiagnostic["span"] = declNode.span ?? validators[0]?.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  errors.push({
    code: "E-DERIVED-WITH-VALIDATORS",
    message:
      `E-DERIVED-WITH-VALIDATORS: derived cell \`${cellName}\` cannot carry validators `
      + `(found: ${offendingNames}). Derived cells (\`const <x ...> = expr\`) are read-only `
      + `(SPEC §55.14); validators imply gating which is incoherent on a computed value. `
      + `Did you mean a refinement type? \`const <${cellName}>: number(>=0) = ...\` — `
      + `refinement-type predicates are the type-level invariant for derived values.`,
    span,
    severity: "error",
  });
}

/**
 * Extract Level-1 inline override (per §55.10) onto `validator.inlineOverride`
 * for a non-derived cell. See B13 dispatch `extractInlineOverride` doc for
 * the per-arity decision tree.
 */
function extractInlineOverride(
  validator: ValidatorEntry,
  declNode: any,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const args = validator.args;
  if (args === null || (Array.isArray(args) && args.length === 0)) {
    (validator as any).inlineOverride = null;
    return;
  }

  const signature = lookupPredicate(validator.name);
  if (!signature || !Array.isArray(signature.args) || signature.args.length === 0) {
    (validator as any).inlineOverride = null;
    return;
  }

  const lastSigIdx = signature.args.length - 1;
  const lastSlot = signature.args[lastSigIdx];
  if (!lastSlot || lastSlot.kind !== "inline-message-override") {
    (validator as any).inlineOverride = null;
    return;
  }

  if (args.length < signature.args.length) {
    (validator as any).inlineOverride = null;
    return;
  }

  const candidate = args[lastSigIdx]!;

  const literal = stringLiteralValueOf(candidate);
  if (literal !== null) {
    (validator as any).inlineOverride = literal;
    return;
  }

  const cellName = declNode.name ?? "<anonymous>";
  const span: SYMDiagnostic["span"] = (validator as any).span
    ?? declNode.span
    ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
  errors.push({
    code: "E-VALIDATOR-INLINE-DYNAMIC",
    message:
      `E-VALIDATOR-INLINE-DYNAMIC: the inline message override on `
      + `\`${validator.name}\` for cell \`${cellName}\` must be a static `
      + `string literal (SPEC §55.10 / L12 Edge F — no expression `
      + `interpolation; messages are statically extractable for i18n tooling).`,
    span,
    severity: "error",
  });
  (validator as any).inlineOverride = null;
}

/**
 * If `arg` is a string-literal ValidatorArg, return its decoded string value;
 * otherwise return null.
 */
function stringLiteralValueOf(arg: any): string | null {
  if (!arg || typeof arg !== "object") return null;
  if (arg.kind === "lit" && arg.litType === "string"
      && typeof arg.value === "string") {
    return arg.value;
  }
  if (arg.kind === "escape-hatch" && arg.nativeKind === "Literal"
      && typeof arg.value === "string") {
    return arg.value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PASS 10 (B14) — Engine cell registration + cross-file mount validation
// ---------------------------------------------------------------------------
//
// Per Phase A1b Step B14 (audit §2 ten-point brief; SPEC §51.0.A-K, §21.8, §34):
//
// PASS 10.A — REGISTER ENGINE CELLS:
//   Walks every `engine-decl` AST node in the file. For each:
//     1. Compute the auto-declared variable name per §51.0.C — derived from
//        the engine's `for=Type` (lowercase-first-character of the type name)
//        UNLESS `var=NAME` is present (override). Legacy `name=` is preserved
//        as a back-compat path.
//     2. Validate the chosen var name against existing same-scope state cells:
//        if a non-engine state-cell already exists with this name, fire
//        `E-ENGINE-VAR-DUPLICATE` (§51.0.C, §34) — the engine OWNS its
//        variable.
//     3. Register a `StateCellRecord` with `_cellKind: "engine"` + an
//        `engineMeta` annotation carrying §51.0.B-C surface data (varName,
//        forType, initialVariant (record only — B15 validates), pinned,
//        derivedExpr (record only — B16 consumes)).
//     4. Stamp the engine-decl AST node with `_record` + `_cellKind: "engine"`.
//
// PASS 10.B — CROSS-FILE ENGINE MOUNT VALIDATION (§51.0.D + §21.8 / M18):
//   Walks markup for self-closing tags whose tagName matches an import-
//   binding in the file scope. For each such tag, looks up the source
//   export's category via the MOD exportRegistry:
//     - If `category === "engine"`: legitimate cross-file mount; no record
//       registration required (the imported singleton is the cell).
//     - Else: fire `E-ENGINE-MOUNT-NOT-ENGINE` (added to §34 by this dispatch
//       — see audit §1.3) with the offending category and a remediation hint.
//
//   Engine awareness in MOD's exportRegistry is a precondition: today's
//   exportRegistry maps `kind: "const" | "type" | "function" | "channel"
//   | ...` and `category: "user-component" | "channel" | "type" |
//   "function" | "const" | "other"`. B14 extends MOD to recognize
//   `kind: "engine"` + `category: "engine"` for `export <engine ...>` Form 1
//   and for explicit `export const NAME = <engine ...>` Form 2. See
//   `module-resolver.js:buildExportRegistry`.
//
// PASS 10.C — E-COMPONENT-ENGINE-SCOPE (§51.0.K, deferred):
//   Today's AST stores component-def bodies as raw text (`component-def.raw:
//   string`); engine-decls inside component bodies are not present as
//   walkable children. B14 thus cannot reliably detect the violation in the
//   walker tree. The check is OWNED by B17 ("residual components-vs-engines
//   distinction") with a structural component-body parse precondition. The
//   audit §1.5 fire-site recommendation is acknowledged here; once
//   component bodies become walkable, the same B14 walker can fire it.

/**
 * §51.0.C — auto-derive a variable name from a type name. Literal rule:
 * lowercase the first character, leave the rest unchanged.
 *
 * Examples (per spec §51.0.C table):
 *   `MarioState`  → `marioState`
 *   `LoadPhase`   → `loadPhase`
 *   `Health`      → `health`
 *
 * Edge cases (audit §1.2 — surfaced as spec-amendment follow-up):
 *   `URL`         → `uRL`   (literal first-char rule; per spec)
 *   `T`           → `t`     (single-letter)
 *   `myType`      → `myType` (lowercase-leading; identity)
 *   `_Internal`   → `_Internal` (leading non-letter; identity)
 *
 * The function is an idempotent character-level transformation. If
 * downstream behavior diverges, the spec amendment for §51.0.C should
 * enumerate the contiguous-uppercase-run rule explicitly.
 */
export function autoDeriveEngineVarName(typeName: string): string {
  if (typeof typeName !== "string" || typeName.length === 0) return "";
  const first = typeName.charCodeAt(0);
  // ASCII A-Z = 65-90; lowercase by adding 32. Non-letter first chars (like
  // `_` or digits — the latter is illegal in scrml ident grammar but we
  // defensively pass through) → identity.
  if (first >= 65 && first <= 90) {
    return typeName[0]!.toLowerCase() + typeName.slice(1);
  }
  return typeName;
}

/**
 * Construct a `StateCellRecord` for an engine's auto-declared variable.
 * The record's `declNode` field references the `engine-decl` AST node;
 * downstream consumers reading engine-specific data (§51.0.B opener attrs,
 * state-children rules) reach them via the engine-decl, not through the
 * record's standard fields (which are state-decl-shaped).
 *
 * `_cellKind` is "engine"; `engineMeta` carries §51.0.B-C surface data.
 */
function makeEngineRecord(
  engineDecl: any,
  parentScope: Scope,
  varName: string,
): StateCellRecord {
  const forType: string = typeof engineDecl.governedType === "string"
    ? engineDecl.governedType
    : "";
  const initialVariant: string | null =
    typeof engineDecl.initialVariant === "string" && engineDecl.initialVariant.length > 0
      ? engineDecl.initialVariant
      : null;
  const isPinned: boolean = engineDecl.pinned === true;
  const isExported: boolean = engineDecl.isExported === true;
  // Derived expression — current parser provides `sourceVar` (legacy
  // `derived=@varname`). B16 will widen this to the §51.0.J expression-tree
  // form. Until then, sourceVar is the only signal.
  //
  // S83 B3 — Move-14 inline-expression body. When `inlineMatchBody` is
  // present, store the rich shape so codegen can emit a match-style
  // projection closure (lowering the match body via `rewriteExpr`).
  // The `upstream` field carries the same single-source data as legacy
  // shape, so DG cycle-detection and `_scrml_derived_subscribe` emission
  // continue to work identically (the closure body just differs).
  const derivedExpr: unknown | null = engineDecl.sourceVar != null
    ? (typeof engineDecl.inlineMatchBody === "string" && engineDecl.inlineMatchBody.length > 0
      ? { kind: "inline-match", upstream: engineDecl.sourceVar, matchBody: engineDecl.inlineMatchBody }
      : { kind: "legacy-source-var", varName: engineDecl.sourceVar })
    : null;

  const engineMeta: EngineMetadata = {
    forType,
    variants: [], // B14 leaves empty; B15 populates from the type system.
    initialVariant,
    derivedExpr,
    varName,
    isExported,
    isPinned,
    // A7 forward-compat fields (declared B14):
    parentEngine: null,
    innerEngines: [],
    historyAttr: undefined,
    internalRules: undefined,
    onTimeoutElements: undefined,
  };

  // The record's `declNode` is the engine-decl. We type it via `any` here
  // (matching the `declNode: ReactiveDeclNode` type signature using a cast)
  // so downstream consumers reading engine-specific data go through
  // `record.engineMeta` (the canonical surface for engine consumers).
  const record: StateCellRecord = {
    name: varName,
    qualifiedPath: parentScope.qualifiedPath + varName,
    declNode: engineDecl as any, // engine-decl-shaped, not state-decl-shaped.
    scope: parentScope,
    structuralForm: true,        // engine decls are spec-canonical.
    shape: "derived",            // engines auto-declare via the engine surface;
                                 // shape is "derived" to mark "not user-authored RHS".
    isConst: derivedExpr !== null, // derived engines are read-only (§51.0.J).
    isPinned,
    isCompoundParent: false,
    isCompoundChild: false,
    hasValidators: false,
    hasDefaultExpr: initialVariant !== null,
    hasTypeAnnotation: forType.length > 0,
    engineMeta,
  };
  return record;
}

/**
 * PASS 10.A — register engine cells. Walks the AST tree, finds every
 * `engine-decl` node, computes the auto-declared variable name per §51.0.C,
 * validates against same-scope name collisions, and registers a
 * StateCellRecord with `_cellKind: "engine"` + `engineMeta`.
 *
 * Same-scope determination is currently file-scope only (engines today are
 * file-scope per §51.0.K Machine Cohesion footnote — nested engines per
 * §51.0.Q are A7 territory and the parser doesn't yet construct walkable
 * inner bodies). Future: when nested engines land, the walker descends into
 * outer engine state-child bodies and registers nested engine records in
 * the outer engine's scope.
 */
function walkRegisterEngines(
  nodes: any,
  fileScope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkRegisterEngines(n, fileScope, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  const kind = node.kind;

  if (kind === "engine-decl") {
    registerEngineDecl(node, fileScope, errors, filePath);
    // A5-7 Wave 2.4 (§51.0.Q.1, Bug #2) — nested engine recursion. Phase A10
    // (S78) attaches `bodyChildren` (walkable AST) to each engine-decl; a
    // nested engine-decl inside a composite state-child body must ALSO be
    // registered so its `_record.engineMeta` is populated (otherwise codegen
    // never emits its substrate). The recursion respects Machine Cohesion
    // (§51.0.K): nested engines are PERMITTED in composite state-children
    // (singleton invariant preserved per outer-entry; outer × 1 = 1 inner).
    if (Array.isArray(node.bodyChildren)) {
      walkRegisterEngines(node.bodyChildren, fileScope, errors, filePath, visited);
    }
    return;
  }

  // Recurse into common AST containers. Mirror the existing walker shape so
  // engines declared inside <program>, <page>, etc. are reachable. We do not
  // descend into `function-decl` bodies (§51.0.K Machine Cohesion: engines
  // may NOT live inside function bodies); however, B14's deferred fire site
  // for that violation lives elsewhere.
  if (Array.isArray(node.children)) {
    walkRegisterEngines(node.children, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkRegisterEngines(node.body, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkRegisterEngines(node.consequent, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkRegisterEngines(node.alternate, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkRegisterEngines(arm.body, fileScope, errors, filePath, visited);
      }
    }
  }
}

/**
 * Register a single engine-decl into the file scope. Validates the chosen
 * variable name against same-scope state cells; fires
 * `E-ENGINE-VAR-DUPLICATE` on collision with a non-engine state-cell.
 */
function registerEngineDecl(
  engineDecl: any,
  fileScope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  // Resolve the variable name. The ast-builder already populates
  // `engineDecl.varName` per §51.0.C resolution order (var= override →
  // name= legacy → auto-derive from for=Type). Defensively re-derive when
  // varName is empty (defensive fallback for AST-shape drift).
  let varName: string = typeof engineDecl.varName === "string" && engineDecl.varName.length > 0
    ? engineDecl.varName
    : "";
  if (varName.length === 0) {
    if (typeof engineDecl.varNameOverride === "string" && engineDecl.varNameOverride.length > 0) {
      varName = engineDecl.varNameOverride;
    } else if (typeof engineDecl.engineName === "string" && engineDecl.engineName.length > 0) {
      varName = engineDecl.engineName;
    } else if (typeof engineDecl.governedType === "string" && engineDecl.governedType.length > 0) {
      varName = autoDeriveEngineVarName(engineDecl.governedType);
    }
  }
  // If we still have no name, the engine declaration is malformed at parse
  // level (no for= and no name= and no var=). Skip silently — the parser
  // already surfaces a diagnostic.
  if (varName.length === 0) return;

  // Collision check — does a state-cell ALREADY live at this name in the
  // file scope? Per §51.0.C: "You SHALL NOT separately declare the engine's
  // variable." If a `<varName> = init` exists in scope, fire
  // E-ENGINE-VAR-DUPLICATE. We check the file scope only — same-scope
  // semantics per §51.0.C. (Cross-scope name shadowing is captured by B2's
  // E-NAME-COLLIDES-STATE infrastructure on the OTHER side, not here.)
  const existing = fileScope.stateCells.get(varName);
  if (existing != null && existing.engineMeta == null) {
    // Existing record is a NON-engine state-cell — duplicate.
    fireEngineVarDuplicate(engineDecl, existing, varName, errors, filePath);
    return;
  }
  if (existing != null && existing.engineMeta != null) {
    // Two engines auto-declaring the same variable — also a duplicate.
    // Per §51.0.C, the engine OWNS its variable; two engines fighting for
    // the same name violates singleton-ness.
    fireEngineVarDuplicate(engineDecl, existing, varName, errors, filePath);
    return;
  }

  // Register.
  const record = makeEngineRecord(engineDecl, fileScope, varName);
  fileScope.stateCells.set(varName, record);

  // Stamp the engine-decl with `_record` and `_cellKind` annotations,
  // mirroring B1's state-decl convention. Non-enumerable so generic AST
  // walkers don't traverse the back-references.
  Object.defineProperty(engineDecl, "_record", {
    value: record,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(engineDecl, "_cellKind", {
    value: "engine",
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/**
 * Fire `E-ENGINE-VAR-DUPLICATE` per §51.0.C + §34. Triggered when an
 * engine's auto-declared variable name collides with an existing state
 * cell (or another engine) in the same scope.
 */
function fireEngineVarDuplicate(
  engineDecl: any,
  existing: StateCellRecord,
  varName: string,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const span: SYMDiagnostic["span"] = engineDecl.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  const conflictKind = existing.engineMeta != null
    ? "another `<engine>` declaration"
    : "a separately-declared state cell `<" + existing.qualifiedPath + ">`";
  const remediation = existing.engineMeta != null
    ? `Engines are singletons — only ONE engine may auto-declare \`${varName}\` in a scope. ` +
      `Use \`var=\` on one of the engines to disambiguate.`
    : `The engine OWNS its auto-declared variable. ` +
      `Either remove the separate \`<${varName}>\` declaration or use \`var=\` ` +
      `on the engine to override the auto-derived name.`;
  errors.push({
    code: "E-ENGINE-VAR-DUPLICATE",
    message:
      `E-ENGINE-VAR-DUPLICATE: engine variable \`${varName}\` collides with ${conflictKind}. ` +
      remediation +
      ` (SPEC §51.0.C + §34.)`,
    span,
    severity: "error",
  });
}

/**
 * PASS 10.B — cross-file engine mount validator. Walks markup for self-
 * closing tags whose tagName matches a registered import-binding. For each:
 *
 *   - Look up the source file's exportRegistry entry via `lookupImportBinding`.
 *   - If the exported entry's `category === "engine"`: legitimate cross-file
 *     mount; the imported singleton is the cell. No new record registered.
 *   - Else: fire `E-ENGINE-MOUNT-NOT-ENGINE` with the offending category
 *     and a remediation hint.
 *
 * Self-closing PascalCase tags are component instantiations OR same-file
 * components OR cross-file engine mounts. The discriminator is the import-
 * binding's source-export category — engine vs user-component vs other.
 *
 * Today's exportRegistry vocabulary (post-B14 MOD enhancement):
 *   "engine"          — engine-shaped exports (this dispatch's MOD update)
 *   "user-component"  — uppercase const exports
 *   "channel" | "type" | "function" | "const" | "other"
 *
 * Same-file engines: declaration position IS mount position per §51.0.D.
 * Use-site `<EngineName/>` tags at the SAME file scope are NOT engine
 * mounts — they would be parse errors (engines have no separate use-site
 * tag for same-file). B14's walker only fires on import-bound tags.
 */
function walkValidateCrossFileEngineMounts(
  nodes: any,
  fileScope: Scope,
  exportRegistry: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>> | undefined,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!exportRegistry) return; // No registry → cross-file check skipped.
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkValidateCrossFileEngineMounts(n, fileScope, exportRegistry, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  if (node.kind === "markup" && node.selfClosing === true && typeof node.tag === "string") {
    const tag = node.tag;
    // The tag must be a non-built-in (lowercase HTML tags pass through).
    // Look it up in the file's importBindings; if found, the user is
    // mounting an imported name. Validate the source export category.
    const binding = fileScope.importBindings.get(tag);
    if (binding) {
      // Path-shape resilience: try literal `binding.sourcePath` first
      // (relative-keyed test harnesses), then absolute-resolved (production
      // pipeline). See `lookupExportRegistry` docblock above.
      const sourceMap = lookupExportRegistry(exportRegistry, binding.sourcePath, filePath);
      if (sourceMap) {
        const exportInfo = sourceMap.get(binding.exportedName);
        if (exportInfo && exportInfo.category && exportInfo.category !== "engine") {
          // Not an engine — fire E-ENGINE-MOUNT-NOT-ENGINE.
          //
          // Suppression list (categories whose `<X/>` use-site is a
          // LEGITIMATE cross-file mount, not an engine mount):
          //   - `user-component` — component instantiation; CE/NR territory.
          //   - `channel`        — cross-file channel mount; CHX (CE phase 2)
          //                        inlines the source `<channel>` decl into
          //                        the consumer at this use-site. Firing
          //                        here would be a false positive for every
          //                        cross-file channel consumer (P3.A).
          // Other categories (function, type, const, …) have no mount
          // semantics — `<helper/>` for an imported function IS a user
          // error, and the diagnostic is the correct surface.
          //
          // Why this matters: pre-fix, the path-shape miss silently no-op'd
          // the entire walker in production, so legit channel mounts didn't
          // fire. Post-fix, the absolute-resolved lookup hits, and we MUST
          // suppress here to keep the channel mount path green.
          if (
            exportInfo.category !== "user-component" &&
            exportInfo.category !== "channel"
          ) {
            fireEngineMountNotEngine(node, tag, exportInfo.category, errors, filePath);
          }
        }
      }
    }
  }

  if (Array.isArray(node.children)) {
    walkValidateCrossFileEngineMounts(node.children, fileScope, exportRegistry, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkValidateCrossFileEngineMounts(node.body, fileScope, exportRegistry, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkValidateCrossFileEngineMounts(node.consequent, fileScope, exportRegistry, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkValidateCrossFileEngineMounts(node.alternate, fileScope, exportRegistry, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkValidateCrossFileEngineMounts(arm.body, fileScope, exportRegistry, errors, filePath, visited);
      }
    }
  }
}

/**
 * Fire `E-ENGINE-MOUNT-NOT-ENGINE` per §34 (catalog row added by B14).
 * Triggered when a self-closing tag in markup matches an imported binding
 * whose source export is NOT an engine.
 */
function fireEngineMountNotEngine(
  markupNode: any,
  tag: string,
  actualCategory: string,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const span: SYMDiagnostic["span"] = markupNode.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  errors.push({
    code: "E-ENGINE-MOUNT-NOT-ENGINE",
    message:
      `E-ENGINE-MOUNT-NOT-ENGINE: self-closing tag \`<${tag}/>\` mounts an imported name ` +
      `whose source export is a \`${actualCategory}\`, not an engine. ` +
      `Cross-file engine mount via \`<EngineName/>\` (§51.0.D + §21.8) requires the imported ` +
      `name to be the variable of an exported \`<engine>\` declaration. ` +
      `Either import an engine binding from the source file, or use the appropriate ` +
      `mount form for the imported \`${actualCategory}\` (e.g., component instantiation ` +
      `for components, expression read for const values).`,
    span,
    severity: "error",
  });
}

// ---------------------------------------------------------------------------
// PASS 11 (B15) — Engine state-child exhaustiveness + rule= typer +
// initial= validation
// ---------------------------------------------------------------------------
//
// Per Phase A1b Step B15 (audit §2 seven-point brief; SPEC §51.0.B/E/F/G,
// §34 catalog rows added by this dispatch):
//
// PASS 11 — VALIDATE ENGINE STATE-CHILDREN + RULE= + INITIAL=:
//   Walks every `engine-decl` AST node in the file. For each:
//
//     1. Populate `engineMeta.variants` from the file's typeRegistry (read
//        from `ast.typeDecls[]` — `parseEnumVariantsFromRaw` extracts
//        variant names). B14 left this empty; B15 populates here so
//        downstream consumers (B16, A1c) can read variants directly.
//
//     2. Validate `initial=` per §51.0.E. For NON-derived engines:
//          - absent → fire `W-ENGINE-INITIAL-MISSING` (lint; defaults to
//            first variant for codegen).
//          - present-but-not-a-valid-variant → fire
//            `E-ENGINE-INITIAL-INVALID-VARIANT`.
//        Derived engines (`derivedExpr !== null`) are SKIPPED — B16 owns
//        derived-specific rejections (E-DERIVED-ENGINE-NO-INITIAL).
//
//     3. Parse `engine-decl.rulesRaw` into state-children via
//        `parseEngineStateChildren` (engine-statechild-parser.ts). Skips
//        legacy `<machine>` arrow-rule bodies (the type-system handles
//        those via parseMachineRules).
//
//     4. Validate state-child exhaustiveness per §51.0.B + §51.0.F:
//          - For each variant of `engineMeta.variants`: confirm a state-
//            child with matching PascalCase tag exists. Missing → fire
//            `E-ENGINE-STATE-CHILD-MISSING`.
//          - For each state-child: confirm its tag is a variant. Unknown
//            → fire `E-ENGINE-STATE-CHILD-INVALID-VARIANT`.
//        Applied uniformly across non-derived AND derived engines (per
//        audit §1.3 — derived engines also list variants).
//
//     5. Validate `rule=` forms per §51.0.F three target-only forms:
//          - single-target / multi-target: every `.Variant` referenced
//            must be in `engineMeta.variants`. Mismatch → fire
//            `E-ENGINE-RULE-INVALID-VARIANT`.
//          - wildcard `*`: legal; no fire.
//          - legacy event-arrow form (`event -> Variant`): fire
//            `E-ENGINE-RULE-LEGACY-SYNTAX`.
//          - parse-error: fire `E-ENGINE-RULE-INVALID-VARIANT` (carries
//            the parser's diagnostic reason).
//
//     6. Records the parsed state-child entries onto
//        `engineMeta.stateChildren` for downstream B16 / B17 / A1c
//        consumption.
//
// **DEFERRED (per audit §1.4 + B15 brief #4 — body parser limitation):**
// Compile-time E-ENGINE-INVALID-TRANSITION for direct writes inside
// state-child bodies (`<Small>{@marioState = .Cape}` when `.Cape ∉
// .Small.rule`) requires the body to be walkable AST. Today the body is
// raw text. Once the parser elevates state-child bodies to walkable
// nodes, the same PASS 11 walker can dispatch on the engine variable's
// `_resolvedStateCell` annotation inside each body. See progress.md
// "DEFERRED ITEMS".
//
// Reusability: B15 READS B14's `engineMeta` to perform validation. B15
// does extend `engineMeta.variants` + `engineMeta.stateChildren` (the
// only annotations B15 owns); does NOT mutate B14's other fields.

/**
 * Parse enum variant names from a raw type body string. Splits on both
 * `,` and `\n` (and `|` for back-compat with the parseEnumVariantsFromRaw
 * shape) at depth 0 (parens-aware so payload field lists stay grouped).
 *
 * This mirrors the canonical type-system parser (`parseEnumBody` in
 * `type-system.ts`) but extracts ONLY variant names — payload + transition
 * info are not needed by B15. Done inline here to avoid pulling the full
 * `parseEnumBody` dependency chain into SYM.
 *
 * Per SPEC §14.4 — variants are declared one per line OR comma-separated
 * on one line (`{ Pending, Success(n:number), Failed }`). Payload-variant
 * fields like `(field:type, field:type)` keep their commas because the
 * parser tracks paren depth.
 */
function parseEnumVariantNamesFromRaw(raw: string): string[] {
  const out: string[] = [];
  let body = (raw || "").trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();
  if (!body) return out;

  // Strip transitions { ... } block if present (B15 only needs variants).
  // Find `transitions` keyword at depth 0.
  let variantsSection = body;
  {
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
      if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
      if (depth === 0 && body.slice(i).startsWith("transitions")) {
        const after = body.slice(i + "transitions".length).trimStart();
        if (after.startsWith("{")) {
          variantsSection = body.slice(0, i).trim();
          break;
        }
      }
    }
  }

  // Split on `\n`, `,`, and `|` at depth 0 (paren depth tracked).
  const segments: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < variantsSection.length; i++) {
    const ch = variantsSection[i]!;
    if (ch === "(" || ch === "[" || ch === "{") { depth++; buf += ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; buf += ch; continue; }
    if (depth === 0 && (ch === "\n" || ch === "," || ch === "|")) {
      if (buf.trim()) segments.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) segments.push(buf.trim());

  for (const seg of segments) {
    let text = seg;
    // Strip payload list `(...)`.
    const paren = text.indexOf("(");
    if (paren >= 0) text = text.slice(0, paren).trim();
    // Strip `renders ...` suffix.
    const rendersIdx = text.indexOf(" renders ");
    if (rendersIdx >= 0) text = text.slice(0, rendersIdx).trim();
    if (!text) continue;
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(text)) continue;
    out.push(text);
  }
  return out;
}

/**
 * B1 (§51.0.B.1) — Parse enum variant payload fields from a raw type body.
 * For each variant, returns its declared payload field names IN ORDER (or
 * an empty array for unit variants). This is the minimum information PASS
 * 11 needs to validate payload bindings: arity matching uses count, unit-
 * variant rejection uses empty-vs-non-empty, reserved-name collision uses
 * field name list, named-form unknown-field uses field name set.
 *
 * Mirror of the variant-name parser above (`parseEnumVariantNamesFromRaw`)
 * but ALSO captures payload field names. The full type-system parser
 * (`parseEnumBody` in type-system.ts) parses field types too, but PASS 11
 * needs only the field NAMES — types matter for the named-form binding type
 * propagation, which is a §18.7 inheritance handled downstream by the
 * type-system pass, not B15.
 *
 * Returns `Map<variantName, fieldNames[]>`. Unit variants map to `[]`.
 */
function parseEnumVariantPayloadFieldsFromRaw(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let body = (raw || "").trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();
  if (!body) return out;

  // Strip transitions { ... } block if present (parallel to variant-name parser).
  let variantsSection = body;
  {
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
      if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
      if (depth === 0 && body.slice(i).startsWith("transitions")) {
        const after = body.slice(i + "transitions".length).trimStart();
        if (after.startsWith("{")) {
          variantsSection = body.slice(0, i).trim();
          break;
        }
      }
    }
  }

  // Split variantsSection on `\n`, `,`, and `|` at depth 0 (paren-aware so
  // payload field lists stay grouped).
  const segments: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < variantsSection.length; i++) {
    const ch = variantsSection[i]!;
    if (ch === "(" || ch === "[" || ch === "{") { depth++; buf += ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; buf += ch; continue; }
    if (depth === 0 && (ch === "\n" || ch === "," || ch === "|")) {
      if (buf.trim()) segments.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) segments.push(buf.trim());

  for (const seg of segments) {
    let text = seg.trim();
    if (text.startsWith(".")) text = text.slice(1).trim();
    // Strip `renders ...` suffix after the payload list (or after the name
    // for unit variants).
    const parenIdx = text.indexOf("(");
    let name: string;
    let fields: string[] = [];
    if (parenIdx >= 0) {
      name = text.slice(0, parenIdx).trim();
      const closeParen = text.lastIndexOf(")");
      if (closeParen > parenIdx) {
        const fieldList = text.slice(parenIdx + 1, closeParen).trim();
        if (fieldList) {
          // Split on commas at depth 0 (in case of nested generics like
          // `tokens: Token[]` — the brackets are at depth 1).
          const parts: string[] = [];
          let d = 0;
          let fbuf = "";
          for (let i = 0; i < fieldList.length; i++) {
            const ch = fieldList[i]!;
            if (ch === "(" || ch === "[" || ch === "{") { d++; fbuf += ch; continue; }
            if (ch === ")" || ch === "]" || ch === "}") { d--; fbuf += ch; continue; }
            if (d === 0 && ch === ",") {
              if (fbuf.trim()) parts.push(fbuf.trim());
              fbuf = "";
              continue;
            }
            fbuf += ch;
          }
          if (fbuf.trim()) parts.push(fbuf.trim());
          for (const p of parts) {
            // `fieldName: typeExpr` — extract just the field name.
            const colon = p.indexOf(":");
            if (colon >= 0) {
              const fn = p.slice(0, colon).trim();
              if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fn)) fields.push(fn);
            }
          }
        }
      }
    } else {
      // Strip `renders` suffix for unit variants.
      const rendersIdx = text.indexOf(" renders ");
      name = rendersIdx >= 0 ? text.slice(0, rendersIdx).trim() : text;
    }
    if (!name) continue;
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) continue;
    out.set(name, fields);
  }
  return out;
}

/**
 * B1 (§51.0.B.1) — look up an enum type's variants WITH their payload field
 * names from the file's `typeDecls`. Returns null when the type was not
 * found OR is not an enum. Mirror of `getEnumVariantsFromTypeDecls` but
 * preserves field info needed for payload-binding validation.
 */
function getEnumVariantPayloadFieldsFromTypeDecls(
  typeDecls: any[] | undefined,
  typeName: string,
): Map<string, string[]> | null {
  if (!Array.isArray(typeDecls)) return null;
  for (const decl of typeDecls) {
    if (!decl || typeof decl !== "object") continue;
    if (decl.kind !== "type-decl") continue;
    if (decl.name !== typeName) continue;
    if (decl.typeKind !== "enum") return null;
    return parseEnumVariantPayloadFieldsFromRaw(decl.raw || "");
  }
  return null;
}

/**
 * Look up the variants of an enum type by name in the file's `typeDecls`.
 * Returns the parsed variant-name list, or `null` when the type was not
 * found OR is not an enum (B15 doesn't validate against struct types
 * directly; the type-system pass already errors on non-enum/struct
 * `for=` via E-ENGINE-004).
 *
 * The lookup is done over `ast.typeDecls[]` rather than the type-system's
 * resolved `typeRegistry` because the type-system pass runs LATER than
 * SYM in today's pipeline (per `compiler/PIPELINE.md`).
 */
function getEnumVariantsFromTypeDecls(
  typeDecls: any[] | undefined,
  typeName: string,
): string[] | null {
  if (!Array.isArray(typeDecls)) return null;
  for (const decl of typeDecls) {
    if (!decl || typeof decl !== "object") continue;
    if (decl.kind !== "type-decl") continue;
    if (decl.name !== typeName) continue;
    if (decl.typeKind !== "enum") return null;
    return parseEnumVariantNamesFromRaw(decl.raw || "");
  }
  return null;
}

/**
 * Fire a SYM diagnostic with a fallback span (engine-decl's span) when
 * the offending sub-element doesn't have its own span. Today's parser
 * doesn't produce per-state-child spans (rulesRaw is text); B15 uses the
 * engine-decl's span as a coarse anchor. Future parser tightening will
 * produce per-state-child spans automatically.
 */
function fireB15Diagnostic(
  errors: SYMDiagnostic[],
  code: string,
  message: string,
  engineDecl: any,
  filePath: string,
  severity: "error" | "warning" = "error",
): void {
  const span: SYMDiagnostic["span"] = engineDecl?.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  errors.push({ code, message, span, severity });
}

/**
 * PASS 11 — per-engine validation. For each `engine-decl` carrying a
 * `_record` (set by PASS 10.A), populate `engineMeta.variants`, validate
 * `initial=`, parse state-children from `rulesRaw`, validate exhaustiveness
 * and `rule=` forms.
 *
 * Exported for direct test use (B18 §B18.8 fire-site #2 verifies the
 * E-MULTI-STATEMENT-HANDLER fire on synthetic engine-decls — needed
 * because BS doesn't yet tokenize `:`-shorthand engine bodies, so
 * full-pipeline integration tests can't reach this fire-site today).
 */
export function validateEngineStateChildrenAndRules(
  engineDecl: any,
  fileAst: any,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  // engineDecl._record is set by PASS 10.A; if absent (parse failure case),
  // skip silently — the upstream pass would have surfaced the underlying
  // problem.
  const record: StateCellRecord | undefined = engineDecl._record;
  if (!record || !record.engineMeta) return;
  const meta = record.engineMeta;

  // Step 1 — populate variants from the file's typeDecls (B14 left empty).
  const forType: string = meta.forType;
  let variants: string[] = [];
  if (forType.length > 0) {
    const lookup = getEnumVariantsFromTypeDecls(fileAst.typeDecls, forType);
    if (Array.isArray(lookup)) variants = lookup;
  }
  meta.variants = variants;

  // If we have no variants (unknown type, struct type, or import), we
  // can't validate against the variant set. Skip steps 2 + 4 + 5 (which
  // depend on knowing the variants). Still parse state-children for
  // structural validation in step 3 + 5 (rule= form check is variant-
  // independent for the legacy-arrow case).
  const variantSet = new Set(variants);

  const isDerived = meta.derivedExpr !== null && meta.derivedExpr !== undefined;

  // Step 2 — initial= validation (§51.0.E). Skip for derived engines
  // (B16 owns derived-specific rejections per audit §1.4 boundary).
  if (!isDerived) {
    if (meta.initialVariant === null) {
      fireB15Diagnostic(
        errors,
        "W-ENGINE-INITIAL-MISSING",
        `W-ENGINE-INITIAL-MISSING: \`<engine for=${forType}>\` is missing the required ` +
        `\`initial=.Variant\` attribute. Per SPEC §51.0.E, non-derived engines must specify ` +
        `their starting state. The compiler will default to the first state-child's variant ` +
        `for codegen, but adding \`initial=.Variant\` makes the choice explicit.`,
        engineDecl,
        filePath,
        "warning",
      );
    } else if (variants.length > 0 && !variantSet.has(meta.initialVariant)) {
      const variantList = variants.map((v) => `.${v}`).join(", ");
      fireB15Diagnostic(
        errors,
        "E-ENGINE-INITIAL-INVALID-VARIANT",
        `E-ENGINE-INITIAL-INVALID-VARIANT: \`initial=.${meta.initialVariant}\` is not a variant of ` +
        `\`${forType}\`. Valid variants are: ${variantList}. Either correct the variant reference ` +
        `or add \`.${meta.initialVariant}\` to the type.`,
        engineDecl,
        filePath,
        "error",
      );
    }
  }

  // Step 3 — parse state-children from rulesRaw.
  const rulesRaw: string = typeof engineDecl.rulesRaw === "string" ? engineDecl.rulesRaw : "";
  const stateChildren = parseEngineStateChildren(rulesRaw);
  meta.stateChildren = stateChildren;

  // Step 3.5 (A5-6, S77) — scan for engine-root `<onIdle>` event-timeout
  // watchdog entries. Validates placement (engine-root only — inside-state-
  // child = E-IDLE-MISPLACED), duplicates (E-IDLE-DUPLICATE), variant target
  // (E-IDLE-INVALID-VARIANT). Only one `<onIdle>` per engine; first valid
  // wins.
  meta.idleWatchdog = null;
  if (!isDerived) {
    const idleEntries = scanForOnIdleEntries(rulesRaw);
    if (idleEntries.length > 0) {
      // Build a list of state-child body ranges (rawOffset for the opener
      // through rawOffset + bodyRaw.length + closer). The parseEngineStateChildren
      // exit doesn't preserve closer positions; approximate via rulesRaw scan
      // for the matching `</>` per state-child. For each `<onIdle>`, classify
      // by whether its rawOffset falls inside any state-child opener-to-closer
      // range.
      const stateChildRanges: Array<[number, number]> = [];
      for (const sc of stateChildren) {
        if (typeof sc.rawOffset !== "number") continue;
        // Find the matching closer after the opener. Self-closing state-children
        // (no inner content) get a zero-width range — `<onIdle>` cannot be inside
        // a self-closing tag, so they don't contribute false positives.
        const openerStart = sc.rawOffset;
        const bodyLen = typeof sc.bodyRaw === "string" ? sc.bodyRaw.length : 0;
        if (bodyLen === 0) continue;
        // Approximate end: opener-end + bodyRaw.length. Conservative; we only
        // need to detect "inside a non-empty body".
        const openerEnd = rulesRaw.indexOf(">", openerStart);
        if (openerEnd < 0) continue;
        stateChildRanges.push([openerEnd + 1, openerEnd + 1 + bodyLen]);
      }

      let acceptedIdle: OnIdleEntry | null = null;
      let duplicateFired = false;
      for (const entry of idleEntries) {
        // Misplacement check (E-IDLE-MISPLACED).
        let misplaced = false;
        for (const [a, b] of stateChildRanges) {
          if (entry.rawOffset >= a && entry.rawOffset < b) {
            misplaced = true;
            break;
          }
        }
        if (misplaced) {
          fireB15Diagnostic(
            errors,
            "E-IDLE-MISPLACED",
            `E-IDLE-MISPLACED: \`<onIdle>\` is only legal at the engine-root scope ` +
            `(sibling of state-children). Per SPEC §51.0.R, \`<onIdle>\` is a machine-wide ` +
            `watchdog and cannot be nested inside a state-child body. For per-state ` +
            `timer-fire-on-state-entry semantics, use \`<onTimeout>\` (§51.0.M) instead.`,
            engineDecl,
            filePath,
            "error",
          );
          continue;
        }

        // Variant check (E-IDLE-INVALID-VARIANT). Only fire when we have a
        // resolved variant set; defer otherwise (matches step 2 + 4 pattern).
        if (entry.to.length === 0) {
          fireB15Diagnostic(
            errors,
            "E-IDLE-INVALID-VARIANT",
            `E-IDLE-INVALID-VARIANT: \`<onIdle>\` is missing the required \`to=.Variant\` ` +
            `attribute, or the value is malformed. Per SPEC §51.0.R, \`<onIdle>\` requires ` +
            `\`to=.Variant\` (target variant of \`for=${forType}\`).`,
            engineDecl,
            filePath,
            "error",
          );
          continue;
        }
        if (variants.length > 0 && !variantSet.has(entry.to)) {
          const variantList = variants.map((v) => `.${v}`).join(", ");
          fireB15Diagnostic(
            errors,
            "E-IDLE-INVALID-VARIANT",
            `E-IDLE-INVALID-VARIANT: \`<onIdle to=.${entry.to}/>\` references a variant not in ` +
            `\`${forType}\`. Valid variants: ${variantList}.`,
            engineDecl,
            filePath,
            "error",
          );
          continue;
        }

        // Duplicate check (E-IDLE-DUPLICATE) — first valid entry wins.
        if (acceptedIdle !== null) {
          if (!duplicateFired) {
            fireB15Diagnostic(
              errors,
              "E-IDLE-DUPLICATE",
              `E-IDLE-DUPLICATE: engine \`<engine for=${forType}>\` declares more than one ` +
              `\`<onIdle/>\` element. Per SPEC §51.0.R, an engine has at most one event-timeout ` +
              `watchdog. Remove the duplicate or merge into a single entry.`,
              engineDecl,
              filePath,
              "error",
            );
            duplicateFired = true;
          }
          continue;
        }
        acceptedIdle = entry;
      }
      meta.idleWatchdog = acceptedIdle;
    }
  }

  // For legacy arrow-rule bodies, the parser returns []. In that case,
  // we DO NOT fire E-ENGINE-STATE-CHILD-MISSING — the legacy form is
  // type-system territory, not B15 territory.
  if (stateChildren.length === 0 && isLegacyArrowRulesBody(rulesRaw)) {
    return;
  }

  // Step 4 — exhaustiveness + invalid state-child tag validation. Only
  // run when we have a known variant set (variants resolved from
  // typeDecls).
  if (variants.length > 0) {
    // 4.a — every variant must have a state-child.
    const seenTags = new Set(stateChildren.map((sc) => sc.tag));
    for (const variant of variants) {
      if (!seenTags.has(variant)) {
        fireB15Diagnostic(
          errors,
          "E-ENGINE-STATE-CHILD-MISSING",
          `E-ENGINE-STATE-CHILD-MISSING: \`<engine for=${forType}>\` body is missing a ` +
          `state-child for variant \`.${variant}\`. Per SPEC §51.0.B + §51.0.F, every variant ` +
          `of the engine type must have a corresponding state-child (\`<${variant}>...</>\`). ` +
          `Add the missing state-child, or remove \`.${variant}\` from \`${forType}\` if it ` +
          `is unreachable.`,
          engineDecl,
          filePath,
          "error",
        );
      }
    }
    // 4.b — every state-child tag must be a known variant.
    for (const sc of stateChildren) {
      if (!variantSet.has(sc.tag)) {
        const variantList = variants.map((v) => `.${v}`).join(", ");
        fireB15Diagnostic(
          errors,
          "E-ENGINE-STATE-CHILD-INVALID-VARIANT",
          `E-ENGINE-STATE-CHILD-INVALID-VARIANT: state-child tag \`<${sc.tag}>\` in ` +
          `\`<engine for=${forType}>\` does not match any variant of \`${forType}\`. ` +
          `Valid variants are: ${variantList}. Either rename the tag to a valid variant or ` +
          `add \`${sc.tag}\` to \`${forType}\`.`,
          engineDecl,
          filePath,
          "error",
        );
      }
    }
  }

  // Step 5 — rule= form + rule= variant validation per §51.0.F.
  for (const sc of stateChildren) {
    const r = sc.rule;
    switch (r.kind) {
      case "absent":
      case "wildcard":
        // Legal. `absent` = terminal state; `wildcard` = escape hatch.
        break;

      case "legacy-arrow":
        fireB15Diagnostic(
          errors,
          "E-ENGINE-RULE-LEGACY-SYNTAX",
          `E-ENGINE-RULE-LEGACY-SYNTAX: state-child \`<${sc.tag} rule=${r.raw}>\` uses the ` +
          `legacy event-arrow form. On \`<engine>\`, \`rule=\` must be one of the three §51.0.F ` +
          `target-only forms: single-target (\`rule=.NextVariant\`), multi-target (\`rule=(.A | .B)\`), ` +
          `or wildcard (\`rule=*\`). Event-arrow rules belong to the deprecated \`<machine>\` syntax (§51.3).`,
          engineDecl,
          filePath,
          "error",
        );
        break;

      case "single":
        if (variants.length > 0 && !variantSet.has(r.target)) {
          const variantList = variants.map((v) => `.${v}`).join(", ");
          fireB15Diagnostic(
            errors,
            "E-ENGINE-RULE-INVALID-VARIANT",
            `E-ENGINE-RULE-INVALID-VARIANT: \`<${sc.tag} rule=.${r.target}>\` references variant ` +
            `\`.${r.target}\` which is not in \`${forType}\`. Valid variants are: ${variantList}.`,
            engineDecl,
            filePath,
            "error",
          );
        }
        break;

      case "multi":
        if (variants.length > 0) {
          for (const t of r.targets) {
            if (!variantSet.has(t)) {
              const variantList = variants.map((v) => `.${v}`).join(", ");
              fireB15Diagnostic(
                errors,
                "E-ENGINE-RULE-INVALID-VARIANT",
                `E-ENGINE-RULE-INVALID-VARIANT: \`<${sc.tag}>\` rule= multi-target list contains ` +
                `\`.${t}\` which is not in \`${forType}\`. Valid variants are: ${variantList}.`,
                engineDecl,
                filePath,
                "error",
              );
            }
          }
        }
        break;

      case "parse-error":
        fireB15Diagnostic(
          errors,
          "E-ENGINE-RULE-INVALID-VARIANT",
          `E-ENGINE-RULE-INVALID-VARIANT: \`<${sc.tag}>\` has an unparseable \`rule=\` value ` +
          `\`${r.raw}\` — ${r.reason}. Use one of the §51.0.F forms: single-target ` +
          `(\`rule=.NextVariant\`), multi-target (\`rule=(.A | .B)\`), or wildcard (\`rule=*\`).`,
          engineDecl,
          filePath,
          "error",
        );
        break;
    }
  }

  // ----------------------------------------------------------------------
  // B1 (§51.0.B.1, S98 amendment — track 2 compiler-feature wiring) —
  // payload-binding validation. Three new diagnostic codes per the §34
  // amendment:
  //
  //   - E-ENGINE-PAYLOAD-ON-UNIT-VARIANT — bindings declared on a variant
  //     that has no payload fields (unit variant per §14.4).
  //   - E-ENGINE-PAYLOAD-ARITY-MISMATCH — positional binding count ≠
  //     variant payload field count; OR mixed positional + named forms on
  //     one opener (§18.7 mixed-form prohibition extends to this locus).
  //   - E-ENGINE-PAYLOAD-RESERVED-COLLISION — a variant payload field name
  //     collides with a reserved state-child attribute name
  //     (`rule`, `effect`, `history`, `internal:rule`). Reserved-name
  //     precedence makes the bare-attribute form unable to bind such a
  //     field; the diagnostic directs the adopter to rename the field at
  //     declaration site OR use the parenthesized form with a non-colliding
  //     local name.
  //
  // Requires variant payload field info from typeDecls. Skipped silently
  // when the type is unresolved (same pattern as Step 4 + 5 above —
  // type-system pass will fire its own diagnostic in that case).
  // ----------------------------------------------------------------------
  if (variants.length > 0) {
    const RESERVED_STATE_CHILD_ATTRS = new Set<string>([
      "rule", "effect", "history", "internal:rule",
    ]);
    const variantPayloadFields = getEnumVariantPayloadFieldsFromTypeDecls(
      fileAst.typeDecls,
      forType,
    );
    if (variantPayloadFields !== null) {
      for (const sc of stateChildren) {
        const bindings = sc.payloadBindings;
        if (!bindings || bindings.length === 0) continue;
        // Skip state-children with an unknown variant — Step 4.b already
        // fired E-ENGINE-STATE-CHILD-INVALID-VARIANT. Doubling up on
        // payload diagnostics would be noisy and unhelpful.
        if (!variantSet.has(sc.tag)) continue;

        const declaredFields = variantPayloadFields.get(sc.tag) ?? [];

        // -- E-ENGINE-PAYLOAD-ON-UNIT-VARIANT --
        // Unit variant (no payload fields) cannot host any bindings.
        if (declaredFields.length === 0) {
          fireB15Diagnostic(
            errors,
            "E-ENGINE-PAYLOAD-ON-UNIT-VARIANT",
            `E-ENGINE-PAYLOAD-ON-UNIT-VARIANT: state-child \`<${sc.tag}>\` declares ` +
            `payload binding${bindings.length === 1 ? "" : "s"} ` +
            `(${bindings.map((b) => b.kind === "positional" ? b.name : `${b.field}=${b.name}`).join(", ")}) ` +
            `but variant \`.${sc.tag}\` is a unit variant with no payload fields ` +
            `(declared as \`${sc.tag}\` in \`${forType}\`). Per SPEC §51.0.B.1, ` +
            `payload bindings are valid only on payload-bearing variants ` +
            `(declared with named fields per §14.4 — e.g., \`${sc.tag}(field:type)\`). ` +
            `Either add payload fields to the variant declaration or remove the binding ` +
            `attributes from the state-child opener.`,
            engineDecl,
            filePath,
            "error",
          );
          continue;
        }

        // -- Mixed-form prohibition (E-ENGINE-PAYLOAD-ARITY-MISMATCH) --
        // §18.7 forbids mixing positional and named bindings in the same
        // arm pattern; §51.0.B.1 inherits this prohibition.
        const hasPositional = bindings.some((b) => b.kind === "positional");
        const hasNamed = bindings.some((b) => b.kind === "named");
        if (hasPositional && hasNamed) {
          fireB15Diagnostic(
            errors,
            "E-ENGINE-PAYLOAD-ARITY-MISMATCH",
            `E-ENGINE-PAYLOAD-ARITY-MISMATCH: state-child \`<${sc.tag}>\` mixes positional ` +
            `and named payload bindings in the same opener. Per SPEC §51.0.B.1 + §18.7, ` +
            `bindings within one state-child opener must be either ALL positional ` +
            `(bare-attribute or parenthesized form: \`<${sc.tag} ${declaredFields.join(" ")}>\`) ` +
            `OR ALL named (field=local form: \`<${sc.tag} ${declaredFields.map((f) => `${f}=<local>`).join(" ")}>\`). ` +
            `Convert the bindings to a single form.`,
            engineDecl,
            filePath,
            "error",
          );
          continue;
        }

        // -- E-ENGINE-PAYLOAD-ARITY-MISMATCH (positional arity) --
        // Positional bindings: count MUST match variant payload field count
        // exactly. Per SPEC §51.0.B.1 normative-statements line 21690-21692.
        if (hasPositional) {
          if (bindings.length !== declaredFields.length) {
            const fieldList = declaredFields.join(", ");
            fireB15Diagnostic(
              errors,
              "E-ENGINE-PAYLOAD-ARITY-MISMATCH",
              `E-ENGINE-PAYLOAD-ARITY-MISMATCH: state-child \`<${sc.tag}>\` declares ` +
              `${bindings.length} positional payload binding${bindings.length === 1 ? "" : "s"} ` +
              `but variant \`.${sc.tag}\` has ${declaredFields.length} payload field${declaredFields.length === 1 ? "" : "s"} ` +
              `(${fieldList}). Per SPEC §51.0.B.1, positional binding count must match the ` +
              `variant's payload field count exactly. Either list all ${declaredFields.length} ` +
              `field bindings in declaration order, or use the named form (\`field=local\`) ` +
              `to bind a subset by field name.`,
              engineDecl,
              filePath,
              "error",
            );
            continue;
          }
        }

        // -- E-ENGINE-PAYLOAD-RESERVED-COLLISION --
        // Reserved-name precedence per §51.0.B.1: a payload field name that
        // collides with a reserved state-child attribute (`rule`, `effect`,
        // `history`, `internal:rule`) cannot be bound via the bare-attribute
        // form. We fire this when ANY declared payload field name is in the
        // reserved set — the binding cannot be reliably extracted via the
        // bare-attribute path, so the adopter must rename the field OR
        // restructure to use the parenthesized form's positional binding
        // with a non-colliding local name.
        //
        // Scope: we check the VARIANT'S declared field names against the
        // reserved set (not just the binding NAMES the adopter wrote).
        // Rationale: in the bare-attribute form, the parser cannot have
        // extracted a binding named e.g. `rule` (it would be the rule=
        // attribute), so checking written-binding names against the reserved
        // set would miss the silent collision. The variant-side check
        // surfaces the conflict at the declaration site precisely as
        // §51.0.B.1 requires.
        const collidingFields = declaredFields.filter((f) => RESERVED_STATE_CHILD_ATTRS.has(f));
        if (collidingFields.length > 0) {
          // Only fire when the adopter is actually trying to bind on this
          // state-child (i.e., bindings.length > 0 — already guaranteed
          // above). Otherwise the variant declares a colliding field name
          // but the state-child has no bindings → no silent collision.
          fireB15Diagnostic(
            errors,
            "E-ENGINE-PAYLOAD-RESERVED-COLLISION",
            `E-ENGINE-PAYLOAD-RESERVED-COLLISION: variant \`.${sc.tag}\` declares payload ` +
            `field${collidingFields.length === 1 ? "" : "s"} named \`${collidingFields.join("`, `")}\` ` +
            `which collide${collidingFields.length === 1 ? "s" : ""} with reserved engine state-child ` +
            `attribute name${collidingFields.length === 1 ? "" : "s"} ` +
            `(\`rule\`, \`effect\`, \`history\`, \`internal:rule\` — per §51.0.B/F/H/N/O). ` +
            `The reserved attribute interpretation takes precedence over payload binding in the ` +
            `bare-attribute form, so the field cannot be bound via that form on state-child ` +
            `\`<${sc.tag}>\`. Per SPEC §51.0.B.1, either rename the payload field at its ` +
            `declaration site (\`${forType}\`) OR use the parenthesized form with a non-colliding ` +
            `local name (e.g., \`<${sc.tag}(${declaredFields.map((f) => collidingFields.includes(f) ? `${f}_local` : f).join(", ")})>\`).`,
            engineDecl,
            filePath,
            "error",
          );
          continue;
        }

        // -- Named-form unknown-field check (E-TYPE-022 inherited from §18.7) --
        // For named bindings, each `field` MUST match a declared payload
        // field name. We fire E-TYPE-022 to align with §18.7's named-form
        // unknown-field diagnostic. (Adopter fixes by either renaming the
        // LHS or removing the binding.)
        if (hasNamed) {
          const fieldSet = new Set(declaredFields);
          for (const b of bindings) {
            if (b.kind === "named" && !fieldSet.has(b.field)) {
              const fieldList = declaredFields.join(", ");
              fireB15Diagnostic(
                errors,
                "E-TYPE-022",
                `E-TYPE-022: state-child \`<${sc.tag}>\` named binding \`${b.field}=${b.name}\` ` +
                `references field \`${b.field}\` which is not declared on variant \`.${sc.tag}\` ` +
                `of \`${forType}\`. Declared payload fields: ${fieldList}. Per SPEC §18.7 + ` +
                `§51.0.B.1, named-form bindings bind by declared field name. Either correct the ` +
                `field name or use positional form (\`<${sc.tag} <local1> <local2>>\`).`,
                engineDecl,
                filePath,
                "error",
              );
            }
          }
        }
      }
    }
  }

  // ----------------------------------------------------------------------
  // A1b B18 fire-site #2 — multi-statement `:`-shorthand body validation
  // (E-MULTI-STATEMENT-HANDLER) per SPEC §4.14 line 980 + §34 row 14260.
  //
  // For each state-child whose body was parsed via the `:`-shorthand path
  // (`<Variant : single-expression>`), fire E-MULTI-STATEMENT-HANDLER if
  // the post-`:` text contains a top-level `;` outside expression-internal
  // contexts (strings, parens, braces, brackets, comments, ${...}).
  //
  // Bare-body state-children (`<Variant>...children...</>`) and self-
  // closing forms are EXEMPT — multi-statement intent is legal in those.
  // Only the `:`-shorthand single-expression discipline is governed by
  // this rule.
  // ----------------------------------------------------------------------
  for (const sc of stateChildren) {
    if (!sc.isColonShorthand) continue;
    if (!sc.bodyRaw || sc.bodyRaw.length === 0) continue;
    const hits = scanForTopLevelSemicolon(sc.bodyRaw);
    if (hits.length === 0) continue;
    fireB15Diagnostic(
      errors,
      "E-MULTI-STATEMENT-HANDLER",
      `E-MULTI-STATEMENT-HANDLER: \`:\`-shorthand body of state-child \`<${sc.tag}>\` ` +
      `contains multiple statements (semicolon-separated). The \`:\`-shorthand body must ` +
      `be exactly one expression — a call (\`<${sc.tag} : fn()>\`), a single expression, ` +
      `or markup-as-value. For multi-statement intent, switch to bare-body form ` +
      `\`<${sc.tag}>...children + logic...</>\` or lift to a named function ` +
      `(SPEC §4.14 / §5.2.3 / §34).`,
      engineDecl,
      filePath,
      "error",
    );
  }
}

/**
 * PASS 11 walker — visits every engine-decl in the AST and runs B15
 * validation. Mirrors the structural-recursion pattern of PASS 10.A
 * (walkRegisterEngines).
 */
function walkValidateEngineStateChildrenAndRules(
  nodes: any,
  fileAst: any,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkValidateEngineStateChildrenAndRules(n, fileAst, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  if (node.kind === "engine-decl") {
    validateEngineStateChildrenAndRules(node, fileAst, errors, filePath);
    // A5-7 Wave 2.4 (§51.0.Q.1, Bug #2) — recurse into bodyChildren to
    // validate NESTED engines too (so their `engineMeta.stateChildren`,
    // `engineMeta.variants`, etc. are populated for codegen). The state-
    // child bodies themselves remain RAW TEXT for direct-write scanning
    // (handled at fire-site #9 in PASS 16 / `validateEngineA5Extensions`);
    // this recursion only descends through the bodyChildren tree to find
    // nested engine-decl nodes.
    if (Array.isArray(node.bodyChildren)) {
      walkValidateEngineStateChildrenAndRules(node.bodyChildren, fileAst, errors, filePath, visited);
    }
    return;
  }

  if (Array.isArray(node.children)) {
    walkValidateEngineStateChildrenAndRules(node.children, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkValidateEngineStateChildrenAndRules(node.body, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkValidateEngineStateChildrenAndRules(node.consequent, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkValidateEngineStateChildrenAndRules(node.alternate, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkValidateEngineStateChildrenAndRules(arm.body, fileAst, errors, filePath, visited);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// B16: Derived-engine rejections (PASS 12) — A1b Phase
// ---------------------------------------------------------------------------
//
// Per SPEC §51.0.J (Lock L20), a derived engine — declared via
// `<engine for=Type derived=expr>` — must reject three classes of authoring
// at compile time:
//
//   1. `initial=` attribute on the engine declaration —
//      `E-DERIVED-ENGINE-NO-INITIAL`. Initial value is computed from
//      `derived=expr` at engine-init time; an authored `initial=` is
//      meaningless and contradicts the derivation contract.
//
//   2. `rule=` attribute on a state-child — `E-DERIVED-ENGINE-NO-RULES`.
//      Transitions are determined by the source expression, not authored.
//      Today's parser (§51.0.B-J Move 14) does NOT yet expose state-children
//      with `rule=` attributes structurally; until then, B16 fires
//      NO-RULES whenever a derived engine's `rulesRaw` body contains any
//      transition rules (the line-shape `.From => .To` form). When the
//      parser learns Move 14, the same walker reads the structured
//      state-children directly.
//
//   3. Direct write to the engine's auto-declared variable (or `.advance(.X)`
//      method-call form per §51.0.G) — `E-DERIVED-ENGINE-NO-WRITE`. Derived
//      engine variables are read-only — the variable is the value of the
//      `derived=expr` reactively recomputed.
//
// Cycle detection (`E-DERIVED-ENGINE-CIRCULAR`) lives in
// `dependency-graph.ts` (B16 PHASE 3 in DG); see SECOND-consumer comment
// at `buildEngineDerivedAdj` for the reuse pattern with B7's
// `detectCycle`.
//
// **Walker shape:** AST-driven structural recursion, mirrors PASS 5 / PASS 6
// / PASS 7 / PASS 10.A. Visits every `engine-decl` node; for each derived
// engine (per `_record.engineMeta.derivedExpr !== null`), runs three
// sub-checks (NO-INITIAL on the decl itself; NO-RULES on `rulesRaw`).
// Then visits every `bare-expr` node looking for direct-write or
// `.advance(.X)` shapes whose target ident matches a registered derived-
// engine variable; fires NO-WRITE.
//
// **OUT OF B16 SCOPE:**
//   - `E-DERIVED-ENGINE-INITIAL-UNDEFINED` (runtime, A1c codegen).
//   - General `E-ENGINE-INVALID-TRANSITION` on non-derived engines (B15 +
//     A1c per audit §1.3).
//   - `<onTransition>` and `effect=` validation (B17, uniformly, per
//     §51.0.J line 20409 — these are LEGAL on derived-engine state-children).
//   - Move-14-shape state-child structural walking (awaits ast-builder).

/**
 * Resolve a derived-engine variable name to its `EngineMetadata` from the
 * file scope. Returns the metadata if and only if the cell exists, is an
 * engine, and has a non-null `derivedExpr` whose `kind` is NOT
 * `"legacy-source-var"`.
 *
 * **Why exclude `legacy-source-var`:** The legacy §51.9 derived/projection
 * machine form (`<machine name=UI for=T derived=@source>`) has its OWN
 * write-rejection path (`E-ENGINE-017`, type-system.ts) and uses `=>`
 * projection rules in its body as the projection MAPPING (legal there).
 * §51.0.J Move-14-shape derived engines (`<engine derived=match @x {...}>`)
 * have a structurally different `derivedExpr` and forbid all three
 * authoring forms (rules, initial=, direct writes).
 *
 * Today's parser (ast-builder.js line 8449) only emits the legacy form
 * via `engine-decl.sourceVar`; B14 wraps it as
 * `{ kind: "legacy-source-var", varName }`. When ast-builder learns the
 * §51.0.J rich-expression form, `derivedExpr` will carry a parsed
 * ExprNode (or a `kind` discriminant other than `"legacy-source-var"`),
 * at which point this lookup begins returning hits and B16's rejections
 * fire. Until then, the trio of NO-RULES / NO-INITIAL / NO-WRITE
 * silently no-ops on legacy-form derivations — preventing double-fire
 * with E-ENGINE-017 and not flagging legitimate §51.9 projection rules.
 */
function lookupDerivedEngineMeta(
  fileScope: Scope,
  varName: string,
): { record: StateCellRecord; meta: EngineMetadata } | null {
  const rec = fileScope.stateCells.get(varName);
  if (!rec || !rec.engineMeta) return null;
  const dExpr = rec.engineMeta.derivedExpr;
  if (dExpr === null || dExpr === undefined) return null;
  if (typeof dExpr === "object"
      && (dExpr as Record<string, unknown>).kind === "legacy-source-var") {
    return null;
  }
  return { record: rec, meta: rec.engineMeta };
}

/**
 * Detect whether the engine's `rulesRaw` body contains user-authored
 * transition rule lines. Per §51.0.J line 20406, derived engines REJECT
 * `rule=` on state-children — the rules-body should be EMPTY (or contain
 * only `<onTransition>` blocks per §51.0.J line 20409, which are LEGAL).
 *
 * Today's parser places transition rule lines like `.From => .To` inside
 * `rulesRaw`. We detect the presence of `=>` outside of comments and
 * outside of `<onTransition>` blocks as the trigger for NO-RULES. (The
 * `audit @name` clause is also stripped before B16 sees the body via
 * `type-system.ts:buildMachineRegistry`, but B16 reads the unsplit
 * `rulesRaw` — we conservatively skip lines that look like `audit @ident`
 * to avoid false positives even though those don't compile to rules.)
 *
 * Returns true if at least one rule-shaped line is present.
 */
function derivedEngineHasAuthoredRules(rulesRaw: string): boolean {
  if (typeof rulesRaw !== "string" || rulesRaw.length === 0) return false;
  // Strip line comments to avoid false positives in commented-out rules.
  // Line-comment shape: leading `//` after optional whitespace; trailing
  // `// comment` mid-line is rare in rules but stripped via regex.
  const lines = rulesRaw.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (line.length === 0) continue;
    // Skip audit clause if present.
    if (/^audit\s+@[A-Za-z_$][A-Za-z0-9_$]*\s*$/.test(line)) continue;
    // A transition rule line contains `=>` separating from-spec and to-spec.
    // We don't deeply parse here; presence of `=>` is the authored-rule
    // signal. Note: `<onTransition>` markup blocks would not contain `=>`
    // at the top level of `rulesRaw` (they're tag-shaped), so this check
    // is robust against the legal transition-handler form.
    if (line.includes("=>")) return true;
  }
  return false;
}

/**
 * Fire `E-DERIVED-ENGINE-NO-INITIAL` on a derived engine that has an
 * `initial=` attribute set. Per SPEC §51.0.J line 20407 + §34 catalog row.
 */
function fireDerivedEngineNoInitial(
  engineDecl: any,
  varName: string,
  initialVariant: string,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const span: SYMDiagnostic["span"] = engineDecl.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  errors.push({
    code: "E-DERIVED-ENGINE-NO-INITIAL",
    message:
      `E-DERIVED-ENGINE-NO-INITIAL: derived engine \`@${varName}\` has an ` +
      `\`initial=.${initialVariant}\` attribute. Derived engines compute their ` +
      `initial value from the \`derived=\` expression at engine-init time; ` +
      `\`initial=\` is meaningless on a derived engine and contradicts the ` +
      `derivation contract (SPEC §51.0.J + §34). Remove the \`initial=\` ` +
      `attribute.`,
    span,
    severity: "error",
  });
}

/**
 * Fire `E-DERIVED-ENGINE-NO-RULES` on a derived engine whose body contains
 * authored transition rules. Per SPEC §51.0.J line 20406 + §34 catalog row.
 */
function fireDerivedEngineNoRules(
  engineDecl: any,
  varName: string,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const span: SYMDiagnostic["span"] = engineDecl.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  errors.push({
    code: "E-DERIVED-ENGINE-NO-RULES",
    message:
      `E-DERIVED-ENGINE-NO-RULES: derived engine \`@${varName}\` declares ` +
      `transition rules (\`.From => .To\` form) in its body. Derived engines ` +
      `do NOT permit authored transitions — transitions are determined by the ` +
      `\`derived=\` source expression, not authored (SPEC §51.0.J + §34). ` +
      `Remove the rule lines; if you need transition handlers, use ` +
      `\`<onTransition>\` elements or \`effect=\` attributes on state-children ` +
      `(those remain LEGAL on derived engines).`,
    span,
    severity: "error",
  });
}

/**
 * Fire `E-DERIVED-ENGINE-NO-WRITE` for a direct write or `.advance(...)`
 * call to a derived engine's auto-declared variable. Per SPEC §51.0.J line
 * 20408 + §34 catalog row + §51.0.G `.advance` symmetry.
 */
function fireDerivedEngineNoWrite(
  bareExprNode: any,
  varName: string,
  isAdvance: boolean,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const span: SYMDiagnostic["span"] = bareExprNode.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  const writeForm = isAdvance
    ? `\`@${varName}.advance(...)\``
    : `\`@${varName} = ...\``;
  errors.push({
    code: "E-DERIVED-ENGINE-NO-WRITE",
    message:
      `E-DERIVED-ENGINE-NO-WRITE: ${writeForm} writes to derived engine ` +
      `\`@${varName}\`. Derived-engine variables are read-only — the value is ` +
      `reactively computed from the \`derived=\` expression and cannot be ` +
      `directly assigned (SPEC §51.0.J + §34). \`.advance(.X)\` is also rejected ` +
      `per §51.0.G: it is method-style transition that targets the same ` +
      `read-only variable. To change the engine's value, mutate the upstream ` +
      `cell(s) referenced in the \`derived=\` expression.`,
    span,
    severity: "error",
  });
}

/**
 * PASS 12 walker: scan engine-decl nodes for derived engines and fire
 * E-DERIVED-ENGINE-NO-INITIAL / NO-RULES per the engine's annotation.
 *
 * Mirrors `walkRegisterEngines` (PASS 10.A) recursion shape — engines live
 * as markup children, not logic. The `_record` annotation set by PASS 10.A
 * is the trigger predicate.
 *
 * Exported for tests that simulate the future Move-14 ast-builder by
 * mutating `engineMeta.derivedExpr` to a non-legacy shape, then directly
 * invoking this walker without re-running runSYM (which would overwrite
 * the mutation via PASS 10.A's `makeEngineRecord`).
 */
export function walkDerivedEngineDeclRejections(
  nodes: any,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkDerivedEngineDeclRejections(n, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  if (node.kind === "engine-decl") {
    const record: StateCellRecord | undefined = node._record;
    if (record && record.engineMeta) {
      const meta = record.engineMeta;
      const dExpr = meta.derivedExpr;
      // Skip non-derived engines (B15 owns those rules).
      if (dExpr === null || dExpr === undefined) {
        return;
      }
      // Skip legacy §51.9 derived/projection machines — they are governed
      // by `E-ENGINE-017` (writes) and §51.9 projection-rule semantics
      // (their `=>` body lines ARE the projection map, not authored
      // transitions). See `lookupDerivedEngineMeta` for full rationale.
      if (typeof dExpr === "object"
          && (dExpr as Record<string, unknown>).kind === "legacy-source-var") {
        return;
      }
      // Move-14 shape derived engine — run rejection checks.
      const varName = meta.varName ?? "";
      // NO-INITIAL: `initial=` on a derived engine.
      if (meta.initialVariant !== null && meta.initialVariant !== undefined) {
        fireDerivedEngineNoInitial(
          node, varName, meta.initialVariant, errors, filePath,
        );
      }
      // NO-RULES: authored transition rules in the body.
      const rulesRaw: string = typeof node.rulesRaw === "string" ? node.rulesRaw : "";
      if (derivedEngineHasAuthoredRules(rulesRaw)) {
        fireDerivedEngineNoRules(node, varName, errors, filePath);
      }
    }
    // A5-7 Wave 2.4 (§51.0.Q.1, Bug #2) — recurse into bodyChildren to
    // apply rejection checks to nested derived engines too. A nested
    // engine inside a composite state-child must satisfy the same
    // derived-engine rules (§51.0.J + §34) as a file-scope engine.
    if (Array.isArray(node.bodyChildren)) {
      walkDerivedEngineDeclRejections(node.bodyChildren, errors, filePath, visited);
    }
    return;
  }

  // Generic recursion. Mirror PASS 10.A's walker shape.
  if (Array.isArray(node.children)) {
    walkDerivedEngineDeclRejections(node.children, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkDerivedEngineDeclRejections(node.body, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkDerivedEngineDeclRejections(node.consequent, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkDerivedEngineDeclRejections(node.alternate, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkDerivedEngineDeclRejections(arm.body, errors, filePath, visited);
      }
    }
  }
}

/**
 * Detect direct-write and `.advance(.X)` shapes targeting a derived engine.
 *
 * Inspects a `bare-expr` node's `exprNode` (preferred) or string `expr`
 * fallback. Two shapes fire `E-DERIVED-ENGINE-NO-WRITE`:
 *
 *   1. **Direct write:** `assign` ExprNode with `target.kind === "ident"`
 *      and `target.name === "@<varName>"` where `<varName>` is a derived-
 *      engine cell. Covers `=`, `+=`, `-=`, `*=`, `/=`, `%=`, `**=`, `&&=`,
 *      `||=`, `??=`, `&=`, `|=`, `^=`, `<<=`, `>>=`, `>>>=`. (Compound-
 *      assigns are also writes.)
 *
 *   2. **Method-style transition:** `call` ExprNode where
 *      `callee.kind === "member"`, `callee.object.kind === "ident"` with
 *      name `@<varName>` (derived-engine cell), and
 *      `callee.property === "advance"`. Per §51.0.G, `.advance(.X)` is
 *      symmetric with direct writes; on derived engines it is rejected.
 *
 * Note: B16 walks ONLY the `bare-expr` node level (statement-level direct
 * writes). Writes nested inside expression contexts (e.g.,
 * `if (cond) { @phase = .X }`) descend into nested logic-block bodies via
 * the recursion.
 */
function checkBareExprForDerivedEngineWrite(
  bareExprNode: any,
  fileScope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const exprNode = bareExprNode.exprNode;
  if (exprNode && typeof exprNode === "object") {
    checkExprNodeForDerivedEngineWrite(exprNode, bareExprNode, fileScope, errors, filePath);
  }
}

/**
 * Recursively walk an ExprNode for derived-engine write shapes.
 * Reports against the OUTER bare-expr node's span (more reliable absolute
 * offsets than ExprNode spans, mirroring B8's pattern).
 */
function checkExprNodeForDerivedEngineWrite(
  expr: any,
  bareExprNode: any,
  fileScope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  if (!expr || typeof expr !== "object") return;
  const seen = new WeakSet<object>();

  function walk(n: any): void {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    const k = n.kind;

    // Shape 1: direct write `@varname [op]= ...`
    if (k === "assign" && n.target && n.target.kind === "ident"
        && typeof n.target.name === "string" && n.target.name.startsWith("@")) {
      const varName = n.target.name.slice(1);
      const hit = lookupDerivedEngineMeta(fileScope, varName);
      if (hit) {
        fireDerivedEngineNoWrite(bareExprNode, varName, /*isAdvance=*/false, errors, filePath);
        // Don't double-fire on nested shapes; continue descent below for
        // unrelated nested writes (e.g., `@x = (@phase.advance(.A), 1)` —
        // both fires are appropriate).
      }
    }

    // Shape 2: `.advance(.X)` method-style transition on a derived engine.
    if (k === "call" && n.callee && n.callee.kind === "member"
        && typeof n.callee.property === "string"
        && n.callee.property === "advance"
        && n.callee.object && n.callee.object.kind === "ident"
        && typeof n.callee.object.name === "string"
        && n.callee.object.name.startsWith("@")) {
      const varName = n.callee.object.name.slice(1);
      const hit = lookupDerivedEngineMeta(fileScope, varName);
      if (hit) {
        fireDerivedEngineNoWrite(bareExprNode, varName, /*isAdvance=*/true, errors, filePath);
      }
    }

    // Recurse into structural sub-fields. ExprNode shapes carry various
    // child ExprNodes; a generic walk over enumerable properties covers
    // them. We skip `span` and any `_*` annotation fields.
    for (const key of Object.keys(n)) {
      if (key === "span" || key.startsWith("_")) continue;
      const v = (n as any)[key];
      if (v && typeof v === "object") {
        if (Array.isArray(v)) {
          for (const item of v) walk(item);
        } else {
          walk(v);
        }
      }
    }
  }

  walk(expr);
}

/**
 * Detect a state-decl-shaped write to a derived engine variable. The
 * scrml parser surfaces `@varname = expr` (and compound-assign forms) AS
 * `state-decl` nodes even inside function bodies — there is no separate
 * assignment-statement kind in the AST today. This is the same pattern
 * `rejectWritesToDerivedVars` (type-system.ts:2118) detects for legacy
 * E-ENGINE-017.
 *
 * Trigger: a `state-decl` whose `name` matches a derived-engine cell var
 * AND which is NOT the engine's own auto-declaration (the state-decl
 * lives in a different declaration site, e.g., inside a function body).
 *
 * The engine's auto-declaration is the engine-decl AST node — distinct
 * `kind`, so `state-decl` always represents an authored variable
 * binding/assignment, never the engine's own var.
 */
function checkStateDeclForDerivedEngineWrite(
  stateDecl: any,
  fileScope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const varName: unknown = stateDecl.name;
  if (typeof varName !== "string" || varName.length === 0) return;
  const hit = lookupDerivedEngineMeta(fileScope, varName);
  if (!hit) return;
  fireDerivedEngineNoWrite(stateDecl, varName, /*isAdvance=*/false, errors, filePath);
}

/**
 * PASS 12 walker (write side): scan AST for direct-write / `.advance`
 * shapes targeting a derived-engine cell. Two AST surfaces fire NO-WRITE:
 *
 *   1. `bare-expr` nodes whose `exprNode` is `assign` (member or ident
 *      target) or `call` with `.advance` member-method shape — covers
 *      reassignments to a previously-declared cell, and `.advance(.X)`.
 *   2. `state-decl` nodes whose `name` matches a derived-engine var —
 *      the scrml parser surfaces `@var = expr` as a state-decl in
 *      logic / function bodies regardless of whether the var is already
 *      registered. Mirrors `rejectWritesToDerivedVars` (legacy
 *      E-ENGINE-017 path) which walks `state-decl` for the same reason.
 *
 * Mirrors B8's `walkDerivedValueMutate` recursion shape (function bodies,
 * state-decl children, match-arm bodies, etc.).
 *
 * Exported alongside `walkDerivedEngineDeclRejections` for test direct-
 * invocation; see that walker's docs for rationale.
 */
export function walkDerivedEngineWriteRejections(
  nodes: any,
  fileScope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkDerivedEngineWriteRejections(n, fileScope, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  const kind = node.kind;

  if (kind === "bare-expr") {
    checkBareExprForDerivedEngineWrite(node, fileScope, errors, filePath);
    // bare-exprs are leaf statement nodes — no body recursion needed; the
    // ExprNode walk inside `checkBareExprForDerivedEngineWrite` covers
    // nested expression sub-shapes.
    return;
  }

  if (kind === "state-decl") {
    // Detect `@<derived-engine-var> = ...` surfaced as a state-decl.
    // Skip if this state-decl IS the engine's own auto-declaration —
    // engine-decls have `kind === "engine-decl"`, not `"state-decl"`,
    // so reaching here means the state-decl is a user-authored binding
    // attempting to write the engine var.
    checkStateDeclForDerivedEngineWrite(node, fileScope, errors, filePath);
    // Continue descent — state-decl children may carry nested writes.
  }

  // Recurse into common containers.
  if (Array.isArray(node.children)) {
    walkDerivedEngineWriteRejections(node.children, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkDerivedEngineWriteRejections(node.body, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkDerivedEngineWriteRejections(node.consequent, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkDerivedEngineWriteRejections(node.alternate, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkDerivedEngineWriteRejections(arm.body, fileScope, errors, filePath, visited);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PASS 12.B (v0.3 Option-d) — W-ENGINE-SELF-WRITE-DETECTED outside-state-child
// ---------------------------------------------------------------------------
//
// Per SPEC §51.0.F (v0.3 Option-d synthesis), self-writes to an engine cell
// (`@var = .CurrentVariant` from inside `<CurrentVariant>`) are RUNTIME NO-OPS.
// Fire-site #10 inside `validateEngineA5Extensions` handles the STRICT case
// (write occurs inside the state-child body whose tag matches the target).
//
// THIS WALKER handles the CONSERVATIVE outside-state-child case: writes from
// function bodies, top-level logic blocks, event handlers OUTSIDE any engine
// state-child body. The current variant is NOT statically known at these
// sites — but if the target is a literal `.Variant` matching the engine's
// declared variants, the write IS A SELF-WRITE WHENEVER the runtime current
// variant happens to equal that target. Per v0.3 Option-d, that's a no-op.
//
// Fire condition: `@<varName> = .<Variant>` OR `@<varName>.advance(.<Variant>)`
// where `<varName>` resolves to a NON-DERIVED engine cell AND `<Variant>` is
// listed in the engine's `meta.variants`. Severity: info.
//
// This is INTENTIONALLY CONSERVATIVE — it surfaces an opportunity for the
// adopter to verify intent ("this write may be a no-op when you weren't
// expecting it"). False positives are acceptable for info-level lints
// (BRIEF: "info-level allows false positives").
//
// SCOPE: walks function-decl bodies and top-level bare-exprs/state-decls.
// SKIPS engine-decl.bodyChildren descent — fire-site #10 owns those (state-
// child raw bodies). Recursion mirrors `walkDerivedEngineWriteRejections`.

/**
 * Resolve a non-derived engine variable to its metadata. Returns null when
 * the cell does not exist, is not an engine, or IS a derived engine (those
 * have their own NO-WRITE rejection path via `walkDerivedEngineWriteRejections`).
 *
 * Walks the parent-chain (current scope -> enclosing scope -> ... -> file)
 * so engine cells registered at file scope are reachable from inside nested
 * function bodies.
 */
function lookupNonDerivedEngineMeta(
  scope: Scope,
  varName: string,
): { record: StateCellRecord; meta: EngineMetadata } | null {
  // Engine cells are registered at file scope by PASS 1.c
  // (walkRegisterEngines). Walk the parent chain to find the file scope
  // entry — mirrors `lookupStateCell` semantics for engine cells.
  let s: Scope | null = scope;
  while (s !== null) {
    const rec = s.stateCells.get(varName);
    if (rec && rec.engineMeta) {
      const meta = rec.engineMeta;
      // SKIP derived engines — `walkDerivedEngineWriteRejections` owns those
      // with E-DERIVED-ENGINE-NO-WRITE; do NOT double-fire info.
      const dExpr = meta.derivedExpr;
      if (dExpr !== null && dExpr !== undefined) {
        if (typeof dExpr === "object"
            && (dExpr as Record<string, unknown>).kind !== "legacy-source-var") {
          return null; // §51.0.J derived engine — NO-WRITE owner
        }
        // Legacy §51.9 derived (`derivedExpr.kind === "legacy-source-var"`)
        // is governed by E-ENGINE-017 — also not our concern.
        return null;
      }
      return { record: rec, meta };
    }
    s = s.parent;
  }
  return null;
}

/**
 * Extract a bare-variant tag name (`.Variant`) from an ExprNode value.
 *
 * Per `expression-parser.ts:938`, the parser unmasks the preprocessor
 * placeholder `__scrml_bare_variant_X__` back to `IdentExpr { name: ".X" }`.
 * So a literal `.Variant` on the RHS of `@phase = .Variant` is an `ident`
 * ExprNode whose name starts with `.`.
 *
 * Qualified forms (`Type.Variant`) are NOT matched — they are `MemberExpr`
 * shapes; identifier-resolution beyond raw text is out of scope for this
 * conservative lint (mirrors the fire-site #9 cascade-miss scanner posture).
 *
 * Returns the variant name (no leading dot) on match, null otherwise.
 */
function extractBareVariantName(expr: any): string | null {
  if (!expr || typeof expr !== "object") return null;
  if (expr.kind !== "ident") return null;
  const name: unknown = expr.name;
  if (typeof name !== "string") return null;
  if (!name.startsWith(".")) return null;
  const bare = name.slice(1);
  if (bare.length === 0) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(bare)) return null;
  return bare;
}

/**
 * Fire W-ENGINE-SELF-WRITE-DETECTED (info) for an outside-state-child write
 * to an engine cell. The current variant is dynamic; the target IS a literal
 * variant of the engine's `for=Type`. Per v0.3 §51.0.F Option-d, the write
 * is a no-op WHENEVER the runtime current variant equals the target.
 */
function fireEngineSelfWriteDetectedOutside(
  reportNode: any,
  varName: string,
  variantName: string,
  isAdvance: boolean,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const span: SYMDiagnostic["span"] = reportNode?.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  const writeRepr = isAdvance
    ? `@${varName}.advance(.${variantName})`
    : `@${varName} = .${variantName}`;
  errors.push({
    code: "W-ENGINE-SELF-WRITE-DETECTED",
    message:
      `W-ENGINE-SELF-WRITE-DETECTED: \`${writeRepr}\` targets a literal variant ` +
      `of engine \`@${varName}\`. The enclosing context is OUTSIDE any engine ` +
      `state-child body, so the runtime current variant is not statically known ` +
      `here. Per SPEC §51.0.F (v0.3 Option-d synthesis), when the runtime current ` +
      `variant equals \`.${variantName}\`, this write is an idempotent NO-OP ` +
      `(no \`<onTransition>\`, no timer rearm, no history capture, no subscriber ` +
      `notification). If this no-op-when-already-in-state behavior is INTENTIONAL ` +
      `(e.g., a defensive set in a code path reachable from multiple variants), ` +
      `this lint is informational only — no action required. If you expected a ` +
      `state change unconditionally, verify the write target or guard the call ` +
      `site (\`if (@${varName} != .${variantName}) ...\`).`,
    span,
    severity: "info",
  });
}

/**
 * Recursively walk an ExprNode subtree for `@<engineVar> = .<Variant>` and
 * `@<engineVar>.advance(.<Variant>)` shapes targeting non-derived engine cells.
 *
 * Mirrors `checkExprNodeForDerivedEngineWrite` shape (write-detection inside
 * arbitrary expression trees).
 */
function checkExprNodeForOutsideSelfWrite(
  expr: any,
  reportNode: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  if (!expr || typeof expr !== "object") return;
  const seen = new WeakSet<object>();

  function walk(n: any): void {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    const k = n.kind;

    // Shape 1: direct write `@varname = .Variant` (op MUST be `"="` — compound-
    // assigns like `+=` cannot meaningfully target a variant tag).
    if (k === "assign" && n.op === "=" && n.target && n.target.kind === "ident"
        && typeof n.target.name === "string" && n.target.name.startsWith("@")) {
      const varName = n.target.name.slice(1);
      const hit = lookupNonDerivedEngineMeta(scope, varName);
      if (hit) {
        const variantName = extractBareVariantName(n.value);
        if (variantName !== null
            && Array.isArray(hit.meta.variants)
            && hit.meta.variants.includes(variantName)) {
          fireEngineSelfWriteDetectedOutside(
            reportNode, varName, variantName, /*isAdvance=*/false, errors, filePath,
          );
        }
      }
    }

    // Shape 2: `@varname.advance(.Variant)`.
    if (k === "call" && n.callee && n.callee.kind === "member"
        && typeof n.callee.property === "string"
        && n.callee.property === "advance"
        && n.callee.object && n.callee.object.kind === "ident"
        && typeof n.callee.object.name === "string"
        && n.callee.object.name.startsWith("@")) {
      const varName = n.callee.object.name.slice(1);
      const hit = lookupNonDerivedEngineMeta(scope, varName);
      if (hit && Array.isArray(n.args) && n.args.length >= 1) {
        const variantName = extractBareVariantName(n.args[0]);
        if (variantName !== null
            && Array.isArray(hit.meta.variants)
            && hit.meta.variants.includes(variantName)) {
          fireEngineSelfWriteDetectedOutside(
            reportNode, varName, variantName, /*isAdvance=*/true, errors, filePath,
          );
        }
      }
    }

    // Recurse into structural sub-fields. Same posture as
    // checkExprNodeForDerivedEngineWrite.
    for (const key of Object.keys(n)) {
      if (key === "span" || key.startsWith("_")) continue;
      const v = (n as any)[key];
      if (v && typeof v === "object") {
        if (Array.isArray(v)) {
          for (const item of v) walk(item);
        } else {
          walk(v);
        }
      }
    }
  }

  walk(expr);
}

/**
 * Detect outside-state-child engine self-writes by walking bare-expr +
 * state-decl AST nodes outside any engine state-child body. SKIPS descent
 * into `engine-decl.bodyChildren` — fire-site #10 (in
 * `validateEngineA5Extensions`) owns state-child raw bodies.
 *
 * Recursion shape mirrors `walkDerivedEngineWriteRejections` minus the
 * engine-decl descent.
 */
export function walkEngineSelfWriteOutside(
  nodes: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkEngineSelfWriteOutside(n, scope, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  const kind = node.kind;

  // STOP at engine-decl: fire-site #10 owns the state-child raw bodies; we
  // do NOT recurse into `bodyChildren` here. The engine-decl's OWN init
  // (`initial=.X`) is NOT a write event — skip the engine-decl entirely.
  if (kind === "engine-decl") return;

  // bare-expr: walk its exprNode for assign / advance-call shapes.
  if (kind === "bare-expr") {
    if (node.exprNode && typeof node.exprNode === "object") {
      checkExprNodeForOutsideSelfWrite(node.exprNode, node, scope, errors, filePath);
    }
    return; // leaf — no further descent
  }

  // state-decl: the scrml parser surfaces `@var = expr` (and compound-assign
  // forms) as state-decl nodes even inside function bodies. Mirrors
  // `checkStateDeclForDerivedEngineWrite`'s observation. Only fire when the
  // decl's name resolves to an engine cell AND the init is a bare variant
  // literal of that engine.
  if (kind === "state-decl") {
    const declName: unknown = node.name;
    if (typeof declName === "string" && declName.length > 0) {
      const hit = lookupNonDerivedEngineMeta(scope, declName);
      if (hit && node.initExpr && typeof node.initExpr === "object") {
        const variantName = extractBareVariantName(node.initExpr);
        if (variantName !== null
            && Array.isArray(hit.meta.variants)
            && hit.meta.variants.includes(variantName)) {
          fireEngineSelfWriteDetectedOutside(
            node, declName, variantName, /*isAdvance=*/false, errors, filePath,
          );
        }
      }
    }
    // Continue descent — children may carry nested writes (compound state-
    // decl body, etc.).
  }

  // function-decl: descend into body using the function's own scope (so
  // engine cells from enclosing file scope are still resolvable via the
  // parent-chain walk in lookupNonDerivedEngineMeta).
  if (kind === "function-decl") {
    const fnScope = (node as any)._scope ?? scope;
    if (Array.isArray(node.body)) {
      walkEngineSelfWriteOutside(node.body, fnScope, errors, filePath, visited);
    }
    return;
  }

  // Generic recursion. Mirrors walkDerivedEngineWriteRejections shape.
  if (Array.isArray(node.children)) {
    walkEngineSelfWriteOutside(node.children, scope, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkEngineSelfWriteOutside(node.body, scope, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkEngineSelfWriteOutside(node.consequent, scope, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkEngineSelfWriteOutside(node.alternate, scope, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkEngineSelfWriteOutside(arm.body, scope, errors, filePath, visited);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PASS 13 (B17) — components-vs-engines residual fire-site (M20, §51.0.K)
// ---------------------------------------------------------------------------
//
// Per Phase A1b Step B17 (audit §1.2 + §2 brief #6; SPEC §51.0.K, §34):
//
//   §51.0.K: "A component declaration body contains an `<engine>` element"
//   is forbidden. Engines are singletons; instantiating a component multiple
//   times would produce multiple "singletons", violating the singleton
//   invariant. Fire `E-COMPONENT-ENGINE-SCOPE` (§34).
//
//   The S67 §51.0.K Machine Cohesion footnote (line 20453-20454) reaffirms:
//   "Engines MAY NOT be declared inside component bodies (E-COMPONENT-
//   ENGINE-SCOPE)."
//
// **Fire-site ownership history (B14 audit §1.5 + B17 audit §1.2):**
//
//   The B14 audit recommended B14 fire E-COMPONENT-ENGINE-SCOPE at the
//   engine-decl walk site. B14 deferred to B17 because component-def
//   bodies (`component-def.raw: string`) are not parsed as walkable AST
//   children today — engine-decls inside the markup body are not
//   reachable from the AST walker. B17 inherits this deferral.
//
// **What B17 fires today (per Phase 0 survey):**
//
//   `component-def.defChildren` — an array of sibling AST nodes consumed
//   after a component-def in the same logic-body parent (per
//   ast-builder.js line 8647-8663). These nodes are conceptually scoped
//   to the component (used for component-local CSS, scoped helpers,
//   etc.) and ARE walkable AST. An `engine-decl` in defChildren violates
//   §51.0.K Machine Cohesion: the engine would be component-scoped, but
//   engines are file-scope-or-nested-engine-only.
//
//   Note: today's parser pipeline NEVER places `engine-decl` AST nodes
//   inside a logic-body (per ast-builder.js line 9149-9151: "engine-decl
//   nodes are children of markup (program), not logic"), so the walker
//   does not fire end-to-end via the parser today. The walker is
//   defensive scaffolding that fires correctly the moment a future
//   precondition step (component-body markup parser, or relaxation of
//   the engine placement rule) makes the shape reachable. A synthesized
//   AST test exercises the walker today; end-to-end parser tests are
//   `.skip`-ed pending preconditions.
//
// **What B17 still DEFERS (audit §2 brief items 1-5, 7):**
//
//   - `effect=` placement + form validation (engine state-children not parsed)
//   - `<onTransition>` placement + direction attributes (element not tokenized)
//   - E-COMPONENT-ENGINE-SCOPE for engine-decl inside the component-def
//     `raw` markup body (component body markup not parsed)
//   - Engine mount tag `<EngineName/>` inside a component body (same)
//   - `<onTransition>` / `effect=` inside `<match>` arms (block-form match
//     not parsed)
//
//   See `docs/changes/phase-a1b-step-b17-ontransition-component-engine/SURVEY.md`
//   for the precondition catalog.

/**
 * PASS 13 (B17) — fire E-COMPONENT-ENGINE-SCOPE on `engine-decl` nodes
 * appearing inside any `component-def.defChildren` array reachable from
 * `ast.nodes`.
 *
 * Today's PASS 10.A (`walkRegisterEngines`) does NOT descend into
 * `defChildren`, so engines that DO somehow reach a defChildren array
 * are not registered as engines. B17 fires the diagnostic instead —
 * surfacing the §51.0.K violation loudly rather than silently dropping
 * the engine.
 *
 * The `raw` markup body of component-defs (the actual component template)
 * remains unparsed; engines authored inside the markup string are NOT
 * detected here. That fire-site is documented as deferred until the
 * component-body markup parser lands (see Phase 0 survey).
 */
function walkRejectEnginesInComponentDefChildren(
  nodes: any,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkRejectEnginesInComponentDefChildren(n, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;

  // Fire on engine-decls in this component-def's defChildren. Recurse into
  // each defChild so a component-def nested inside another component's
  // defChildren is also inspected.
  if (node.kind === "component-def" && Array.isArray(node.defChildren)) {
    for (const child of node.defChildren) {
      if (!child || typeof child !== "object") continue;
      if (child.kind === "engine-decl") {
        fireComponentEngineScope(child, node.name, errors, filePath);
      }
      // Recurse so nested constructs inside defChildren are still walked.
      walkRejectEnginesInComponentDefChildren(child, errors, filePath, visited);
    }
  }

  // Standard recursion mirrors PASS 10.A's shape.
  if (Array.isArray(node.children)) {
    walkRejectEnginesInComponentDefChildren(node.children, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkRejectEnginesInComponentDefChildren(node.body, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkRejectEnginesInComponentDefChildren(node.consequent, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkRejectEnginesInComponentDefChildren(node.alternate, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkRejectEnginesInComponentDefChildren(arm.body, errors, filePath, visited);
      }
    }
  }
  // Phase A10 (S78) — descend into engine-decl.bodyChildren so a nested
  // engine-decl reachable inside an OUTER engine state-child body of an
  // engine that itself lives in a component-def fires E-COMPONENT-ENGINE-
  // SCOPE. Outer-engine-in-component-def fire-site already runs above
  // (defChildren scan); this branch covers the inner-engine recursive case.
  // Engines INSIDE engines (NOT inside components) are PERMITTED per §51.0.Q
  // hierarchy/nesting rules; the fire-condition checks above (component-def
  // -> engine-decl direct child) are unchanged.
  if (node.kind === "engine-decl" && Array.isArray(node.bodyChildren)) {
    walkRejectEnginesInComponentDefChildren(node.bodyChildren, errors, filePath, visited);
  }
}

/**
 * Fire `E-COMPONENT-ENGINE-SCOPE` per §51.0.K + §34. Triggered when an
 * `engine-decl` appears inside a `component-def.defChildren` array.
 *
 * The diagnostic message names the offending component, the engine, and
 * recommends the spec-canonical alternatives: declare the engine at file
 * scope and mount via `<EngineName/>` (§51.0.D), or use plain reactive
 * cells (`@cell`) inside the component for per-instance state.
 */
function fireComponentEngineScope(
  engineDecl: any,
  componentName: string,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const span: SYMDiagnostic["span"] = engineDecl.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  // Reach for the engine's variable name when known (B14 records it on
  // engine-decl); fall back to the governed type or a generic placeholder.
  const engineLabel: string =
    (typeof engineDecl.varName === "string" && engineDecl.varName.length > 0)
      ? `\`<engine for=${engineDecl.governedType ?? "Type"} ...>\` (var \`${engineDecl.varName}\`)`
      : (typeof engineDecl.governedType === "string" && engineDecl.governedType.length > 0)
        ? `\`<engine for=${engineDecl.governedType} ...>\``
        : "`<engine ...>`";
  errors.push({
    code: "E-COMPONENT-ENGINE-SCOPE",
    message:
      `E-COMPONENT-ENGINE-SCOPE: ${engineLabel} appears inside the body of component ` +
      `\`${componentName}\`. Engines are singletons; instantiating \`${componentName}\` ` +
      `multiple times would produce multiple "singleton" engines, violating the ` +
      `singleton invariant. ` +
      `Either declare the engine at file scope and mount it inside the component ` +
      `via \`<EngineName/>\` (§51.0.D), or use plain reactive cells (\`@cell\`) inside ` +
      `the component for per-instance state. ` +
      `(SPEC §51.0.K + §34.)`,
    span,
    severity: "error",
  });
}



// ---------------------------------------------------------------------------
// B22: reset(@cell) target-shape validation (PASS 14) — A1b Phase
// ---------------------------------------------------------------------------
//
// Per SPEC §6.8.2 (line 4844+) + §34. Step 9's parser (`expression-parser.ts`)
// permissively accepts ANY ExprNode as the `reset(<target>)` argument and
// defers shape validation to A1b. B22 runs the validation: the target MUST be
// one of the three §6.8.2 shapes:
//
//     reset(@cell)              // bare top-level cell
//     reset(@compound)          // whole compound parent (every field)
//     reset(@compound.field)    // single-level compound nav
//
// Per Phase 0 SURVEY decision (option 2 — accept multi-level), the walker
// also accepts `reset(@a.b.c.d)` when each segment resolves through the
// compound-scope chain. This is the spec-faithful default per §6.3.5
// recursive-composition semantics; rejecting multi-level would create an
// anti-symmetry with READ access (`@a.b.c.d` is legal anywhere else in the
// language). SPEC-PROSE FOLLOW-UP recorded for §6.8.2 amendment.
//
// Anything else (literals, function calls, binary expressions, ternaries,
// non-`@`-prefixed identifiers, member chains rooted at non-`@` identifiers)
// fires `E-RESET-INVALID-TARGET`.
//
// **Walker shape:** mirrors PASS 13 (B17) structural recursion. Visits every
// AST node, walks each ExprNode-bearing field via `forEachResetExprInExprNode`,
// and validates each `reset-expr` encountered.
//
// **Scope-aware walk:** like PASS 6 (B8), the walker descends with the active
// scope so multi-level lookups via `lookupQualifiedStateCell` see the correct
// compound-scope chain (B12-extended descent).
//
// **Diagnostic-skip rule:** if the `reset-expr` already carries a parse-time
// `diagnostic` (E-RESET-NO-ARG path), B22 SKIPS that node — the parser has
// already surfaced the malformed-shape error and we don't double-report.
//
// Reuses:
//   - `forEachResetExprInExprNode(node, cb)` from `expression-parser.ts` —
//     full ExprNode-tree walk that visits every reset-expr.
//   - `lookupQualifiedStateCell(scope, path[])` for compound-nav resolution
//     (B12 extension descends through any cell with `_scope`).

/**
 * Validate a single `reset-expr` node's target shape. Fires
 * `E-RESET-INVALID-TARGET` per §6.8.2 + §34 when the target is not one of:
 *   - bare `@cell` IdentExpr (top-level or compound parent)
 *   - `@compound.field` / `@a.b.c.d` MemberExpr chain rooted at a `@`-prefixed
 *     IdentExpr where every segment resolves through `lookupQualifiedStateCell`
 *
 * **Pass-through cases (no fire):**
 *   - `node.diagnostic` is set → parse-time E-RESET-NO-ARG already surfaced.
 *   - Target IdentExpr is `@`-prefixed but `_resolvedStateCell` is `null` →
 *     name-resolution issue, not shape issue. B22 stays silent (a future
 *     dispatch may tighten B3's null markers into E-SCOPE-001).
 *   - Target MemberExpr is `@`-rooted but `lookupQualifiedStateCell` returns
 *     `null` → same: name-resolution at the leaf level, not shape.
 */
function validateResetExprTarget(
  resetNode: ResetExpr,
  currentScope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  // Skip already-diagnosed nodes (parse-time E-RESET-NO-ARG).
  if (resetNode.diagnostic) return;

  const target = resetNode.target;
  if (!target || typeof target !== "object") return;

  // Shape 1: bare IdentExpr — must be `@`-prefixed.
  if (target.kind === "ident") {
    const ident = target as IdentExpr;
    if (typeof ident.name === "string" && ident.name.startsWith("@")) {
      // Shape OK. Resolution may still fail (B3 stamps null on unknown
      // names) but that's a B3 concern — B22 stays silent on resolution
      // issues, surfaces only shape issues.
      return;
    }
    fireResetInvalidTarget(resetNode, target, errors, filePath, "bare-non-at-ident");
    return;
  }

  // Shape 2: MemberExpr chain — must root at a `@`-prefixed IdentExpr,
  // every segment must be a static string property. Multi-level OK (per
  // Phase 0 decision; lookupQualifiedStateCell handles arity-N).
  if (target.kind === "member") {
    const path: string[] = [];
    let cursor: ExprNode = target;
    while (cursor.kind === "member") {
      const m = cursor as MemberExpr;
      // Optional-chain (`?.`) is not a canonical reset target. Reject
      // upfront — semantics of "reset something that might not exist"
      // are spec-undefined.
      if (m.optional) {
        fireResetInvalidTarget(resetNode, target, errors, filePath, "optional-chain");
        return;
      }
      if (typeof m.property !== "string") {
        // Defensive: ast.ts:1502 declares property as string, but if a
        // future grammar extension introduces computed-property MemberExpr
        // (would normally be IndexExpr), reject.
        fireResetInvalidTarget(resetNode, target, errors, filePath, "non-static-property");
        return;
      }
      path.unshift(m.property);
      cursor = m.object;
    }
    if (cursor.kind !== "ident") {
      fireResetInvalidTarget(resetNode, target, errors, filePath, "non-ident-root");
      return;
    }
    const rootIdent = cursor as IdentExpr;
    if (typeof rootIdent.name !== "string" || !rootIdent.name.startsWith("@")) {
      fireResetInvalidTarget(resetNode, target, errors, filePath, "non-at-root");
      return;
    }
    // Shape OK. Now check that the full path resolves through the compound-
    // scope chain. The root cell (segment 0) is the bare name without `@`.
    const rootName = rootIdent.name.slice(1);
    const fullPath = [rootName, ...path];
    const resolved = lookupQualifiedStateCell(currentScope, fullPath);
    if (resolved === null) {
      // Leaf-level resolution fail. Per Phase 0 decision (and the brief's
      // "may pass through silently"): this is a name-resolution concern, not
      // a target-shape concern. B22 stays silent. A future tightening
      // dispatch could fire E-SCOPE-* or similar; today's behavior matches
      // B3's null-stamp policy for unknown @-names.
      return;
    }
    return;
  }

  // Shape 3+: anything else — fire.
  fireResetInvalidTarget(resetNode, target, errors, filePath, target.kind);
}

/**
 * Fire `E-RESET-INVALID-TARGET` per §6.8.2 + §34. Triggered when the target
 * of a `reset(...)` keyword call is not one of the three canonical shapes.
 * Message identifies the offending shape and recommends canonical forms.
 */
function fireResetInvalidTarget(
  resetNode: ResetExpr,
  target: ExprNode,
  errors: SYMDiagnostic[],
  filePath: string,
  reason: string,
): void {
  const span: SYMDiagnostic["span"] = (resetNode.span && typeof resetNode.span === "object")
    ? (resetNode.span as unknown as SYMDiagnostic["span"])
    : { file: filePath, start: 0, end: 0, line: 1, col: 1 };
  // Best-effort source rendering of the offending target for the message.
  let rendered = "<expr>";
  try {
    const r = emitStringFromTree(target as any);
    if (typeof r === "string" && r.length > 0 && r.length < 80) {
      rendered = r;
    } else if (typeof r === "string" && r.length >= 80) {
      rendered = r.slice(0, 77) + "...";
    }
  } catch {
    // Defensive: emitStringFromTree may not handle every kind. Fall through
    // to the kind-only label.
  }
  // Map internal reason tags to short human-readable hints.
  const hint = (() => {
    switch (reason) {
      case "bare-non-at-ident": return "bare identifier without `@` prefix";
      case "optional-chain": return "optional-chain (`?.`) member access";
      case "non-static-property": return "non-static property access";
      case "non-ident-root": return "member chain not rooted at an identifier";
      case "non-at-root": return "member chain rooted at a non-`@` identifier";
      case "lit": return "literal";
      case "call": return "function-call result";
      case "new": return "constructor-call result";
      case "binary": return "binary expression";
      case "unary": return "unary expression";
      case "ternary": return "ternary expression";
      case "assign": return "assignment expression";
      case "array": return "array literal";
      case "object": return "object literal";
      case "lambda": return "lambda";
      case "cast": return "cast expression";
      case "index": return "computed-index access";
      case "match-expr": return "match expression";
      case "spread": return "spread";
      case "reset-expr": return "nested `reset(...)` call";
      case "escape-hatch": return "unparsed expression form";
      default: return `expression of kind \`${reason}\``;
    }
  })();
  errors.push({
    code: "E-RESET-INVALID-TARGET",
    message:
      `E-RESET-INVALID-TARGET: \`reset(${rendered})\` — target is a ${hint}, ` +
      `which is not a valid reset target. The \`reset\` keyword accepts only ` +
      `\`reset(@cell)\` (top-level cell), \`reset(@compound)\` (whole compound), ` +
      `or \`reset(@compound.field)\` (compound nav, including multi-level paths ` +
      `that resolve through the compound-scope chain). ` +
      `(SPEC §6.8.2 + §34.)`,
    span,
    severity: "error",
  });
}

/**
 * PASS 14 (B22) walker — visits every AST node, scans each ExprNode-bearing
 * field for `reset-expr` instances, and validates each one's target shape.
 *
 * Mirrors PASS 13 (B17) / PASS 6 (B8) structural recursion. Scope-aware so
 * `lookupQualifiedStateCell` for multi-level compound-nav sees the correct
 * compound-scope chain (PASS 1 attaches `_scope` to compound state-decls).
 */
function walkValidateResetTargets(
  nodes: ASTNode[] | undefined,
  currentScope: Scope,
  visited: WeakSet<object>,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    // Walk every ExprNode payload this node carries; for each, find any
    // reset-expr nodes nested inside and validate them.
    for (const f of B3_EXPR_FIELDS) {
      const v = anyN[f];
      if (v && typeof v === "object") {
        forEachResetExprInExprNode(v as ExprNode, (resetNode) => {
          validateResetExprTarget(resetNode, currentScope, errors, filePath);
        });
      }
    }
    // c-style for: { initExpr, condExpr, updateExpr }.
    if (anyN.cStyleParts && typeof anyN.cStyleParts === "object") {
      for (const f of ["initExpr", "condExpr", "updateExpr"]) {
        const v = anyN.cStyleParts[f];
        if (v && typeof v === "object") {
          forEachResetExprInExprNode(v as ExprNode, (resetNode) => {
            validateResetExprTarget(resetNode, currentScope, errors, filePath);
          });
        }
      }
    }

    // Scope-aware recursion (mirrors PASS 6).
    if (kind === "state-decl") {
      const stateScope = (anyN as ReactiveDeclNode & ScopeAnnotated)._scope;
      if (stateScope && Array.isArray(anyN.children)) {
        walkValidateResetTargets(anyN.children, stateScope, visited, errors, filePath);
      }
      continue;
    }
    if (kind === "function-decl") {
      const fnScope = (anyN as ScopeAnnotated)._scope ?? currentScope;
      walkValidateResetTargets(anyN.body, fnScope, visited, errors, filePath);
      continue;
    }

    // Generic recursion (mirrors PASS 3 / PASS 6 / PASS 13).
    if (Array.isArray(anyN.children)) walkValidateResetTargets(anyN.children, currentScope, visited, errors, filePath);
    if (Array.isArray(anyN.body)) walkValidateResetTargets(anyN.body, currentScope, visited, errors, filePath);
    if (Array.isArray(anyN.consequent)) walkValidateResetTargets(anyN.consequent, currentScope, visited, errors, filePath);
    if (Array.isArray(anyN.alternate)) walkValidateResetTargets(anyN.alternate, currentScope, visited, errors, filePath);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkValidateResetTargets(arm.body, currentScope, visited, errors, filePath);
      }
    }
    // Phase A10 (S78) — descend into engine-decl.bodyChildren so reset(@x)
    // calls inside an engine state-child body fire E-RESET-INVALID-TARGET
    // when @x is not a valid reset target. Body inherits surrounding scope.
    if (kind === "engine-decl" && Array.isArray(anyN.bodyChildren)) {
      walkValidateResetTargets(anyN.bodyChildren, currentScope, visited, errors, filePath);
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkValidateResetTargets([anyN.expr.node], currentScope, visited, errors, filePath);
    }
  }
}


// ---------------------------------------------------------------------------
// PASS 15 (B19) — Channels placement + `@shared` modifier rejection
// ---------------------------------------------------------------------------
//
// Per Phase A1b Step B19 (audit §2 + spec §38.1, §38.4, §34).
//
// **v0.3 DIRECTION REVERSAL (Wave 1, 2026-05-12) + S87 Insight 30
// dispensation (2026-05-12):** The original v0.next / pre-v0.3 contract
// said "channels are file-level siblings of `<program>`" and fired
// `E-CHANNEL-INSIDE-PROGRAM` on a channel descended from another markup
// element. Under the v0.3 program-shape direction (one-program-per-
// application; multi-page apps live as `<page>` siblings inside `<program>`),
// channels move BACK INSIDE `<program>` — channels are app-scope shared-state
// vehicles and the `<program>` body is their home. The walker fires the new
// code `E-CHANNEL-OUTSIDE-PROGRAM` when a `<channel>` sits outside `<program>`
// IN A FILE THAT ALSO CONTAINS `<program>` (the "your-file-has-a-`<program>`-
// but-this-`<channel>`-isn't-inside-it" canonical-violation shape).
// **Module-file dispensation (Insight 30, S87 ratified 47/44/44):** a
// `<channel>` at file top in a MODULE FILE (no `<program>` element anywhere
// in the file — the PURE-CHANNEL-FILE shape per §38.12.6) is canonical
// placement and DOES NOT fire `E-CHANNEL-OUTSIDE-PROGRAM`. Engine-parity
// rationale per §21.8 / B14 (cross-file `<engine>` import from module file).
// The `<channel>` inside `<page>` fire-site (`E-CHANNEL-INSIDE-PAGE`) is filed
// for the wave that adds `<page>` parser support — `<page>` is not
// tokenized as a structural element in Wave 1 so it cannot be checked here.
//
//   §38.1 (v0.3, post-Wave 1; S87 Insight 30 refinement) — channels live
//   INSIDE `<program>` when the file has a `<program>`; module-file
//   PURE-CHANNEL-FILE shape is admitted:
//     "A `<channel>` outside `<program>` IN A FILE THAT ALSO CONTAINS
//      `<program>` SHALL emit `E-CHANNEL-OUTSIDE-PROGRAM`. Dispensation:
//      a `<channel>` at file top in a file with no `<program>` element
//      anywhere (the PURE-CHANNEL-FILE shape per §38.12.6) is canonical
//      and SHALL NOT fire. Engine-parity per §21.8 / B14. A `<channel>`
//      inside `<page>` SHALL emit `E-CHANNEL-INSIDE-PAGE` (channels are
//      app-scope, not per-route)."
//
//   §38.4 line 15468 (V5-strict body — no `@shared`):
//     "The `@shared` modifier SHALL NOT appear in any v0.next source. Use
//      SHALL emit `E-CHANNEL-SHARED-MODIFIER`."
//
//   §38.9 line 15670 reaffirms `@shared` fires "inside (or outside) a
//   channel body" — the fire-site is ANY `state-decl` carrying `isShared:
//   true`, regardless of channel nesting context.
//
// **Why SYM (not parser):** TAB is intentionally permissive (parses any
// v1 shape into the canonical AST shape, leaving validation to SYM/NR).
// SYM is the canonical "validation after AST is fully formed" stage and
// already houses adjacent walkers (B14-B17). Adds cleanly as PASS 14.
//
// **Walker shape:** two independent sub-walks in `walkValidateChannels`,
// preceded by a `hasProgramElement` pre-scan (S87 Insight 30):
//
//   0. `hasProgramElement(ast.nodes)` pre-scan — quick AST walk that
//      returns `true` iff any `kind: "markup", tag: "program"` node is
//      present in the file. Result threaded into walkChannelPlacement
//      as `fileHasProgram`.
//
//   1. `walkChannelPlacement` — walk markup tree carrying a
//      `programDepth` counter (count of `<program>` ancestors) AND the
//      `fileHasProgram` boolean. A `<channel>` at programDepth === 0
//      fires `E-CHANNEL-OUTSIDE-PROGRAM` IFF `fileHasProgram === true`
//      (genuine canonical-violation shape). When `fileHasProgram ===
//      false` (module-file / PURE-CHANNEL-FILE shape), file-top
//      `<channel>` is canonical and the walker is silent. A `<channel>`
//      at programDepth >= 1 is always allowed. (v0.3 reversal + S87
//      Insight 30 — see Wave 1 dispatch + §38.1 v0.3.) The walker
//      descends into `node.children` (markup children) and `node.body`
//      (logic blocks; channels never appear inside logic, but recursion
//      is cheap).
//
//   2. `walkSharedModifier` — generic AST walker visiting every
//      `state-decl` (including compound `children` arrays). Fires
//      E-CHANNEL-SHARED-MODIFIER on any `state-decl` with `isShared:
//      true`. The check is unconditional per §38.4 line 15468 — `@shared`
//      anywhere in source fires the diagnostic.
//
// **Out of scope (per audit §2.1 + brief §"OUT OF SCOPE for B19"):**
//   - V5-strict access validation inside channel body (B3 owns `@cellName`
//     resolution).
//   - Cross-scope channel-cell visibility (B1 PASS 1 + B3 PASS 3 already
//     cover this — channel-body logic-blocks register state-decls in the
//     enclosing file scope).
//   - Channel attribute shape errors (E-CHANNEL-001/E-CHANNEL-005/
//     E-CHANNEL-007 — codegen-time today).
//   - A1c codegen for channels — runtime concern.

/**
 * PASS 15 (B19) — channel-placement + `@shared`-modifier rejection.
 * Mutates `errors[]`. Two sub-walks + one pre-scan.
 *
 * **v0.3 direction reversal (Wave 1) + S87 Insight 30 dispensation:**
 * Placement-check direction inverted from v0.next. Channels live INSIDE
 * `<program>` IN ANY FILE THAT CONTAINS `<program>`. A `<channel>` at
 * file top in such a file (programDepth === 0) fires
 * `E-CHANNEL-OUTSIDE-PROGRAM`. **Dispensation:** a `<channel>` at file
 * top in a MODULE FILE (no `<program>` element anywhere — PURE-CHANNEL-FILE
 * per §38.12.6) is canonical and DOES NOT fire. Engine-parity per §21.8 /
 * B14. The pre-scan `hasProgramElement(ast.nodes)` computes this signal
 * once and threads it through the walker. `<channel>` inside `<page>` will
 * fire `E-CHANNEL-INSIDE-PAGE` once `<page>` parser support lands in a
 * later wave; the error code is registered in §34 now but no walker fires
 * it yet (Wave 1 has no `<page>` parsing).
 */
function walkValidateChannels(
  ast: any,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  // 1. Placement check. Channels inside `<program>` are allowed
  //    (programDepth >= 1); channels at file top level fire
  //    E-CHANNEL-OUTSIDE-PROGRAM — BUT only when the file contains a
  //    `<program>` element somewhere (Insight 30 S87 dispensation:
  //    module-file PURE-CHANNEL-FILE shape is canonical and silent;
  //    see §38.1 + §38.12.6, engine-parity per §21.8 / B14).
  const fileHasProgram = hasProgramElement(ast.nodes);
  const visitedPlacement = new WeakSet<object>();
  walkChannelPlacement(
    ast.nodes,
    /*programDepth*/ 0,
    fileHasProgram,
    errors,
    filePath,
    visitedPlacement,
  );

  // 2. `@shared` modifier rejection. Fires on any state-decl with
  //    isShared:true, regardless of containing channel context.
  const visitedShared = new WeakSet<object>();
  walkSharedModifier(ast.nodes, errors, filePath, visitedShared);
}

/**
 * Pre-scan helper: does the file contain any `<program>` markup element?
 *
 * Per Insight 30 (S87, ratified 47/44/44) closing §38.1 OQ:
 *   - File contains `<program>` => `<channel>` outside `<program>` is the
 *     canonical-violation shape (fires E-CHANNEL-OUTSIDE-PROGRAM).
 *   - File contains NO `<program>` (module file / PURE-CHANNEL-FILE shape
 *     per §38.12.6) => file-top `<channel>` is canonical and SILENT.
 *
 * Engine-parity rationale: §21.8 / B14 already admits cross-file `<engine>`
 * declarations at file top in module files (Form 1 `export <engine>`).
 * Channels reuse that precedent rather than introducing a structural
 * asymmetry between two singleton-state-primitives that share the same
 * scope discipline (app-wide singleton, single declaration site, cross-file
 * mount-via-tag).
 *
 * Implementation: identical traversal shape to walkChannelPlacement —
 * descends into `children`, `body`, `defChildren`, `consequent`, `alternate`,
 * `arms[].body`. Returns `true` as soon as the first `kind: "markup",
 * tag: "program"` node is reached. WeakSet cycle guard mirrors the existing
 * walker convention.
 */
function hasProgramElement(nodes: any): boolean {
  const visited = new WeakSet<object>();
  return _hasProgramElementInner(nodes, visited);
}

function _hasProgramElementInner(nodes: any, visited: WeakSet<object>): boolean {
  if (!nodes) return false;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      if (_hasProgramElementInner(n, visited)) return true;
    }
    return false;
  }
  if (typeof nodes !== "object") return false;
  if (visited.has(nodes)) return false;
  visited.add(nodes);

  const node = nodes as any;

  if (node.kind === "markup" && (node.tag ?? "") === "program") {
    return true;
  }

  if (Array.isArray(node.children) && _hasProgramElementInner(node.children, visited)) return true;
  if (Array.isArray(node.body) && _hasProgramElementInner(node.body, visited)) return true;
  if (Array.isArray(node.defChildren) && _hasProgramElementInner(node.defChildren, visited)) return true;
  if (Array.isArray(node.consequent) && _hasProgramElementInner(node.consequent, visited)) return true;
  if (Array.isArray(node.alternate) && _hasProgramElementInner(node.alternate, visited)) return true;
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body) && _hasProgramElementInner(arm.body, visited)) return true;
    }
  }
  return false;
}

/**
 * Walk markup tree to detect `<channel>` placement violations.
 *
 * **v0.3 direction reversal (Wave 1).** `programDepth` is the count of
 * `<program>` ancestors traversed to reach the current node. A
 * `<channel>` node at `programDepth === 0` fires
 * `E-CHANNEL-OUTSIDE-PROGRAM` — channels must live inside `<program>` in
 * v0.3. A `<channel>` at `programDepth >= 1` is the canonical placement
 * (inside the entry-file `<program>` body).
 *
 * **S87 Insight 30 — module-file dispensation (PURE-CHANNEL-FILE).**
 * When `fileHasProgram === false` (the file contains no `<program>`
 * element anywhere — i.e. a module file / PURE-CHANNEL-FILE shape per
 * §38.12.6), file-top `<channel>` declarations are CANONICAL and the
 * walker does NOT fire `E-CHANNEL-OUTSIDE-PROGRAM`. The diagnostic
 * fires only on the genuine canonical-violation shape: a `<channel>`
 * outside `<program>` in a file that ALSO contains `<program>` (the
 * "your-file-has-a-`<program>`-but-this-`<channel>`-isn't-inside-it"
 * shape). Engine-parity rationale per §21.8 / B14 — `<engine>` already
 * accepts module-file top-level placement; channels reuse that precedent.
 *
 * **`<page>` inside-fire deferred.** A `<channel>` inside `<page>` would
 * fire `E-CHANNEL-INSIDE-PAGE`. The error code is registered in §34 now
 * (Wave 1) but `<page>` is not yet tokenized as a structural element —
 * the walker for that fire-site is filed for the wave that adds `<page>`
 * parser support.
 *
 * `component-def` nodes are component declarations whose `defChildren`
 * array holds sibling logic-body nodes (per B17 finding). Channel
 * placement inside a component-def's defChildren is non-canonical — a
 * `<channel>` declaration inside a component definition has no `<program>`
 * ancestor in the conventional sense; the v0.3 contract for that is
 * out of scope for Wave 1 (channel-in-component-def is an unusual shape
 * that pre-existed the v0.3 reversal). For Wave 1, component-def acts
 * neutral: it does not increment `programDepth` (so a channel inside
 * component-def's defChildren, outside `<program>` IN A FILE THAT HAS
 * a `<program>` somewhere, still fires `E-CHANNEL-OUTSIDE-PROGRAM`).
 *
 * Logic-block bodies (`node.kind === "logic"`) and other non-markup
 * containers never legally hold `<channel>` markup nodes (the parser
 * places channels in markup `children`); but we recurse defensively.
 */
function walkChannelPlacement(
  nodes: any,
  programDepth: number,
  fileHasProgram: boolean,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkChannelPlacement(n, programDepth, fileHasProgram, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;

  // Fire E-CHANNEL-OUTSIDE-PROGRAM if a `<channel>` markup is reached at
  // programDepth === 0 (i.e. no `<program>` ancestor) AND the file has a
  // `<program>` element somewhere else (canonical-violation shape).
  // Insight 30 (S87) dispensation: when the file has NO `<program>`
  // anywhere, file-top `<channel>` is canonical (PURE-CHANNEL-FILE per
  // §38.12.6) — silent. Engine-parity per §21.8 / B14.
  if (
    node.kind === "markup" &&
    (node.tag ?? "") === "channel" &&
    programDepth === 0 &&
    fileHasProgram
  ) {
    fireChannelOutsideProgram(node, errors, filePath);
  }

  // Compute child-side depth: increment ONLY when descending through a
  // `<program>` markup node. Non-program markup, component-def, etc. do
  // not change `programDepth` — only the `<program>` ancestor signal
  // matters for v0.3 placement.
  const isProgramMarkup =
    node.kind === "markup" && (node.tag ?? "") === "program";
  const childDepth = isProgramMarkup ? programDepth + 1 : programDepth;

  if (Array.isArray(node.children)) {
    walkChannelPlacement(node.children, childDepth, fileHasProgram, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkChannelPlacement(node.body, childDepth, fileHasProgram, errors, filePath, visited);
  }
  if (Array.isArray(node.defChildren)) {
    walkChannelPlacement(node.defChildren, childDepth, fileHasProgram, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkChannelPlacement(node.consequent, childDepth, fileHasProgram, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkChannelPlacement(node.alternate, childDepth, fileHasProgram, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkChannelPlacement(arm.body, childDepth, fileHasProgram, errors, filePath, visited);
      }
    }
  }
}

/**
 * Walk every AST node visiting state-decls; fire E-CHANNEL-SHARED-MODIFIER
 * on any `state-decl` with `isShared: true`. Per §38.4 line 15468 the
 * modifier is rejected ANYWHERE in v0.next source — fire is unconditional.
 *
 * Recursion mirrors B17's structural shape — descends into children/body/
 * consequent/alternate/arms AND into `state-decl.children` (compound parents).
 */
function walkSharedModifier(
  nodes: any,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkSharedModifier(n, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;

  if (node.kind === "state-decl" && node.isShared === true) {
    fireChannelSharedModifier(node, errors, filePath);
  }

  // Compound parent: state-decl carries `children: ReactiveDeclNode[]`.
  if (Array.isArray(node.children) && node.kind === "state-decl") {
    walkSharedModifier(node.children, errors, filePath, visited);
  }
  // Generic markup/logic/etc. recursion — children + body + arms.
  if (Array.isArray(node.children) && node.kind !== "state-decl") {
    walkSharedModifier(node.children, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkSharedModifier(node.body, errors, filePath, visited);
  }
  if (Array.isArray(node.defChildren)) {
    walkSharedModifier(node.defChildren, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkSharedModifier(node.consequent, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkSharedModifier(node.alternate, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkSharedModifier(arm.body, errors, filePath, visited);
      }
    }
  }
}

/**
 * Fire `E-CHANNEL-OUTSIDE-PROGRAM` per §38.1 + §34 (v0.3 direction).
 *
 * Triggered when a `<channel>` markup element is reached at programDepth
 * === 0 — i.e. the channel has no `<program>` ancestor in the markup tree.
 * Under v0.3 the canonical placement is INSIDE `<program>` (channels are
 * app-scope shared-state vehicles, not file-top-level decorations).
 *
 * The diagnostic message names the channel (when its `name=` attribute
 * resolves to a static string literal) and points to the canonical v0.3
 * shape: child of `<program>`. The diagnostic also notes the direction
 * REVERSAL from pre-v0.3 (which fired `E-CHANNEL-INSIDE-PROGRAM` for the
 * opposite arrangement).
 */
function fireChannelOutsideProgram(
  channelNode: any,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const span: SYMDiagnostic["span"] = channelNode.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };

  // Best-effort: extract the channel name from the `name=` attribute when it
  // is a simple static string literal. Avoids over-engineering for the
  // common case; falls back to a generic placeholder otherwise.
  const attrs: any[] = channelNode.attrs ?? channelNode.attributes ?? [];
  const nameAttr = attrs.find?.((a: any) => a && a.name === "name");
  let channelLabel = "`<channel>`";
  if (nameAttr) {
    const v = nameAttr.value;
    if (typeof v === "string") {
      channelLabel = `\`<channel name="${v}">\``;
    } else if (v && typeof v === "object" && v.kind === "string-literal" && typeof v.value === "string") {
      channelLabel = `\`<channel name="${v.value}">\``;
    }
  }

  errors.push({
    code: "E-CHANNEL-OUTSIDE-PROGRAM",
    message:
      `E-CHANNEL-OUTSIDE-PROGRAM: ${channelLabel} appears at file top level ` +
      `(no \`<program>\` ancestor). Under v0.3, channels live INSIDE ` +
      `\`<program>\` — they are app-scope shared-state vehicles and the ` +
      `entry-file \`<program>\` body is their home. Move the ` +
      `\`<channel>\` declaration to be a child of \`<program>\`. ` +
      `(Direction REVERSED from pre-v0.3 \`E-CHANNEL-INSIDE-PROGRAM\`.) ` +
      `(SPEC §38.1 + §34.)`,
    span,
    severity: "error",
  });
}

/**
 * Fire `E-CHANNEL-SHARED-MODIFIER` per §38.4 + §34. Triggered when a
 * state-decl carries `isShared: true` (i.e. source contained `@shared`
 * before the variable name).
 *
 * Per §38.4 line 15468, the modifier is rejected anywhere in source —
 * the fire-site is unconditional on placement (channel body or otherwise).
 * In v0.next, sync comes from declaring inside a channel body, not from
 * a `@shared` marker. The diagnostic message recommends the canonical
 * V5-strict structural form `<name> = init`.
 */
function fireChannelSharedModifier(
  stateDecl: any,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  const span: SYMDiagnostic["span"] = stateDecl.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  const name = typeof stateDecl.name === "string" && stateDecl.name.length > 0
    ? stateDecl.name
    : "<name>";
  errors.push({
    code: "E-CHANNEL-SHARED-MODIFIER",
    message:
      `E-CHANNEL-SHARED-MODIFIER: \`@shared ${name} = …\` uses the \`@shared\` modifier, ` +
      `which is removed in v0.next (M19). Reactive cells declared inside a channel body ` +
      `auto-sync by virtue of being declared in the channel body — no marker is required. ` +
      `Remove the \`@shared\` keyword and use the V5-strict structural form ` +
      `\`<${name}> = init\` (inside a \`<channel>\` body) or a plain \`<${name}> = init\` / ` +
      `\`@${name} = init\` (outside a channel). ` +
      `(SPEC §38.4 + §34.)`,
    span,
    severity: "error",
  });
}



// ---------------------------------------------------------------------------
// PASS 16 (A5-3) — A7 hierarchy + temporal extensions (§51.0.M-Q)
// ---------------------------------------------------------------------------
//
// Per Phase A7 Step A5-3 (BRIEF + Phase 0 SURVEY at
// `docs/changes/phase-a7-step-a5-3-typer-walker/{BRIEF,SURVEY}.md`).
//
// **In-scope fire-sites (9 of 12 BRIEF §4.1 rows):**
//
//   1. E-HISTORY-NO-INNER-ENGINE (NEW S68 row 14250) — fired when a
//      state-child carries `historyAttr: true` AND `innerEngines.length === 0`
//      (history is composite-only per §51.0.N).
//
//   2. E-INTERNAL-RULE-NOT-COMPOSITE (NEW S68 row 14251) — fired when
//      `internalRule.kind !== "absent"` AND `innerEngines.length === 0`
//      (`internal:rule=` is composite-only per §51.0.O).
//
//   3. E-ENGINE-INVALID-TRANSITION (existing row 14234) — fired when
//      `<onTimeout to=.X/>` does not satisfy the surrounding state-child's
//      `rule=` legality contract (§51.0.M + §51.0.F target-only forms).
//      THIS IS THE FIRST COMPILE-TIME E-ENGINE-INVALID-TRANSITION FIRE-SITE
//      (per SURVEY §1.3 KEY FINDING #1; spec §51.0.M line 20567 explicitly
//      authorizes static check because the from-state IS this state-child).
//
//   4. E-ENGINE-RULE-INVALID-VARIANT (existing row 14248) — fired when
//      `<onTimeout to=.X/>` references a variant `X` not in the engine's
//      `for=Type` (§51.0.M variant-membership requirement). Independent
//      of fire-site #3 — both can fire on the same `<onTimeout/>`.
//
//   5. E-ENGINE-RULE-INVALID-VARIANT — same code, applied to each target
//      in `entry.internalRule` (§51.0.O — internal:rule= variants must
//      be valid). Mirrors B15's canonical-rule variant validation.
//
// **Transparent fire-sites (no new code; B15 already fires):**
//
//   - `.Variant.history` target variant validation (§51.0.N) — A5-2's
//     `historyForm`/`historyForms` flag rides EngineRuleForm.single/multi
//     transparently; B15 reads `target`/`targets` blind to the flag and
//     fires E-ENGINE-RULE-INVALID-VARIANT on unknown variants. A5-3
//     anchors this contract via tests; no new validation code.
//
// **EngineMetadata file-scope aggregation (§4.2 + SURVEY §4):**
//
//   - `historyAttr: boolean` — OR-reduce over `stateChildren[].historyAttr`.
//   - `internalRules: Array<{ stateChildTag, rule }>` — concat where
//     `internalRule.kind !== "absent"`, annotated for codegen consumers.
//   - `onTimeoutElements: Array<{ stateChildTag, entry }>` — concat across
//     state-children, annotated for codegen consumers.
//
// **Out of scope (DEFERRED on infrastructure preconditions, per SURVEY
// §10 SCOPE CORRECTIONS):**
//
//   - Fire-site #5 (E-STRUCTURAL-ELEMENT-MISPLACED for `<onTimeout>`
//     outside engine state-child) — gated on a markup walker that
//     tokenizes `<onTimeout>` as a structural element everywhere. Same
//     precondition that defers `<onTransition>` placement enforcement
//     (B17 deferral).
//   - Fire-site #6 (E-STRUCTURAL-ELEMENT-MISPLACED inside `<match>`
//     block-form arm) — same precondition.
//   - Fire-site #7 (cascade-miss message extension on E-ENGINE-INVALID-
//     TRANSITION) — gated on direct-write compile-time enforcement
//     inside engine state-child bodies; that fire-site does not exist
//     today (engine bodies are RAW TEXT — no walkable children, per
//     `symbol-table.ts:4150,4544` deferrals).
//   - Inner-engine structural recursion — DEFERRED to A1c codegen (per
//     SURVEY §3.3). A5-3's primary fire-sites read OUTER engine's
//     state-children only; `innerEngines.length > 0` is the composite
//     marker. A5-3 does NOT recurse into inner engines.
//
// **Walker placement: NEW PASS 16** (per BRIEF §3.8 + SURVEY §2). PASS 11
// (B15) retains responsibility for canonical rule= variant validation
// (which already covers fire-site #9 transparently); A5-3 PASS 16 owns
// only the NEW responsibilities listed above.

/**
 * Fire an A5-3 SYM diagnostic with a fallback span (engine-decl's span)
 * when the offending sub-element doesn't have its own span. Today's
 * parser doesn't produce per-state-child or per-onTimeout spans (rulesRaw
 * is text); A5-3 uses the engine-decl's span as a coarse anchor — same
 * pattern as B15's `fireB15Diagnostic`. Future parser tightening will
 * produce per-state-child spans automatically.
 */
function fireA5Diagnostic(
  errors: SYMDiagnostic[],
  code: string,
  message: string,
  engineDecl: any,
  filePath: string,
  severity: "error" | "warning" | "info" = "error",
): void {
  const span: SYMDiagnostic["span"] = engineDecl?.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  errors.push({ code, message, span, severity });
}

/**
 * Format a list of variants for diagnostic messages: `[".A", ".B", ".C"]`.
 */
function formatVariantList(variants: string[]): string {
  return variants.map((v) => `.${v}`).join(", ");
}

/**
 * A5-3 §A5-3.8 — direct-write match parsed out of a state-child's `bodyRaw`.
 *
 * Engine state-child bodies are RAW TEXT today (parser limitation per
 * primer §13.7 B14 specifics). The cascade-miss diagnostic (§51.0.Q.3)
 * therefore regex-scans `bodyRaw` for the two canonical direct-write
 * forms the spec governs:
 *
 *   - `@varName = .Variant`                — direct assignment (§51.0.F line 20847)
 *   - `@varName.advance(.Variant)`         — assertion-style transition (§51.0.G)
 *
 * Only the BARE-DOT `.Variant` form is matched. The qualified-name form
 * `Type.Variant` (also legal at runtime) is NOT matched — qualified writes
 * require identifier resolution that this raw-text scan cannot perform
 * safely. Adopters needing precision on qualified writes can use `rule=*`
 * as the documented escape hatch (§51.0.F).
 *
 * Returns one DirectWriteMatch per direct-write found in the body.
 */
interface DirectWriteMatch {
  /** `"assign"` for `@x = .V`; `"advance"` for `@x.advance(.V)`. */
  shape: "assign" | "advance";
  /** Target variant name (no leading dot). */
  target: string;
  /** Byte offset of the match start within `bodyRaw` (preserved for future
   *  span tightening; today's diagnostics use engine-decl span as a coarse
   *  anchor, mirroring fire-site #3). */
  rawOffset: number;
}

/**
 * Scan a state-child body for direct-write expressions targeting `varName`.
 *
 * Approach **A — regex over raw text** (per A5-3 §A5-3.8 follow-on dispatch
 * design). Two patterns:
 *
 *   - assign  : `@<name>\s*=\s*\.<Variant>`     captures `Variant`
 *   - advance : `@<name>\s*\.\s*advance\s*\(\s*\.<Variant>\s*\)`
 *
 * `<name>` is exact-match on `varName` (identifier-bounded — `@phaseX` does
 * NOT match when scanning for `@phase`); `<Variant>` is a PascalCase
 * identifier captured by the regex. The two patterns are scanned
 * independently and the union returned (one DirectWriteMatch per match).
 *
 * NOTE on truncation: today's body-parser truncates `bodyRaw` at the first
 * markup-tag boundary inside the state-child (see /tmp probe). This means
 * at most one direct-write per state-child body is reachable in current
 * pipeline. The cascade-miss fire-site catches what is reachable; broader
 * coverage waits on the body-parser widening tracked in engine-a7-
 * hierarchy.test.js §7 (deferred bug surface).
 */
function scanDirectWritesInStateChildBody(
  bodyRaw: string,
  varName: string,
): DirectWriteMatch[] {
  const out: DirectWriteMatch[] = [];
  if (!bodyRaw || !varName) return out;
  // Validate varName as an identifier before injecting into RegExp to
  // avoid metacharacter-injection. `meta.varName` is parser-derived from
  // a PascalCase type name (lowercase-first), so this is defense-in-depth.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) return out;

  // `@varName = .Variant`  (with optional whitespace around `=`).
  // `(?!\w)` after `varName` enforces identifier boundary so `@phaseX`
  // does NOT match the scanner for `@phase`.
  const assignRe = new RegExp(
    `@${varName}(?!\\w)\\s*=\\s*\\.([A-Za-z_][A-Za-z0-9_]*)`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = assignRe.exec(bodyRaw)) !== null) {
    out.push({ shape: "assign", target: m[1], rawOffset: m.index });
  }

  // `@varName.advance(.Variant)`.
  const advanceRe = new RegExp(
    `@${varName}(?!\\w)\\s*\\.\\s*advance\\s*\\(\\s*\\.([A-Za-z_][A-Za-z0-9_]*)\\s*\\)`,
    "g",
  );
  while ((m = advanceRe.exec(bodyRaw)) !== null) {
    out.push({ shape: "advance", target: m[1], rawOffset: m.index });
  }

  return out;
}

/**
 * PASS 16 (A5-3) — per-engine A7 hierarchy + temporal extension validation
 * + EngineMetadata file-scope aggregation. For each `engine-decl` carrying
 * a `_record` (set by PASS 10.A) AND `engineMeta.stateChildren` (populated
 * by PASS 11 / B15), iterate state-children and:
 *
 *   1. Fire E-HISTORY-NO-INNER-ENGINE on history-on-non-composite.
 *   2. Fire E-INTERNAL-RULE-NOT-COMPOSITE on internal:rule on non-composite.
 *   3. Validate each `<onTimeout>` `to=` against the surrounding state-child's
 *      `rule=` legality (§51.0.M + §51.0.F).
 *   4. Validate each `<onTimeout>` `to=` against `engineMeta.variants`.
 *   5. Validate each target in `entry.internalRule` against `engineMeta.variants`.
 *   6. Aggregate file-scope `historyAttr` / `internalRules` / `onTimeoutElements`
 *      onto `engineMeta` (annotated records per SURVEY §4).
 *
 * Exported for direct test use (mirrors B15's `validateEngineStateChildrenAndRules`
 * export pattern). Synthesized AST tests bypass full-pipeline run.
 */
export function validateEngineA5Extensions(
  engineDecl: any,
  fileAst: any,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  // engineDecl._record is set by PASS 10.A; if absent, skip silently —
  // the upstream pass would have surfaced the underlying problem.
  void fileAst; // reserved for future cross-decl checks; intentional unused.
  const record: StateCellRecord | undefined = engineDecl._record;
  if (!record || !record.engineMeta) return;
  const meta = record.engineMeta;

  // PASS 11 (B15) populates `stateChildren`. If empty (legacy arrow-rule
  // body, parse failure path, or zero state-children), there's nothing
  // for A5-3 to validate or aggregate. Initialize aggregation to defaults
  // and return.
  const stateChildren = meta.stateChildren;
  if (!Array.isArray(stateChildren) || stateChildren.length === 0) {
    meta.historyAttr = false;
    meta.internalRules = [];
    meta.onTimeoutElements = [];
    return;
  }

  const variants = Array.isArray(meta.variants) ? meta.variants : [];
  const variantSet = new Set(variants);
  const forType = typeof meta.forType === "string" ? meta.forType : "";

  // File-scope aggregation accumulators (annotated records per SURVEY §4).
  let aggHistoryAttr = false;
  const aggInternalRules: Array<{ stateChildTag: string; rule: EngineRuleForm }> = [];
  const aggOnTimeoutElements: Array<{ stateChildTag: string; entry: OnTimeoutEntry }> = [];

  // Per-state-child loop — fire-sites #1, #2, #3, #4, #8 + aggregation.
  for (const sc of stateChildren) {
    if (!sc || typeof sc !== "object") continue;

    const isComposite = Array.isArray(sc.innerEngines) && sc.innerEngines.length > 0;

    // ----- Aggregation (always, regardless of compositeness) -----
    if (sc.historyAttr === true) aggHistoryAttr = true;
    if (sc.internalRule && sc.internalRule.kind !== "absent") {
      aggInternalRules.push({ stateChildTag: sc.tag, rule: sc.internalRule });
    }
    if (Array.isArray(sc.onTimeoutElements)) {
      for (const ent of sc.onTimeoutElements) {
        if (ent && typeof ent === "object") {
          aggOnTimeoutElements.push({ stateChildTag: sc.tag, entry: ent });
        }
      }
    }

    // ----- Fire-site #1: E-HISTORY-NO-INNER-ENGINE (§51.0.N) -----
    if (sc.historyAttr === true && !isComposite) {
      fireA5Diagnostic(
        errors,
        "E-HISTORY-NO-INNER-ENGINE",
        `E-HISTORY-NO-INNER-ENGINE: state-child \`<${sc.tag}>\` carries the \`history\` ` +
        `attribute but has no inner \`<engine>\`. Per SPEC §51.0.N, \`history\` is ` +
        `composite-only — it records and restores the inner machine's variant on entry. ` +
        `Either add an inner \`<engine>\` to \`<${sc.tag}>\` (making it composite), or ` +
        `remove the \`history\` attribute.`,
        engineDecl,
        filePath,
        "error",
      );
    }

    // ----- Fire-site #2: E-INTERNAL-RULE-NOT-COMPOSITE (§51.0.O) -----
    if (sc.internalRule && sc.internalRule.kind !== "absent" && !isComposite) {
      fireA5Diagnostic(
        errors,
        "E-INTERNAL-RULE-NOT-COMPOSITE",
        `E-INTERNAL-RULE-NOT-COMPOSITE: state-child \`<${sc.tag}>\` carries an ` +
        `\`internal:rule=\` attribute but has no inner \`<engine>\`. Per SPEC §51.0.O, ` +
        `\`internal:rule=\` is composite-only — it governs which inner-engine variants ` +
        `are reachable from inside this composite. Either add an inner \`<engine>\` to ` +
        `\`<${sc.tag}>\` (making it composite), or remove the \`internal:rule=\` attribute.`,
        engineDecl,
        filePath,
        "error",
      );
    }

    // ----- Fire-site #8: internal:rule= variant validation (§51.0.O) -----
    // Apply the same variant-set check B15 applies to canonical rule=.
    // Skipped when variants is empty (unknown type — B15 already skips).
    if (variants.length > 0 && sc.internalRule) {
      const ir = sc.internalRule;
      switch (ir.kind) {
        case "absent":
        case "wildcard":
          break;
        case "single":
          if (!variantSet.has(ir.target)) {
            fireA5Diagnostic(
              errors,
              "E-ENGINE-RULE-INVALID-VARIANT",
              `E-ENGINE-RULE-INVALID-VARIANT: \`<${sc.tag} internal:rule=.${ir.target}>\` ` +
              `references variant \`.${ir.target}\` which is not in \`${forType}\`. ` +
              `Valid variants are: ${formatVariantList(variants)}.`,
              engineDecl,
              filePath,
              "error",
            );
          }
          break;
        case "multi":
          for (const t of ir.targets) {
            if (!variantSet.has(t)) {
              fireA5Diagnostic(
                errors,
                "E-ENGINE-RULE-INVALID-VARIANT",
                `E-ENGINE-RULE-INVALID-VARIANT: \`<${sc.tag}>\` internal:rule= multi-target ` +
                `list contains \`.${t}\` which is not in \`${forType}\`. ` +
                `Valid variants are: ${formatVariantList(variants)}.`,
                engineDecl,
                filePath,
                "error",
              );
            }
          }
          break;
        case "legacy-arrow":
        case "parse-error":
          // B15 already fires on the canonical rule= legacy/parse-error
          // shapes; A5-3 does NOT double-fire for internal:rule= shapes
          // here either — internal:rule= parser at engine-statechild-parser
          // already constrains to the §51.0.F three forms (legacy-arrow /
          // parse-error are unreachable on internal:rule= for this dispatch;
          // future parser extensions could surface them, at which point
          // this case becomes a defensive no-op).
          break;
      }
    }

    // ----- Fire-sites #3 + #4 + #5: <onTimeout to=> legality + variant
    //       validation (§51.0.M) + name= shape/duplicate (§51.0.M S79) -----
    if (Array.isArray(sc.onTimeoutElements) && sc.onTimeoutElements.length > 0) {
      // A5-6 Feature 1 (S79) — track name= seen-set per state-child for
      // duplicate detection. Fires E-TIMER-NAME-DUPLICATE on the SECOND
      // (and any subsequent) appearance of a given name. Names are scope-
      // local to the state-child per SPEC §51.0.M (S79 amendment).
      const seenNames = new Set<string>();
      for (const ot of sc.onTimeoutElements) {
        if (!ot || typeof ot !== "object") continue;

        // Fire-site #5a: E-TIMER-NAME-INVALID (§51.0.M S79). Identifier
        // shape: PascalCase or camelCase, no leading digit, ASCII letters
        // + digits + underscore. Rejects whitespace, punctuation, empty
        // post-strip strings.
        if (typeof ot.name === "string") {
          const nm = ot.name;
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nm)) {
            fireA5Diagnostic(
              errors,
              "E-TIMER-NAME-INVALID",
              `E-TIMER-NAME-INVALID: \`<onTimeout name=${JSON.stringify(nm)} ...>\` ` +
              `inside state-child \`<${sc.tag}>\` carries an invalid timer name. Per ` +
              `SPEC §51.0.M, \`name=\` MUST be a valid identifier (PascalCase or ` +
              `camelCase; ASCII letters, digits, and underscores; first character ` +
              `must NOT be a digit). Drop the \`name=\` attribute (the timer becomes ` +
              `index-keyed and uncancellable) or rename to a valid identifier.`,
              engineDecl,
              filePath,
              "error",
            );
          } else {
            // Fire-site #5b: E-TIMER-NAME-DUPLICATE (§51.0.M S79).
            if (seenNames.has(nm)) {
              fireA5Diagnostic(
                errors,
                "E-TIMER-NAME-DUPLICATE",
                `E-TIMER-NAME-DUPLICATE: state-child \`<${sc.tag}>\` declares two ` +
                `\`<onTimeout>\` elements with the same \`name=${JSON.stringify(nm)}\`. ` +
                `Per SPEC §51.0.M, \`name=\` values are scope-local to the state-child ` +
                `body and MUST be unique within that body — \`cancelTimer(${JSON.stringify(nm)})\` ` +
                `would otherwise be ambiguous. Rename one of the \`name=\` attributes.`,
                engineDecl,
                filePath,
                "error",
              );
            } else {
              seenNames.add(nm);
            }
          }
        }

        const toTarget: string = typeof ot.to === "string" ? ot.to : "";
        if (toTarget.length === 0) {
          // Empty `to=` is a parse-error shape captured by A5-2; surface
          // as E-ENGINE-INVALID-TRANSITION since the structural contract
          // is violated (target absent or unparseable).
          fireA5Diagnostic(
            errors,
            "E-ENGINE-INVALID-TRANSITION",
            `E-ENGINE-INVALID-TRANSITION: \`<onTimeout/>\` inside state-child \`<${sc.tag}>\` ` +
            `is missing a \`to=.Variant\` target. Per SPEC §51.0.M, \`<onTimeout>\` requires ` +
            `both \`after=\` and \`to=\` attributes.`,
            engineDecl,
            filePath,
            "error",
          );
          continue;
        }

        // Fire-site #4: variant membership in engine's `for=Type`.
        // Skipped when variants is empty (unknown type — same gate as B15).
        if (variants.length > 0 && !variantSet.has(toTarget)) {
          fireA5Diagnostic(
            errors,
            "E-ENGINE-RULE-INVALID-VARIANT",
            `E-ENGINE-RULE-INVALID-VARIANT: \`<onTimeout to=.${toTarget}/>\` inside ` +
            `state-child \`<${sc.tag}>\` references variant \`.${toTarget}\` which is not ` +
            `in \`${forType}\`. Valid variants are: ${formatVariantList(variants)}.`,
            engineDecl,
            filePath,
            "error",
          );
        }

        // Fire-site #3: legality vs surrounding `rule=` set (§51.0.M + §51.0.F).
        // The from-state IS this state-child (sc.tag); the to-state must be
        // permitted by `sc.rule`.
        const r = sc.rule;
        if (!r) continue;
        switch (r.kind) {
          case "absent":
            // Terminal state — no transitions; `<onTimeout to=.X>` cannot fire.
            fireA5Diagnostic(
              errors,
              "E-ENGINE-INVALID-TRANSITION",
              `E-ENGINE-INVALID-TRANSITION: \`<onTimeout to=.${toTarget}/>\` inside ` +
              `state-child \`<${sc.tag}>\` cannot fire — \`<${sc.tag}>\` has no \`rule=\` ` +
              `attribute (terminal state per §51.0.F). Add \`rule=.${toTarget}\` (or a ` +
              `wider rule covering \`.${toTarget}\`) to \`<${sc.tag}>\` to permit the timer ` +
              `transition.`,
              engineDecl,
              filePath,
              "error",
            );
            break;
          case "wildcard":
            // `rule=*` — any transition allowed; <onTimeout> is always legal.
            break;
          case "single":
            if (r.target !== toTarget) {
              fireA5Diagnostic(
                errors,
                "E-ENGINE-INVALID-TRANSITION",
                `E-ENGINE-INVALID-TRANSITION: \`<onTimeout to=.${toTarget}/>\` inside ` +
                `state-child \`<${sc.tag}>\` is not permitted by \`<${sc.tag}>\`'s ` +
                `\`rule=.${r.target}\` (single-target form per §51.0.F — only \`.${r.target}\` ` +
                `is reachable). Either change the \`<onTimeout>\` target to \`.${r.target}\`, ` +
                `widen \`rule=\` to \`(.${r.target} | .${toTarget})\` or \`*\`, or remove the ` +
                `\`<onTimeout>\`.`,
                engineDecl,
                filePath,
                "error",
              );
            }
            break;
          case "multi":
            if (!r.targets.includes(toTarget)) {
              fireA5Diagnostic(
                errors,
                "E-ENGINE-INVALID-TRANSITION",
                `E-ENGINE-INVALID-TRANSITION: \`<onTimeout to=.${toTarget}/>\` inside ` +
                `state-child \`<${sc.tag}>\` is not permitted by \`<${sc.tag}>\`'s multi-target ` +
                `\`rule=(${r.targets.map((t) => `.${t}`).join(" | ")})\` (per §51.0.F — only ` +
                `the listed targets are reachable). Either pick one of the listed targets, ` +
                `add \`.${toTarget}\` to the rule list, or widen to \`*\`.`,
                engineDecl,
                filePath,
                "error",
              );
            }
            break;
          case "legacy-arrow":
          case "parse-error":
            // B15 already fired E-ENGINE-RULE-LEGACY-SYNTAX or E-ENGINE-RULE-
            // INVALID-VARIANT on the malformed rule=; A5-3 does NOT double-fire
            // a misleading legality diagnostic against a rule that doesn't
            // structurally exist. Skip silently — the developer fixes the
            // rule= shape first; on next compile, the legality check fires
            // cleanly against the now-valid rule.
            break;
        }
      }
    }

    // ----- Fire-site #9 (A5-3 §A5-3.8 follow-on, S83) — direct-write
    //       cascade-miss diagnostic per §51.0.Q.3 + §51.0.F -----
    //
    // SECOND compile-time E-ENGINE-INVALID-TRANSITION fire-site (fire-site #3
    // above is the FIRST — `<onTimeout to=>` legality). Closes A5-3 §A5-3.8
    // deferral noted in `a5-3-typer-walker.test.js`.
    //
    // Scans `sc.bodyRaw` (RAW TEXT) for the two canonical direct-write forms
    // the spec governs:
    //
    //   - `@varName = .Variant`        — direct assignment per §51.0.F line 20847
    //   - `@varName.advance(.Variant)` — assertion-style transition per §51.0.G
    //
    // Validation mirrors fire-site #3's switch on `sc.rule.kind`:
    //   - `wildcard` → always legal; never fires.
    //   - `absent`   → terminal; ANY direct write fires.
    //   - `single`   → must equal `r.target`.
    //   - `multi`    → must be in `r.targets`.
    //   - `legacy-arrow` / `parse-error` → skip (B15 already fired).
    //
    // SKIPS:
    //   1. When `variants` is empty (unknown for=Type — same gate as fire-site
    //      #3 / fire-site #4).
    //   2. When the captured target is NOT a known variant of the engine's
    //      `for=Type` (type-check error already fires from B20 or downstream;
    //      A5-3 does NOT double-fire a misleading legality diagnostic against
    //      a non-variant — mirrors fire-site #3's gating).
    //
    // CASCADE-MISS framing (§51.0.Q.3 OQ-Harel-6 verdict): when `sc` is a
    // composite state-child (`innerEngines.length > 0`), the diagnostic
    // message extends to name BOTH engines (composite + outer engine) for
    // clarity. The §34 catalog row remains the same — no new error code.
    // Flat-engine (non-composite) violations fire the same code with the
    // canonical message form (no composite framing).
    //
    // BODY-PARSER LIMITATION (Wave 4 surface): `bodyRaw` is truncated at the
    // first markup-tag boundary inside the state-child. The cascade-miss
    // fire-site catches at most one direct-write per state-child body in
    // current pipeline. Broader coverage waits on body-parser widening
    // tracked in `engine-a7-hierarchy.test.js §7`.
    const varName = typeof meta.varName === "string" ? meta.varName : "";
    if (
      varName.length > 0 &&
      variants.length > 0 &&
      typeof sc.bodyRaw === "string" &&
      sc.bodyRaw.length > 0
    ) {
      const directWrites = scanDirectWritesInStateChildBody(sc.bodyRaw, varName);
      for (const dw of directWrites) {
        // Skip targets not in this engine's variants — different error
        // already fires (or will fire) for that case; mirrors fire-site #3.
        if (!variantSet.has(dw.target)) continue;

        // ----- Fire-site #10 (v0.3 Option-d synthesis) — self-write
        //       no-op detection: W-ENGINE-SELF-WRITE-DETECTED (info) -----
        //
        // When the direct-write target equals the enclosing state-child's
        // tag (`@varName = .CurrentVariant` from inside `<CurrentVariant>`),
        // the runtime treats the write as an idempotent no-op per
        // §51.0.F (v0.3 amendment). NOT a rule= violation — fire-site #9's
        // cascade-miss check is intentionally SKIPPED below.
        //
        // STRICT fire condition: enclosing state-child is statically known
        // (we are walking it), and the write target literally matches the
        // tag. Adopters writing `@x = .Same` from inside `<Same>` get this
        // surfacing as a "your write is intentionally a no-op" signal.
        // Suppression: rephrase the write target OR add a comment marking
        // intent; no hard-suppress mechanism per BRIEF — v0.3 lint design.
        if (dw.target === sc.tag) {
          const writeRepr = dw.shape === "advance"
            ? `@${varName}.advance(.${dw.target})`
            : `@${varName} = .${dw.target}`;
          fireA5Diagnostic(
            errors,
            "W-ENGINE-SELF-WRITE-DETECTED",
            `W-ENGINE-SELF-WRITE-DETECTED: \`${writeRepr}\` inside state-child ` +
            `\`<${sc.tag}>\` is a SELF-WRITE — the write target equals the enclosing ` +
            `state-child's variant. Per SPEC §51.0.F (v0.3 Option-d synthesis), self-` +
            `writes to the current variant are idempotent NO-OPS at runtime: no ` +
            `\`<onTransition>\` fires, no timer rearm, no history capture, no ` +
            `subscriber notification. If the no-op is INTENTIONAL (e.g., a defensive ` +
            `\`set(.Current)\` in a code path that may also reach from other ` +
            `variants), this lint is informational only — no action required. If ` +
            `you EXPECTED a state change, verify the write target. Suppress by ` +
            `removing the write or by phrasing the target via a derived expression ` +
            `that is not literally \`.${dw.target}\` at this site.`,
            engineDecl,
            filePath,
            "info",
          );
          // SKIP fire-site #9 cascade-miss check for self-writes — the
          // runtime no-op shape means this is NOT a rule= violation under
          // v0.3 §51.0.F semantics, even when sc.rule does not list itself.
          continue;
        }

        const r = sc.rule;
        if (!r) continue;
        const isComposite = Array.isArray(sc.innerEngines) && sc.innerEngines.length > 0;
        const writeRepr = dw.shape === "advance"
          ? `@${varName}.advance(.${dw.target})`
          : `@${varName} = .${dw.target}`;
        // Composite-aware framing prefix per §51.0.Q.3 — names both the
        // outer composite state-child AND the engine variable + type for
        // clarity. Non-composite uses the canonical framing.
        const ctxPrefix = isComposite
          ? `inside composite \`<${sc.tag}>\` (engine \`${varName}: ${forType}\`), ` +
            `direct write \`${writeRepr}\``
          : `\`${writeRepr}\` inside state-child \`<${sc.tag}>\``;

        switch (r.kind) {
          case "absent":
            // Terminal state — no transitions; direct write cannot fire.
            fireA5Diagnostic(
              errors,
              "E-ENGINE-INVALID-TRANSITION",
              `E-ENGINE-INVALID-TRANSITION: ${ctxPrefix} is not a legal transition ` +
              `target — \`<${sc.tag}>\` has no \`rule=\` attribute (terminal state per ` +
              `§51.0.F). Either add \`rule=.${dw.target}\` (or a wider rule covering ` +
              `\`.${dw.target}\`) to \`<${sc.tag}>\`, or remove the direct write.`,
              engineDecl,
              filePath,
              "error",
            );
            break;
          case "wildcard":
            // `rule=*` — any target legal; never fires.
            break;
          case "single":
            if (r.target !== dw.target) {
              const composite = isComposite
                ? `${sc.tag}.rule=` // §51.0.Q.3-shaped: name the composite explicitly
                : `\`<${sc.tag}>\`'s \`rule=`;
              fireA5Diagnostic(
                errors,
                "E-ENGINE-INVALID-TRANSITION",
                `E-ENGINE-INVALID-TRANSITION: ${ctxPrefix} is invalid. ` +
                (isComposite
                  ? `Composite \`${composite}\` permits: .${r.target}. `
                  : `${composite}.${r.target}\` (single-target form per §51.0.F — only ` +
                    `\`.${r.target}\` is reachable). `) +
                `Either change the target to \`.${r.target}\`, widen \`rule=\` to ` +
                `\`(.${r.target} | .${dw.target})\` or \`*\`, or remove the write.`,
                engineDecl,
                filePath,
                "error",
              );
            }
            break;
          case "multi":
            if (!r.targets.includes(dw.target)) {
              const targetsList = r.targets.map((t) => `.${t}`).join(", ");
              const targetsPipe = r.targets.map((t) => `.${t}`).join(" | ");
              fireA5Diagnostic(
                errors,
                "E-ENGINE-INVALID-TRANSITION",
                `E-ENGINE-INVALID-TRANSITION: ${ctxPrefix} is invalid. ` +
                (isComposite
                  ? `Composite \`${sc.tag}.rule=\` permits: ${targetsList}. `
                  : `\`<${sc.tag}>\`'s multi-target \`rule=(${targetsPipe})\` (per ` +
                    `§51.0.F — only the listed targets are reachable). `) +
                `Either pick one of the listed targets, add \`.${dw.target}\` to the ` +
                `rule list, or widen to \`*\`.`,
                engineDecl,
                filePath,
                "error",
              );
            }
            break;
          case "legacy-arrow":
          case "parse-error":
            // B15 already fired on the malformed rule=; do NOT double-fire a
            // misleading legality diagnostic. Mirrors fire-site #3 behavior.
            break;
        }
      }
    }
  }

  // ----- File-scope aggregation (always — per SURVEY §4). -----
  meta.historyAttr = aggHistoryAttr;
  meta.internalRules = aggInternalRules;
  meta.onTimeoutElements = aggOnTimeoutElements;
}

/**
 * PASS 16 walker — visits every engine-decl in the AST and runs A5-3
 * extension validation. Mirrors `walkValidateEngineStateChildrenAndRules`
 * (B15 PASS 11) shape verbatim — same recursion contract, same engine-decl
 * stop-recursion (engine bodies are raw text; no walkable children today).
 */
function walkValidateEngineA5Extensions(
  nodes: any,
  fileAst: any,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkValidateEngineA5Extensions(n, fileAst, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  if (node.kind === "engine-decl") {
    validateEngineA5Extensions(node, fileAst, errors, filePath);
    // A5-7 Wave 2.4 (§51.0.Q.1, Bug #2) — recurse into bodyChildren so
    // nested engines (composite state-children) get their A5 extensions
    // validated too. Each nested engine has its own state-children with
    // their own rule=/`onTimeout`/`history`/`internal:rule=` surface to
    // validate. Without this recursion, inner-engine A5 extensions would
    // be silently un-validated.
    if (Array.isArray((node as any).bodyChildren)) {
      walkValidateEngineA5Extensions((node as any).bodyChildren, fileAst, errors, filePath, visited);
    }
    return;
  }

  if (Array.isArray(node.children)) {
    walkValidateEngineA5Extensions(node.children, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkValidateEngineA5Extensions(node.body, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkValidateEngineA5Extensions(node.consequent, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkValidateEngineA5Extensions(node.alternate, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkValidateEngineA5Extensions(arm.body, fileAst, errors, filePath, visited);
      }
    }
  }
}



// ---------------------------------------------------------------------------
// PASS 17 (B17.3) — `<onTransition>` + `effect=` typer diagnostics (§51.0.H + §51.0.F)
// ---------------------------------------------------------------------------
//
// Per Phase A1b Step B17.3 (BRIEF + SURVEY at
// `docs/changes/phase-a1b-step-b17-3-typer-diagnostics-ontransition-effect/{BRIEF,SURVEY}.md`).
//
// Consumes B17.2's parser annotations on `EngineStateChildEntry`:
//   - `effectRaw: string | null` — the inner expression text of `effect=${...}`
//     attribute on the state-child opener (or `null` when absent).
//   - `onTransitionElements: OnTransitionEntry[]` — `<onTransition>` siblings
//     parsed out of the state-child body, each with `to/from/once/ifExprRaw/bodyRaw`.
//
// **In-scope fire-sites (5 — STANDARD shape per S74 BRIEF Q1+Q2 ratification):**
//
//   1. E-ENGINE-EFFECT-AMBIGUOUS (existing §34 row 14377; §51.0.H line 20471) —
//      `entry.effectRaw != null && entry.rule.kind === "multi"`. `effect=` is
//      single-target only; combining with multi-target rule= is ambiguous (which
//      target triggers it?).
//
//   2. E-ENGINE-RULE-INVALID-VARIANT (existing §34 row 14467) for
//      `<onTransition to=.X>` — `entry.to != null && entry.to NOT IN engineMeta.variants`.
//      Mirrors A5-3 PASS 16 fire-site #4 pattern (same code reused for `<onTimeout to=>`).
//
//   3. E-ENGINE-RULE-INVALID-VARIANT (same code as #2) for `<onTransition from=.X>` —
//      `entry.from != null && entry.from NOT IN engineMeta.variants`. Same pattern.
//
//   4. E-ENGINE-INVALID-TRANSITION (existing §34 row 14376; §51.0.F rule= contract) —
//      compile-time fire when an `<onTransition to=.X>` placed in a FROM-state-child
//      (i.e., in this state-child whose body it sits in) does NOT satisfy the surrounding
//      `rule=` legality. Mirrors A5-3 PASS 16 fire-site #3 (same pattern as `<onTimeout
//      to=.X>`). The from-state IS this state-child (`sc.tag`); the to-state must be
//      permitted by `sc.rule`.
//
//      Wildcard `rule=*` accepts any target — never fires.
//      Multi-target `rule=(.A | .B)` — `entry.to` must be in `[.A, .B]`.
//      Single-target `rule=.A` — `entry.to` must be `.A`.
//      Absent rule (terminal state) — fires for ANY `entry.to`.
//
//   5. E-ONTRANSITION-NO-TARGET (NEW §34 row at S74 — A1b B17.3) —
//      `entry.to == null && entry.from == null`. The handler has no trigger.
//      Per §51.0.H attribute table, exactly one of `to=` / `from=` MUST appear.
//
// **Out of scope (DEFERRED on infrastructure or scope-OUT per BRIEF):**
//
//   - `<onTransition>` placement OUTSIDE engine state-child (E-STRUCTURAL-ELEMENT-MISPLACED)
//     — same precondition that defers A5-3 fire-sites #5/#6 (markup walker that
//     tokenizes `<onTransition>` everywhere).
//   - `if=expr` type-checking — DEFERRED per SURVEY decision 2 (engine bodies are
//     RAW TEXT today; expression-typer doesn't see `ifExprRaw` content).
//   - `<onTransition>` BODY type-checking — body-rendering wide step territory.
//   - `from=.X` cross-state-child consistency check — future C-step (codegen
//     correlates `from=.X` placements against the FROM-state-child's `rule=`).
//   - Inner-engine recursion — A1c codegen territory; PASS 17 walks the OUTER
//     engine's state-children only (composite marker is `innerEngines.length > 0`).
//
// **EngineRuleForm shapes mapping (to fire-site #1 + #4):**
//
//   - `kind: "single"` → effect= LEGAL (no fire-site #1); fire-site #4 checks
//     `entry.to === r.target`.
//   - `kind: "multi"` → effect= AMBIGUOUS (fire-site #1); fire-site #4 checks
//     `r.targets.includes(entry.to)`.
//   - `kind: "wildcard"` → effect= LEGAL per the BRIEF predicate (`kind === "multi"`
//     ONLY fires E-ENGINE-EFFECT-AMBIGUOUS; wildcard does NOT). Fire-site #4 always
//     passes (wildcard accepts any target).
//   - `kind: "absent"` → effect= LEGAL technically (no transitions to fire on, so
//     effect= never runs — semantically inert; no fire-site #1 since rule.kind is
//     not "multi"). Fire-site #4 fires for terminal state on ANY `entry.to`.
//   - `kind: "legacy-arrow" / "parse-error"` → SKIP fire-site #4 (B15 already
//     fired on the malformed rule=; B17.3 does NOT double-fire misleading legality
//     diagnostics against a structurally-broken rule).

/**
 * Fire a B17.3 SYM diagnostic with engine-decl's `span` as a coarse anchor.
 * Mirrors `fireA5Diagnostic` (A5-3 PASS 16 helper) — today's parser doesn't
 * surface tightened spans on individual `<onTransition>` elements (B17.2's
 * `rawOffset` is bodyRaw-relative, not an absolute span). Per SURVEY
 * decision 3, B17.3 inherits A5-3's coarse-anchor approach. Future parser
 * tightening will produce per-element spans automatically — swap the
 * `span` source here without touching call-sites.
 */
function fireB17Diagnostic(
  errors: SYMDiagnostic[],
  code: string,
  message: string,
  engineDecl: any,
  filePath: string,
  severity: "error" | "warning" = "error",
): void {
  const span: SYMDiagnostic["span"] = engineDecl?.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  errors.push({ code, message, span, severity });
}

/**
 * PASS 17 (B17.3) — per-engine `<onTransition>` + `effect=` typer diagnostics.
 * For each `engine-decl` carrying a `_record` (set by PASS 10.A) AND
 * `engineMeta.stateChildren` (populated by PASS 11 / B15 + B17.2 annotations),
 * iterate state-children and apply the 5 fire-sites enumerated above.
 *
 * Exported for direct test use (mirrors A5-3's `validateEngineA5Extensions`
 * export pattern). Synthesized AST tests bypass full-pipeline run.
 */
export function validateEngineB17Diagnostics(
  engineDecl: any,
  fileAst: any,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  void fileAst; // reserved for future cross-decl checks; intentional unused.
  const record: StateCellRecord | undefined = engineDecl._record;
  if (!record || !record.engineMeta) return;
  const meta = record.engineMeta;

  const stateChildren = meta.stateChildren;
  if (!Array.isArray(stateChildren) || stateChildren.length === 0) return;

  const variants = Array.isArray(meta.variants) ? meta.variants : [];
  const variantSet = new Set(variants);
  const forType = typeof meta.forType === "string" ? meta.forType : "";

  for (const sc of stateChildren) {
    if (!sc || typeof sc !== "object") continue;

    // ----- Fire-site #1: E-ENGINE-EFFECT-AMBIGUOUS (§51.0.H line 20471) -----
    // `effect=` on multi-target `rule=` is ambiguous — which target triggers it?
    // Per BRIEF predicate: `entry.effectRaw != null && entry.rule.kind === "multi"`.
    if (sc.effectRaw != null && sc.rule && sc.rule.kind === "multi") {
      const targets = sc.rule.targets.map((t: string) => `.${t}`).join(" | ");
      fireB17Diagnostic(
        errors,
        "E-ENGINE-EFFECT-AMBIGUOUS",
        `E-ENGINE-EFFECT-AMBIGUOUS: \`effect=\` attribute on state-child ` +
        `\`<${sc.tag}>\` has multi-target \`rule=(${targets})\`. Use \`<onTransition ` +
        `to=...>\` children instead — \`effect=\` requires a single-target rule (§51.0.H).`,
        engineDecl,
        filePath,
        "error",
      );
    }

    // ----- Per-onTransition checks (fire-sites #2, #3, #4, #5) -----
    if (Array.isArray(sc.onTransitionElements) && sc.onTransitionElements.length > 0) {
      for (const ot of sc.onTransitionElements) {
        if (!ot || typeof ot !== "object") continue;

        // ----- Fire-site #5: E-ONTRANSITION-NO-TARGET (NEW §34 row, S74) -----
        // The handler has no trigger when both `to=` and `from=` are absent.
        if (ot.to == null && ot.from == null) {
          fireB17Diagnostic(
            errors,
            "E-ONTRANSITION-NO-TARGET",
            `E-ONTRANSITION-NO-TARGET: \`<onTransition>\` in state-child ` +
            `\`<${sc.tag}>\` has neither \`to=\` nor \`from=\` attribute. The handler ` +
            `has no trigger. Add \`to=.Variant\` (outgoing) or \`from=.Variant\` ` +
            `(incoming) (§51.0.H).`,
            engineDecl,
            filePath,
            "error",
          );
          // Continue to next entry — fire-sites #2/#3/#4 are gated on
          // to/from being non-null and would not fire here anyway.
          continue;
        }

        // ----- Fire-site #2: E-ENGINE-RULE-INVALID-VARIANT for `<onTransition to=.X>` -----
        // Skipped when variants is empty (unknown for=Type — same gate as B15/A5-3).
        let toIsKnownVariant = true;
        if (typeof ot.to === "string" && ot.to.length > 0) {
          if (variants.length > 0 && !variantSet.has(ot.to)) {
            toIsKnownVariant = false;
            fireB17Diagnostic(
              errors,
              "E-ENGINE-RULE-INVALID-VARIANT",
              `E-ENGINE-RULE-INVALID-VARIANT: \`<onTransition to=.${ot.to}>\` inside ` +
              `state-child \`<${sc.tag}>\` references variant \`.${ot.to}\` which is not ` +
              `in \`${forType}\`. Valid variants are: ${formatVariantList(variants)}.`,
              engineDecl,
              filePath,
              "error",
            );
          }
        }

        // ----- Fire-site #3: E-ENGINE-RULE-INVALID-VARIANT for `<onTransition from=.X>` -----
        if (typeof ot.from === "string" && ot.from.length > 0) {
          if (variants.length > 0 && !variantSet.has(ot.from)) {
            fireB17Diagnostic(
              errors,
              "E-ENGINE-RULE-INVALID-VARIANT",
              `E-ENGINE-RULE-INVALID-VARIANT: \`<onTransition from=.${ot.from}>\` inside ` +
              `state-child \`<${sc.tag}>\` references variant \`.${ot.from}\` which is not ` +
              `in \`${forType}\`. Valid variants are: ${formatVariantList(variants)}.`,
              engineDecl,
              filePath,
              "error",
            );
          }
        }

        // ----- Fire-site #4: E-ENGINE-INVALID-TRANSITION (compile-time, §51.0.F) -----
        // Only checks the FROM-state-child placement: `<onTransition to=.X>` placed
        // in `sc` means "when leaving sc TOWARD .X" — must satisfy sc.rule's contract.
        // SKIP when:
        //   - `entry.to` is null (this is a `from=`-only entry; placement contract
        //     applies to the OTHER state-child's rule= per §51.0.H from-side semantics,
        //     and that cross-state-child check is OUT OF SCOPE per the comment above).
        //   - `entry.to` is not a known variant (fire-site #2 already fired; don't
        //     double-fire a misleading legality diagnostic against a non-variant).
        //   - `sc.rule` is `legacy-arrow` / `parse-error` (B15 already fired on the
        //     malformed rule=; mirror A5-3 fire-site #3 skip behavior).
        if (
          typeof ot.to === "string" && ot.to.length > 0 &&
          toIsKnownVariant
        ) {
          const r = sc.rule;
          if (r) {
            switch (r.kind) {
              case "absent":
                // Terminal state — no transitions; `<onTransition to=.X>` cannot fire.
                fireB17Diagnostic(
                  errors,
                  "E-ENGINE-INVALID-TRANSITION",
                  `E-ENGINE-INVALID-TRANSITION: \`<onTransition to=.${ot.to}>\` in ` +
                  `state-child \`<${sc.tag}>\` is not a legal transition target — ` +
                  `\`<${sc.tag}>\` has no \`rule=\` attribute (terminal state per §51.0.F). ` +
                  `Either add \`rule=.${ot.to}\` (or a wider rule covering \`.${ot.to}\`) to ` +
                  `\`<${sc.tag}>\`, or place this \`<onTransition from=.${sc.tag}>\` in the ` +
                  `\`<${ot.to}>\` state-child instead.`,
                  engineDecl,
                  filePath,
                  "error",
                );
                break;
              case "wildcard":
                // `rule=*` — any target legal; never fires.
                break;
              case "single":
                if (r.target !== ot.to) {
                  fireB17Diagnostic(
                    errors,
                    "E-ENGINE-INVALID-TRANSITION",
                    `E-ENGINE-INVALID-TRANSITION: \`<onTransition to=.${ot.to}>\` in ` +
                    `state-child \`<${sc.tag}>\` is not a legal transition target — ` +
                    `\`rule=.${r.target}\` (single-target form per §51.0.F — only ` +
                    `\`.${r.target}\` is reachable). Either add \`.${ot.to}\` to \`rule=\`, ` +
                    `or place this \`<onTransition from=.${sc.tag}>\` in the \`<${ot.to}>\` ` +
                    `state-child instead.`,
                    engineDecl,
                    filePath,
                    "error",
                  );
                }
                break;
              case "multi":
                if (!r.targets.includes(ot.to)) {
                  const targets = r.targets.map((t) => `.${t}`).join(" | ");
                  fireB17Diagnostic(
                    errors,
                    "E-ENGINE-INVALID-TRANSITION",
                    `E-ENGINE-INVALID-TRANSITION: \`<onTransition to=.${ot.to}>\` in ` +
                    `state-child \`<${sc.tag}>\` is not a legal transition target — ` +
                    `\`rule=(${targets})\` (multi-target form per §51.0.F — only the ` +
                    `listed targets are reachable). Either add \`.${ot.to}\` to \`rule=\`, ` +
                    `or place this \`<onTransition from=.${sc.tag}>\` in the \`<${ot.to}>\` ` +
                    `state-child instead.`,
                    engineDecl,
                    filePath,
                    "error",
                  );
                }
                break;
              case "legacy-arrow":
              case "parse-error":
                // B15 already fired on malformed rule=; don't double-fire here
                // (mirrors A5-3 PASS 16 fire-site #3 skip behavior).
                break;
            }
          }
        }
      }
    }
  }
}

/**
 * PASS 17 walker — visits every engine-decl in the AST and runs B17.3
 * `<onTransition>` + `effect=` validation. Mirrors `walkValidateEngineA5Extensions`
 * (PASS 16) shape verbatim — same recursion contract, same engine-decl
 * stop-recursion (engine bodies are raw text; no walkable children today).
 */
function walkValidateEngineB17Diagnostics(
  nodes: any,
  fileAst: any,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkValidateEngineB17Diagnostics(n, fileAst, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  if (node.kind === "engine-decl") {
    validateEngineB17Diagnostics(node, fileAst, errors, filePath);
    // A5-7 Wave 2.4 (§51.0.Q.1, Bug #2) — recurse into bodyChildren so
    // nested engines (composite state-children) get their B17 hook
    // diagnostics validated too. Each nested engine may have its own
    // `effect=` / `<onTransition>` arms — without this recursion they'd
    // be silently un-validated.
    if (Array.isArray((node as any).bodyChildren)) {
      walkValidateEngineB17Diagnostics((node as any).bodyChildren, fileAst, errors, filePath, visited);
    }
    return;
  }

  if (Array.isArray(node.children)) {
    walkValidateEngineB17Diagnostics(node.children, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkValidateEngineB17Diagnostics(node.body, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkValidateEngineB17Diagnostics(node.consequent, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkValidateEngineB17Diagnostics(node.alternate, fileAst, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkValidateEngineB17Diagnostics(arm.body, fileAst, errors, filePath, visited);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PASS 18 (A6-3) — `test-bind` typer support per SPEC §19.12.6 / §19.12.7
// ---------------------------------------------------------------------------
//
// For every `~{}` test block (AST node `kind === "test"`) found in the file
// AST, iterate `node.testGroup.testBinds[]` (populated by A6-2 parser at
// `ast-builder.js:8175`) and:
//
//   1. **LHS resolution.** Look up `bind.identifier` against the set of
//      same-file `function-decl` nodes. If no match OR the matched fn has
//      `isServer !== true`, fire E-TEST-005 ("invalid test structure")
//      with a discriminator message per SPEC §19.12.6.
//   2. **RHS-shape discrimination.** Apply the syntactic + scope-lookup
//      heuristic to `bind.expression` (raw RHS source). Stamp
//      `bind.bindKind = "handler" | "return-stub"` on the AST node.
//      Codegen (A6-4) reads this annotation to pick the dispatch shape
//      per §19.12.7.
//
// **Cross-file imported server-fn LHS:** silently defers (export registry
// lacks an `isServer` discriminator at this revision; see SURVEY §2.3).
// The annotation defaults to `"return-stub"` so codegen is robust.
//
// **Strict signature-assignability:** out of scope (see SURVEY §2.4).
// FunctionType in TS is opaque; A6-3 ships syntactic discrimination as the
// practical interpretation.
//
// **Walker shape:** mirrors PASS 17 (`walkValidateEngineB17Diagnostics`)
// recursion contract — descend into `children`/`body`/`consequent`/
// `alternate`/`arms[].body`. Stops descending at engine-decl (raw text
// bodies) and skips no other node kind. The fileAst's `function-decl`
// collection is built once before the walk for O(1) name lookups.

/**
 * Match an arrow function literal: `(...) => ...` with optional parens.
 * Permissive — any leading whitespace, optional outer parens around the
 * param list, and a non-greedy `=>` arrow. Doesn't validate body shape.
 *
 * Examples that match: `() => 1`, `(x) => x`, `x => x`, `(a, b) => a+b`,
 * `(id) => { return id; }`, `async () => 1`.
 */
const TEST_BIND_RHS_ARROW_RE =
  /^\s*(?:async\s+)?(?:[A-Za-z_$][\w$]*\s*=>|\([^)]*\)\s*=>)/;

/**
 * Match a function expression: `function name?(...)`. Permissive — handles
 * named/anonymous and the `function*` generator form.
 */
const TEST_BIND_RHS_FUNCTION_RE =
  /^\s*(?:async\s+)?function\s*\*?\s*[A-Za-z_$]?[\w$]*\s*\(/;

/**
 * Match a single bare identifier (no operators, no calls, no member access).
 * Used to detect "RHS is a plain identifier" — eligible for scope-lookup
 * to discriminate function-bound vs value-bound.
 */
const TEST_BIND_RHS_IDENT_RE = /^\s*([A-Za-z_$][\w$]*)\s*$/;

/**
 * Discriminate a `test-bind` RHS expression source string into the dispatch
 * shape per SPEC §19.12.6. Pure function — no diagnostic firing here.
 *
 * @param rhsSource    — raw RHS source text from `bind.expression`
 * @param sameFileFns  — same-file function-decl names (any kind, server or not)
 * @param fileScope    — file scope for import-binding lookup
 * @returns "handler" | "return-stub"
 */
function discriminateTestBindRhs(
  rhsSource: string,
  sameFileFns: Set<string>,
  fileScope: Scope,
): "handler" | "return-stub" {
  if (!rhsSource || typeof rhsSource !== "string") return "return-stub";

  // Rule 1: function-literal patterns → handler.
  if (TEST_BIND_RHS_ARROW_RE.test(rhsSource)) return "handler";
  if (TEST_BIND_RHS_FUNCTION_RE.test(rhsSource)) return "handler";

  // Rule 2: plain-identifier RHS resolving to a function-decl or import.
  const identMatch = rhsSource.match(TEST_BIND_RHS_IDENT_RE);
  if (identMatch) {
    const ident = identMatch[1];
    if (sameFileFns.has(ident)) return "handler";
    if (fileScope.importBindings.has(ident)) return "handler";
  }

  // Rule 3: otherwise → return-stub.
  return "return-stub";
}

/**
 * Collect all same-file `function-decl` nodes into a name → node map.
 * Walks the AST top-down; nested functions are included (per S74 hand-off
 * item 178's "the typer makes this call at compile time" — server-fn
 * nesting is exotic but not banned by the spec).
 */
function collectSameFileFunctionDecls(
  nodes: any,
  out: Map<string, any>,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) collectSameFileFunctionDecls(n, out, visited);
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);
  const node = nodes as any;
  if (node.kind === "function-decl" && typeof node.name === "string") {
    if (!out.has(node.name)) out.set(node.name, node);
  }
  if (Array.isArray(node.children)) collectSameFileFunctionDecls(node.children, out, visited);
  if (Array.isArray(node.body)) collectSameFileFunctionDecls(node.body, out, visited);
  if (Array.isArray(node.consequent)) collectSameFileFunctionDecls(node.consequent, out, visited);
  if (Array.isArray(node.alternate)) collectSameFileFunctionDecls(node.alternate, out, visited);
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) collectSameFileFunctionDecls(arm.body, out, visited);
    }
  }
}

/**
 * PASS 18 (A6-3) — annotate every `test-bind` declaration in a single
 * `kind: "test"` AST node with `bindKind` and fire E-TEST-005 on LHS-
 * resolution failure.
 *
 * Exported for direct test use (mirrors PASS 17's `validateEngineB17Diagnostics`
 * pattern). Synthesized AST tests bypass full-pipeline run.
 */
export function annotateTestBindsInBlock(
  testNode: any,
  fnDecls: Map<string, any>,
  fileScope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
): void {
  if (!testNode || typeof testNode !== "object") return;
  if (testNode.kind !== "test") return;
  const tg = testNode.testGroup;
  if (!tg || !Array.isArray(tg.testBinds)) return;

  for (const bind of tg.testBinds) {
    if (!bind || typeof bind !== "object") continue;
    const ident = typeof bind.identifier === "string" ? bind.identifier : "";
    const rhs = typeof bind.expression === "string" ? bind.expression : "";

    // ----- LHS resolution -----
    const fn = fnDecls.get(ident);
    const isImportBinding = fileScope.importBindings.has(ident);
    if (!fn && !isImportBinding) {
      // Identifier resolves to nothing in the file's declaration or import scope.
      const span: SYMDiagnostic["span"] = testNode.span ?? {
        file: filePath, start: 0, end: 0, line: 1, col: 1,
      };
      errors.push({
        code: "E-TEST-005",
        message:
          `E-TEST-005: \`test-bind ${ident}\` does not resolve to a server function ` +
          `in scope. Per SPEC §19.12.6, the LHS must name a \`server fn\` ` +
          `declaration in this file's declaration or import scope. ` +
          `Declare \`server fn ${ident}(...)\` (or import it from another file) ` +
          `before this \`~{}\` block.`,
          span,
        severity: "error",
      });
    } else if (fn && fn.isServer !== true) {
      // Identifier resolves to a same-file function but it's not server-prefixed.
      const span: SYMDiagnostic["span"] = testNode.span ?? {
        file: filePath, start: 0, end: 0, line: 1, col: 1,
      };
      errors.push({
        code: "E-TEST-005",
        message:
          `E-TEST-005: \`test-bind ${ident}\` resolves to function \`${ident}\` ` +
          `declared without the \`server\` modifier. Only \`server fn\`/\`server ` +
          `function\` declarations are valid \`test-bind\` targets per SPEC §19.12.6. ` +
          `Add the \`server\` modifier to \`${ident}\` or remove this \`test-bind\`.`,
          span,
        severity: "error",
      });
    }
    // (When `isImportBinding` is true and `fn` is null, we silently accept —
    //  cross-file server-fn imports are deferred per A6-3 SURVEY §2.3.)

    // ----- RHS-shape discrimination -----
    const sameFileFnNames = new Set(fnDecls.keys());
    bind.bindKind = discriminateTestBindRhs(rhs, sameFileFnNames, fileScope);
  }
}

/**
 * PASS 18 walker — visits every `kind: "test"` AST node and runs the A6-3
 * annotation + diagnostic pass. Mirrors PASS 17 walker shape: same recursion
 * contract, no special-case stops (test blocks live at top-level or under
 * meta-context wrappers; nested test blocks are forbidden by E-TEST-001 —
 * the walker is robust to that constraint regardless).
 */
function walkAnnotateTestBindKinds(
  nodes: any,
  fnDecls: Map<string, any>,
  fileScope: Scope,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      walkAnnotateTestBindKinds(n, fnDecls, fileScope, errors, filePath, visited);
    }
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  if (node.kind === "test") {
    annotateTestBindsInBlock(node, fnDecls, fileScope, errors, filePath);
    // Don't descend further from a test block — the testGroup isn't a normal
    // AST container, and A6-2 already handled inner structure.
    return;
  }

  if (Array.isArray(node.children)) {
    walkAnnotateTestBindKinds(node.children, fnDecls, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.body)) {
    walkAnnotateTestBindKinds(node.body, fnDecls, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.consequent)) {
    walkAnnotateTestBindKinds(node.consequent, fnDecls, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.alternate)) {
    walkAnnotateTestBindKinds(node.alternate, fnDecls, fileScope, errors, filePath, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) {
        walkAnnotateTestBindKinds(arm.body, fnDecls, fileScope, errors, filePath, visited);
      }
    }
  }
}



// ---------------------------------------------------------------------------
// A4 (S105) — §48.6.4 PASS 19: E-STATE-PINNED-FORWARD-REF on calls to
// `pinned fn` declared LATER in source order.
//
// Parser-recognition for `pinned fn` landed S105 commit `dc3c460` — the
// FunctionDeclNode's `isPinned?: boolean` flag is set on all 6 form variants
// (`pinned fn`, `pinned async fn`, `pinned pure fn`, `pinned server fn`,
// `pinned async server fn`, `pinned pure server fn`). This PASS 19 closes
// the semantic-enforcement half: per SPEC §48.6.4, `pinned fn` opts the
// declaration OUT of hoisting per §6.10, and forward references SHALL fire
// E-STATE-PINNED-FORWARD-REF (§34 — same diagnostic used for pinned state
// cells + pinned imports at PASS 3's B4 fire-paths).
//
// Walker shape mirrors PASS 3 (walkResolveAtNames): structural recursion,
// readPos tracked via nodeReadPos, ExprNode payloads inspected via
// B3_EXPR_FIELDS. The check itself uses `forEachCallInExprNode` (sibling of
// `forEachIdentInExprNode`) to visit every CallExpr in the tree, then tests
// bare-ident callees against the pinned-fn map.
//
// Map population: walk the AST once via `collectPinnedFunctionDecls` (a
// scoped variant of test-bind's `collectSameFileFunctionDecls`); only nodes
// with `isPinned === true` populate the map. When the map is empty (no
// `pinned fn` in the file), PASS 19 returns early — zero performance cost.
//
// Cross-references:
//   - SPEC §48.6.4 (lines 20254-20299) — the normative source.
//   - SPEC §6.10 — the pinned modifier the §48.6.4 amendment extends.
//   - SPEC §34 — E-STATE-PINNED-FORWARD-REF (shared diagnostic).
//   - compiler/src/symbol-table.ts:1494-1551 — B4 cell + import pinned-
//     forward-ref check (the pattern this PASS mirrors).
//   - compiler/src/ast-builder.js (S105 dc3c460) — the parser-recognition
//     half that populates `isPinned: true` on FunctionDeclNode.

function collectPinnedFunctionDecls(
  nodes: any,
  out: Map<string, FunctionDeclNode>,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) collectPinnedFunctionDecls(n, out, visited);
    return;
  }
  const node = nodes;
  if (!node || typeof node !== "object") return;
  if (visited.has(node)) return;
  visited.add(node);
  if (
    node.kind === "function-decl"
    && (node as FunctionDeclNode).isPinned === true
    && typeof (node as FunctionDeclNode).name === "string"
  ) {
    // Last-wins on name collision (parser may emit duplicates under odd
    // module shapes; the B4-pattern source-position check operates on
    // whichever decl span lands last — same as cell-pinned semantics).
    out.set((node as FunctionDeclNode).name, node as FunctionDeclNode);
  }
  // Recurse: same shape as test-bind collector.
  if (Array.isArray(node.children)) collectPinnedFunctionDecls(node.children, out, visited);
  if (Array.isArray(node.body)) collectPinnedFunctionDecls(node.body, out, visited);
  if (Array.isArray(node.consequent)) collectPinnedFunctionDecls(node.consequent, out, visited);
  if (Array.isArray(node.alternate)) collectPinnedFunctionDecls(node.alternate, out, visited);
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) collectPinnedFunctionDecls(arm.body, out, visited);
    }
  }
  // engine-decl bodyChildren parallels Phase A10 (S78) — pinned fn forward
  // refs inside engine state-child bodies should also fire.
  if (Array.isArray(node.bodyChildren)) collectPinnedFunctionDecls(node.bodyChildren, out, visited);
  if (node.kind === "lift-expr" && node.expr && node.expr.kind === "markup" && node.expr.node) {
    collectPinnedFunctionDecls([node.expr.node], out, visited);
  }
}

function checkPinnedFnForwardCallsInExpr(
  exprNode: ExprNode | undefined | null,
  pinnedFnDecls: Map<string, FunctionDeclNode>,
  errors: SYMDiagnostic[],
  readPos: number,
  filePath: string,
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  forEachCallInExprNode(exprNode as any, (call: CallExpr) => {
    if (!call || !call.callee || call.callee.kind !== "ident") return;
    const calleeName = (call.callee as IdentExpr).name;
    if (!calleeName || calleeName.startsWith("@")) return;
    const pinnedDecl = pinnedFnDecls.get(calleeName);
    if (!pinnedDecl) return;
    const declSpan = (pinnedDecl as any).span;
    if (!declSpan || typeof declSpan.start !== "number") return;
    // Forward-ref rule for `pinned fn` differs from B4 cell-pinned in the
    // comparison anchor: cells use `declSpan.end` (so self-ref inside the
    // cell's own init expression fires — per SPEC §6.10.5); fns use
    // `declSpan.start` (so self-recursion inside the fn body — which is
    // SEMANTICALLY inside the decl-span between start and end — does NOT
    // fire, because basic fn semantics admit recursion). The pinned-fn
    // forward-ref forbids calls BEFORE the pinned-fn declaration is even
    // partially introduced (i.e., before the `pinned` keyword token).
    //
    // ALSO: the fn-decl's `span.end` is computed by ast-builder.js's
    // `spanOf(startTok, peek())` which uses `peek().span.end` — i.e., the
    // END of the NEXT token after the fn body. That means fn-decl spans
    // routinely OVERLAP with the next statement's span, making
    // `readPos < span.end` unreliable for backward-call distinction.
    // Comparison against `span.start` (the `pinned` keyword position) is
    // both semantically correct AND structurally robust to that quirk.
    if (readPos < declSpan.start) {
      errors.push({
        code: "E-STATE-PINNED-FORWARD-REF",
        message:
          `E-STATE-PINNED-FORWARD-REF: forward reference to \`pinned fn\` `
          + `\`${calleeName}\`. The \`pinned\` modifier opts the function `
          + `declaration OUT of hoisting per §48.6.4 + §6.10; calls before `
          + `the declaration site are unsafe. Move the call after the `
          + `\`pinned fn\` declaration, OR remove the \`pinned\` modifier `
          + `to allow standard \`fn\` hoisting (SPEC §48.6.4 + §34).`,
        span: { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
        severity: "error",
      });
    }
  });
}

function walkPinnedFnForwardRefCheck(
  nodes: ASTNode[] | undefined,
  pinnedFnDecls: Map<string, FunctionDeclNode>,
  visited: WeakSet<object>,
  errors: SYMDiagnostic[],
  parentReadPos: number,
  filePath: string,
): void {
  if (!nodes || pinnedFnDecls.size === 0) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;
    const readPos = nodeReadPos(anyN, parentReadPos);

    // Check ExprNode payloads on this node for pinned-fn forward calls.
    for (const f of B3_EXPR_FIELDS) {
      const v = anyN[f];
      if (v && typeof v === "object") {
        checkPinnedFnForwardCallsInExpr(v, pinnedFnDecls, errors, readPos, filePath);
      }
    }
    // c-style for parts (initExpr / condExpr / updateExpr) — same shape as PASS 3.
    if (anyN.cStyleParts && typeof anyN.cStyleParts === "object") {
      for (const f of ["initExpr", "condExpr", "updateExpr"]) {
        const v = anyN.cStyleParts[f];
        if (v && typeof v === "object") {
          checkPinnedFnForwardCallsInExpr(v, pinnedFnDecls, errors, readPos, filePath);
        }
      }
    }

    // Structural recursion — mirror PASS 3 / walkResolveAtNames.
    if (kind === "state-decl" && Array.isArray(anyN.children)) {
      walkPinnedFnForwardRefCheck(anyN.children, pinnedFnDecls, visited, errors, readPos, filePath);
      continue;
    }
    if (kind === "function-decl") {
      walkPinnedFnForwardRefCheck(anyN.body, pinnedFnDecls, visited, errors, readPos, filePath);
      continue;
    }
    if (Array.isArray(anyN.children)) walkPinnedFnForwardRefCheck(anyN.children, pinnedFnDecls, visited, errors, readPos, filePath);
    if (Array.isArray(anyN.body)) walkPinnedFnForwardRefCheck(anyN.body, pinnedFnDecls, visited, errors, readPos, filePath);
    if (Array.isArray(anyN.consequent)) walkPinnedFnForwardRefCheck(anyN.consequent, pinnedFnDecls, visited, errors, readPos, filePath);
    if (Array.isArray(anyN.alternate)) walkPinnedFnForwardRefCheck(anyN.alternate, pinnedFnDecls, visited, errors, readPos, filePath);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkPinnedFnForwardRefCheck(arm.body, pinnedFnDecls, visited, errors, readPos, filePath);
      }
    }
    if (kind === "engine-decl" && Array.isArray(anyN.bodyChildren)) {
      walkPinnedFnForwardRefCheck(anyN.bodyChildren, pinnedFnDecls, visited, errors, readPos, filePath);
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkPinnedFnForwardRefCheck([anyN.expr.node], pinnedFnDecls, visited, errors, readPos, filePath);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run SYM over a single file's AST. Mutates `ast` in place by adding
 * `_scope` to scope-introducing nodes and `_record` to each state-decl;
 * also attaches `_scope` to the FileAST itself.
 *
 * Stage 3.06 of the compiler pipeline (between NR and CE).
 */
export function runSYM(input: SYMInput): SYMResult {
  const { filePath, ast, exportRegistry } = input;

  const fileScope = createScope("file", null, "");
  Object.defineProperty(ast, "_scope", {
    value: fileScope,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  const stats: SYMStats = {
    totalRecords: 0,
    compoundParents: 0,
    compoundChildren: 0,
    totalScopes: 1, // the file-level root counts
    totalImportBindings: 0,
  };

  // PASS 1.b (B4): Register every import specifier into the file-level
  // scope's importBindings map. Imports are hoisted onto `FileAST.imports[]`
  // by TAB, so walking that array is the canonical path; this avoids
  // re-discovering import nodes inside the AST tree (which would require
  // tagging logic-block contents). Runs BEFORE state-decl registration so
  // PASS 3's pinned-forward-ref check (which reads importBindings) sees a
  // populated table from the first walk step.
  registerImportBindings(ast.imports, fileScope);
  stats.totalImportBindings = fileScope.importBindings.size;

  // PASS 1 (B1): Construct scopes + register state-decls. The state-cell
  // table is fully populated when this returns, so PASS 2 can do a clean
  // parent-chain walk for collision detection regardless of source order.
  // (State-decls hoist per SPEC §6 — they are visible at any local-decl
  // in the same or enclosing scope.)
  const visited = new WeakSet<object>();
  walk(ast.nodes, fileScope, stats, visited);

  // PASS 1.c (B14): Register engine cells. Walks engine-decl nodes; for each,
  // computes the auto-declared variable name per §51.0.C, validates against
  // existing same-scope cells, and registers a StateCellRecord with
  // `_cellKind: "engine"` + `engineMeta`. Runs AFTER PASS 1 so non-engine
  // state-decls are already in the table — the duplicate-name check sees
  // them. Fires E-ENGINE-VAR-DUPLICATE on collision (§51.0.C, §34).
  const errors: SYMDiagnostic[] = [];
  const visitedB14 = new WeakSet<object>();
  walkRegisterEngines(ast.nodes, fileScope, errors, filePath, visitedB14);

  // PASS 2 (B2): Walk local-decl nodes (let/const/tilde/lin); look up each
  // by name in the current-scope parent chain; fire E-NAME-COLLIDES-STATE
  // if a state-cell record is found. Re-uses the `_scope` annotations PASS 1
  // attached to function-decls (so we can set the correct currentScope as
  // we descend without re-creating scopes).
  const visited2 = new WeakSet<object>();
  walkLocalDeclsForCollisions(ast.nodes, fileScope, visited2, errors);

  // PASS 2.b (B4): E-IMPORT-PINNED-INVALID best-effort fire. For every
  // pinned import-binding registered at file scope, look up the source
  // file's exportRegistry entry; if the export kind is definitively-not-
  // cell-not-engine (function/fn/type/channel), fire the diagnostic.
  // const/let imports are accepted with a documented B14 deferral. When
  // no exportRegistry is supplied (test-harness path), the check is
  // skipped silently.
  fireImportPinnedInvalid(fileScope, exportRegistry, errors, filePath);

  // PASS 3 (B3): Walk every ExprNode payload on every AST node; for each
  // `@`-prefixed IdentExpr, stamp `_resolvedStateCell` (record or null) via
  // a parent-chain lookup. Re-uses the `_scope` annotations PASS 1 attached
  // to function-decls + compound state-decls. No diagnostics fired here —
  // resolution failures stamp `null`; the existing-infra catch-all
  // (E-SCOPE-001 / DG sweep) handles any ultimate "unknown reactive" error
  // surface.
  // Initial readPos = 0 (file start). Top-level nodes will override via
  // their own span.start; nodes lacking spans inherit (defensively).
  const visited3 = new WeakSet<object>();
  walkResolveAtNames(ast.nodes, fileScope, visited3, errors, 0);

  // PASS 4 (B5): Classify each state-decl into a CellKind discriminant.
  // Stamps `_cellKind` and `_isBindable` non-enumerable properties on the
  // decl node. No diagnostics — B6 will fire render-by-tag errors based on
  // the annotation; B7 will filter derived-cell DAG inputs.
  const visited4 = new WeakSet<object>();
  walkClassifyCells(ast.nodes, visited4);

  // PASS 5 (B6): Walk every MarkupNode in the AST. For lowercase self-closed
  // tags resolving to a registered state cell, fire E-CELL-NO-RENDER-SPEC or
  // E-CELL-RENDER-SPEC-NOT-BINDABLE based on B5's `_cellKind` annotation +
  // `decl.isConst`. Phase 0 dispositions: compound-parent fires
  // E-CELL-NO-RENDER-SPEC (§3.1); PascalCase RHS deferred (§3.2).
  const visited5 = new WeakSet<object>();
  walkRenderByTagUses(ast.nodes, fileScope, visited5, errors);

  // PASS 8 (B11 + B12): Auto-synthesized validity surface — compound + per-
  // field. For every state-decl with `_cellKind === "compound-parent"` (B5
  // annotation), register four compound-level synth records into the
  // compound's `_scope` (B11: `isValid`, `errors`, `touched`, `submitted`)
  // and three per-field synth records into each compound CHILD's freshly-
  // attached `kind:"field"` scope (B12: `isValid`, `errors`, `touched` —
  // `submitted` is compound-level only per §55.7 line 24468). Synthesis is
  // unconditional per §55.5 + §55.6 predictability rule (audit §1.1). Runs
  // BEFORE PASS 6 so the E-SYNTHESIZED-WRITE dispatch can resolve synth
  // properties via the `findDeepestRegisteredOnPrefix` lookup (B12's
  // `lookupQualifiedStateCell` extension descends through any cell with a
  // `_scope`).
  dispatchWalkSynth(ast.nodes);

  // PASS 6 (B8 + B11 + B12 extension): L21 walker — fire E-DERIVED-VALUE-MUTATE
  // on in-place mutations of `const`-derived cells per SPEC §6.6.18. Three
  // forms covered: array mutating method calls, object property writes
  // (incl. compound assigns + delete), in-compound derived sub-cells.
  // **B11/B12 extension (audit §1.3):** the walker also fires
  // E-SYNTHESIZED-WRITE on writes to `@compound.{isValid,errors,touched,
  // submitted}` (compound scope) AND `@compound.field.{isValid,errors,
  // touched}` (per-field scope, B12). The discriminator is the receiver:
  // compound-parent → all 4 properties; compound-child → 3 properties
  // (excludes `submitted`).
  const visited6 = new WeakSet<object>();
  walkDerivedValueMutate(ast.nodes, fileScope, visited6, errors, filePath);

  // PASS 7 (B10 Phase 2): Validator type-check — for every state-decl with
  // `hasValidators: true`, look up each validator against the universal-core
  // catalog (`validator-catalog.ts`) and verify arity + per-arg shape per
  // SPEC §55.1 + §55.10. Fires E-TYPE-031 family on signature mismatch.
  // Cell-type compatibility check (e.g., `pattern(re)` on a `number` cell)
  // is DEFERRED per audit §1.3 — needs type-system inference. Cycle
  // detection (E-VALIDATOR-CIRCULAR-DEP) is Phase 3 and lives in
  // dependency-graph.ts.
  const visited7 = new WeakSet<object>();
  walkValidatorTypeCheck(ast.nodes, errors, filePath, visited7);

  // PASS 9 (B13): E-DERIVED-WITH-VALIDATORS rejection + Level-1 inline-
  // override extraction (per SPEC §55.14 + §55.10). For every state-decl
  // with non-empty validators:
  //   - If `isConst:true` (derived cell): fire E-DERIVED-WITH-VALIDATORS
  //     (one per cell, listing offending validators + recommending the
  //     refinement-type alternative per §55.14 line 24692).
  //   - Else (non-derived): for each validator, extract Level-1 inline
  //     override (trailing string-literal arg) onto `validator.inlineOverride`
  //     for A1c codegen consumption. Fire E-VALIDATOR-INLINE-DYNAMIC if the
  //     trailing override slot is populated by a non-string-literal
  //     expression (L12 Edge F static-string rule).
  // Engine auto-declared cells are NOT `isConst`; they pass through silently
  // per §55.14. Engine-derived (`<engine derived=>`) with validators is
  // REJECTED by §55.14 but requires engine-decl annotations not yet present
  // (B14 sequencing) — deferred.
  const visited9 = new WeakSet<object>();
  walkRejectDerivedWithValidatorsAndExtractOverride(
    ast.nodes, errors, filePath, visited9,
  );

  // PASS 10.B (B14): Cross-file engine mount validation per §51.0.D + §21.8.
  // Walks markup for self-closing tags whose name matches an import-binding;
  // for each, looks up the source export's category in MOD's exportRegistry.
  // Engine-category exports → legitimate cross-file mount (no record reg).
  // Non-engine, non-component exports → fire E-ENGINE-MOUNT-NOT-ENGINE.
  // Skipped silently when exportRegistry is unavailable (test-harness path).
  const visitedB14B = new WeakSet<object>();
  walkValidateCrossFileEngineMounts(
    ast.nodes, fileScope, exportRegistry, errors, filePath, visitedB14B,
  );

  // PASS 11 (B15): Engine state-child exhaustiveness + rule= typer +
  // initial= validation. For every engine-decl carrying a `_record`
  // (set by PASS 10.A), populates `engineMeta.variants` from the file's
  // typeDecls, parses state-children out of `rulesRaw`, and validates:
  //   - initial= (W-ENGINE-INITIAL-MISSING / E-ENGINE-INITIAL-INVALID-VARIANT)
  //   - state-child exhaustiveness (E-ENGINE-STATE-CHILD-MISSING /
  //     E-ENGINE-STATE-CHILD-INVALID-VARIANT)
  //   - rule= forms per §51.0.F three target-only forms
  //     (E-ENGINE-RULE-INVALID-VARIANT / E-ENGINE-RULE-LEGACY-SYNTAX)
  //
  // Compile-time E-ENGINE-INVALID-TRANSITION for direct writes inside
  // state-child bodies is DEFERRED — bodies are raw text today (parser
  // limitation per primer §13.7 B14 specifics). Once bodies become
  // walkable AST nodes, the same PASS 11 walker dispatches on the
  // `_resolvedStateCell` annotation.
  const visitedB15 = new WeakSet<object>();
  walkValidateEngineStateChildrenAndRules(
    ast.nodes, ast, errors, filePath, visitedB15,
  );

  // PASS 12 (B16): Derived-engine rejection rules — fires
  // E-DERIVED-ENGINE-NO-INITIAL, E-DERIVED-ENGINE-NO-RULES,
  // E-DERIVED-ENGINE-NO-WRITE per SPEC §51.0.J + §34. Reads engine
  // metadata stamped by PASS 10.A (`_record.engineMeta.derivedExpr`).
  // Two sub-walks:
  //   - decl-side (NO-INITIAL + NO-RULES): visits engine-decl nodes.
  //   - write-side (NO-WRITE): visits bare-expr nodes for direct-write or
  //     `.advance(.X)` shapes targeting a derived-engine cell.
  // E-DERIVED-ENGINE-CIRCULAR is fired by Stage 7 (DG) — see
  // `dependency-graph.ts:buildEngineDerivedAdj` for the second consumer
  // of B7's reusability promise.
  const visitedB16A = new WeakSet<object>();
  walkDerivedEngineDeclRejections(ast.nodes, errors, filePath, visitedB16A);
  const visitedB16B = new WeakSet<object>();
  walkDerivedEngineWriteRejections(
    ast.nodes, fileScope, errors, filePath, visitedB16B,
  );

  // PASS 12.B (v0.3 Option-d) — W-ENGINE-SELF-WRITE-DETECTED outside-state-child.
  // Walks bare-expr / state-decl / function-decl bodies for `@<engineVar> = .X`
  // and `@<engineVar>.advance(.X)` writes where `.X` is a literal variant of
  // a NON-DERIVED engine cell. Fires info-level lint per SPEC §51.0.F (v0.3
  // Option-d synthesis) — current variant is dynamic; if it equals `.X` at
  // runtime, the write is a no-op. Inside-state-child writes are owned by
  // fire-site #10 in PASS 16 (validateEngineA5Extensions); the walker SKIPS
  // engine-decl.bodyChildren descent. Ordering: AFTER PASS 12 (B16) so derived-
  // engine NO-WRITE rejection fires first; the lookup helper here returns null
  // for derived-engine cells so no double-fire on derived writes.
  const visitedSelfWriteOutside = new WeakSet<object>();
  walkEngineSelfWriteOutside(
    ast.nodes, fileScope, errors, filePath, visitedSelfWriteOutside,
  );

  // PASS 13 (B17): components-vs-engines residual fire-site (§51.0.K, M20).
  // Walks the AST tree; for every `component-def` with `defChildren`, fires
  // E-COMPONENT-ENGINE-SCOPE on each `engine-decl` found. The defChildren
  // array contains sibling AST nodes consumed after the component-def in
  // the same logic-body parent — they are conceptually part of the
  // component's scope, so engines authored there violate the singleton
  // invariant. The B14-deferred fire-site for engine-decls inside the
  // markup `raw` body of the component remains deferred (component-body
  // markup parser not yet implemented; see Phase 0 SURVEY).
  // Renumbered from B17's PASS 11 → PASS 13 during S68 file-delta merge
  // (B15 took PASS 11; B16 took PASS 12).
  const visitedB17 = new WeakSet<object>();
  walkRejectEnginesInComponentDefChildren(ast.nodes, errors, filePath, visitedB17);

  // PASS 14 (B22): `reset(@cell)` target-shape validation per SPEC §6.8.2 +
  // §34. Fires E-RESET-INVALID-TARGET when a `reset-expr` target is not one
  // of the three canonical shapes (`@cell` / `@compound` / `@compound.field`,
  // including multi-level paths per Phase 0 decision). Skips nodes that
  // already carry a parse-time `diagnostic` (E-RESET-NO-ARG path) so we
  // don't double-report. Reads B3's `_resolvedStateCell` for IdentExpr
  // targets and re-resolves MemberExpr chains via `lookupQualifiedStateCell`
  // (B12-extended descent through any cell with a `_scope`). Closes A1a
  // Step 9's deferred validation (per ast.ts:1670-1674 docstring).
  const visitedB22 = new WeakSet<object>();
  walkValidateResetTargets(ast.nodes, fileScope, visitedB22, errors, filePath);

  // PASS 15 (B19): Channel placement + `@shared` modifier rejection.
  // Two sub-walks per SPEC §38.1, §38.4, §34:
  //   - walkChannelPlacement: fires E-CHANNEL-OUTSIDE-PROGRAM on any
  //     `<channel>` markup node at programDepth === 0 when the file
  //     contains a `<program>` element somewhere (v0.3 direction:
  //     channels live INSIDE `<program>` when one exists). Per S87
  //     Insight 30 dispensation, file-top `<channel>` in a module file
  //     with no `<program>` (PURE-CHANNEL-FILE shape, §38.12.6) is
  //     canonical and silent — engine-parity per §21.8 / B14. v0.3
  //     reversal Wave 1; see pre-v0.3 `E-CHANNEL-INSIDE-PROGRAM` for the
  //     prior direction.
  //   - walkSharedModifier: fires E-CHANNEL-SHARED-MODIFIER on any
  //     `state-decl` carrying `isShared: true` (TAB stamps this on
  //     `@shared <name> = init` source — the legacy v1 modifier).
  // Both walks are independent of B14-B17/B22 metadata; only consume the
  // canonical AST shape (markup tag/children + state-decl.isShared).
  // Renumbered from B19's PASS 14 → PASS 15 during S69 file-delta merge
  // (B22 took PASS 14 in the parallel small-bundle dispatch).
  walkValidateChannels(ast, errors, filePath);

  // PASS 16 (A5-3): A7 hierarchy + temporal extensions per §51.0.M-Q.
  // For every engine-decl carrying a `_record` (set by PASS 10.A) AND
  // `engineMeta.stateChildren` (populated by PASS 11 / B15), iterate
  // state-children to fire:
  //   - E-HISTORY-NO-INNER-ENGINE on history-on-non-composite (§51.0.N).
  //   - E-INTERNAL-RULE-NOT-COMPOSITE on internal:rule on non-composite (§51.0.O).
  //   - E-ENGINE-INVALID-TRANSITION on `<onTimeout to=.X/>` not permitted
  //     by surrounding `rule=` (§51.0.M + §51.0.F). FIRST compile-time
  //     E-ENGINE-INVALID-TRANSITION fire-site (per Phase 0 SURVEY §1.3).
  //   - E-ENGINE-RULE-INVALID-VARIANT on `<onTimeout to=.X/>` and on
  //     `internal:rule=` targets not in `engineMeta.variants`.
  //
  // Plus EngineMetadata file-scope aggregation: `historyAttr` (OR-reduce),
  // `internalRules` (concat with stateChildTag), `onTimeoutElements`
  // (concat with stateChildTag) — annotated records per Phase 0 SURVEY §4.
  //
  // Ordering: runs AFTER PASS 11 (B15) because A5-3 reads
  // `engineMeta.variants` (populated by B15) and `engineMeta.stateChildren`
  // (populated by B15). PASS 12 (B16) / PASS 13 (B17) / PASS 14 (B22) /
  // PASS 15 (B19) are engine-orthogonal — order with PASS 16 doesn't
  // matter beyond the B15 prerequisite.
  //
  // Out of scope (DEFERRED on infrastructure preconditions, per Phase 0
  // SURVEY §10 SCOPE CORRECTIONS):
  //   - E-STRUCTURAL-ELEMENT-MISPLACED for `<onTimeout>` outside engine
  //     state-child / inside `<match>` block-form arm — gated on a
  //     markup walker (same precondition that defers `<onTransition>`
  //     placement enforcement).
  //   - Inner-engine structural recursion — DEFERRED to A1c per SURVEY
  //     §3.3.
  //
  // Closed (S83 follow-on dispatch, 2026-05-11):
  //   - Cascade-miss diagnostic (§51.0.Q.3 OQ-Harel-6) — SECOND compile-time
  //     E-ENGINE-INVALID-TRANSITION fire-site added inside
  //     `validateEngineA5Extensions` (fire-site #9). Approach A (regex over
  //     bodyRaw) catches `@varName = .Variant` and `@varName.advance(.Variant)`
  //     direct-write forms. Composite-aware framing per §51.0.Q.3 when the
  //     surrounding state-child is composite (`innerEngines.length > 0`).
  const visitedA53 = new WeakSet<object>();
  walkValidateEngineA5Extensions(ast.nodes, ast, errors, filePath, visitedA53);

  // PASS 17 (B17.3): `<onTransition>` + `effect=` typer diagnostics per
  // §51.0.H + §51.0.F. For every engine-decl carrying a `_record` AND
  // `engineMeta.stateChildren` (populated by PASS 11 / B15 + B17.2 parser
  // annotations on each state-child), iterate state-children to fire:
  //   - E-ENGINE-EFFECT-AMBIGUOUS on `effect=` + multi-target `rule=`.
  //   - E-ENGINE-RULE-INVALID-VARIANT on `<onTransition to=.X>` /
  //     `<onTransition from=.X>` not in `engineMeta.variants`.
  //   - E-ENGINE-INVALID-TRANSITION on `<onTransition to=.X>` not permitted
  //     by surrounding `rule=` (compile-time, mirrors A5-3 fire-site #3).
  //   - E-ONTRANSITION-NO-TARGET on `<onTransition>` with neither `to=` nor
  //     `from=` (NEW §34 row added at S74).
  //
  // Ordering: runs AFTER PASS 11 (B15) and AFTER PASS 16 (A5-3) — both
  // populate state-child annotations PASS 17 reads. PASS 12 / 13 / 14 / 15
  // are engine-orthogonal — order is irrelevant.
  //
  // Out of scope: `if=expr` type-checking (engine bodies are RAW TEXT today);
  // structural-placement check (`<onTransition>` outside engine state-child)
  // gated on the same markup-walker precondition that defers A5-3 fire-sites
  // #5/#6; cross-state-child `from=` consistency check (codegen territory).
  const visitedB173 = new WeakSet<object>();
  walkValidateEngineB17Diagnostics(ast.nodes, ast, errors, filePath, visitedB173);

  // PASS 18 (A6-3): `test-bind` typer support per SPEC §19.12.6 / §19.12.7.
  // For every `~{}` test-block AST node, walk `testGroup.testBinds[]` and:
  //   - Resolve LHS against same-file `function-decl` / file-scope import
  //     bindings; fire E-TEST-005 on miss or non-server local resolution.
  //   - Discriminate RHS shape (function-literal pattern OR identifier-bound
  //     to function → handler; otherwise → return-stub) and stamp
  //     `bindKind` on the TestBindDecl AST node.
  //
  // Cross-file imported server-fn LHS resolution is DEFERRED — the
  // export-registry shape lacks an `isServer` discriminator at this revision
  // (see SURVEY §2.3). Strict structural-signature assignability is also
  // deferred — the type-system's FunctionType is opaque (see SURVEY §2.4).
  //
  // Ordering: runs LAST. Engine-orthogonal — order doesn't matter relative to
  // PASSes 10–17 beyond the prerequisite that `test-bind` parsing (A6-2) ran
  // in TAB before `runSYM` (always true).
  const fnDecls = new Map<string, any>();
  const visitedFnCollect = new WeakSet<object>();
  collectSameFileFunctionDecls(ast.nodes, fnDecls, visitedFnCollect);
  const visitedA63 = new WeakSet<object>();
  walkAnnotateTestBindKinds(ast.nodes, fnDecls, fileScope, errors, filePath, visitedA63);

  // PASS 19 (A4 — S105): E-STATE-PINNED-FORWARD-REF on calls to `pinned fn`
  // declared LATER in source order. Closes the S105 `dc3c460` parser-
  // recognition's semantic-enforcement half per SPEC §48.6.4. Mirrors B4
  // cell + import pinned-forward-ref check pattern (lines 1494-1551). Walks
  // every ExprNode payload looking for CallExpr nodes whose bare-ident
  // callee matches a same-file `pinned fn` declaration; fires when the
  // call's enclosing AST-node readPos precedes the decl-span end. Returns
  // early when no `pinned fn` declarations exist in the file (the common
  // case — zero-cost on adopter code without pinned-fn use).
  const pinnedFnDecls = new Map<string, FunctionDeclNode>();
  const visitedPinnedCollect = new WeakSet<object>();
  collectPinnedFunctionDecls(ast.nodes, pinnedFnDecls, visitedPinnedCollect);
  if (pinnedFnDecls.size > 0) {
    const visitedPass19 = new WeakSet<object>();
    walkPinnedFnForwardRefCheck(ast.nodes, pinnedFnDecls, visitedPass19, errors, 0, filePath);
  }

  // PASS 20 (S107 Phase 2): match-block diagnostics per SPEC §18.0.1 + §18.0.2.
  //
  // For every `kind: "match-block"` AST node in the file:
  //   - Parse armsRaw → MatchArmEntry[] via match-statechild-parser.
  //   - Resolve forType to its enum variants (file-scope type-decl lookup +
  //     extractEnumVariants on the raw text).
  //   - Check for in-scope `<engine for=Type>` declaration (for auto-implied
  //     `on=` resolution).
  //   - Fire 5 diagnostics:
  //       * W-MATCH-RULE-INERT — `rule=` attr on any arm (per §18.0.2)
  //       * E-MATCH-EFFECT-FORBIDDEN — `effect=` attr on any arm (per §18.0.2)
  //       * E-MATCH-ONTRANSITION-FORBIDDEN — `<onTransition>` in any arm body
  //       * E-MATCH-NOT-EXHAUSTIVE — variants missing AND no `<_>` wildcard
  //       * E-MATCH-ON-REQUIRED — onExprRaw === null AND no in-scope engine
  //
  // Ordering: engine-orthogonal; runs last alongside PASS 18/19. Engine state-
  // child machinery (B15-B17, A5-3 PASSes 11-17) is untouched.
  const visitedPass20 = new WeakSet<object>();
  walkValidateMatchBlocks(ast, ast.nodes, errors, filePath, visitedPass20);

  return {
    filePath,
    errors,
    fileScope,
    stats,
  };
}

// ---------------------------------------------------------------------------
// PASS 20 (S107 Phase 2) — match-block diagnostics (SPEC §18.0.1 + §18.0.2)
// ---------------------------------------------------------------------------
//
// Spec authority:
//   §18.0.1 line 9561+  — Block-form syntax + exhaustiveness (E-MATCH-NOT-EXHAUSTIVE)
//   §18.0.2 line 9618+  — Attribute legality (W-MATCH-RULE-INERT, E-MATCH-EFFECT-FORBIDDEN, E-MATCH-ONTRANSITION-FORBIDDEN)
//   §18.0.1 line 9615+  — auto-implied `on=` requires in-scope engine (E-MATCH-ON-REQUIRED, new §34 row per Q-MB-5)
//   §34 lines 14807-14810 — catalog rows for the 4 pre-existing diagnostics
//
// Q-MB-5 ratification: NEW §34 row `E-MATCH-ON-REQUIRED` lands in Phase 2 spec
// amendment (separate edit to compiler/SPEC.md after this code lands).

function walkValidateMatchBlocks(
  ast: any,
  nodes: any,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
): void {
  // Build a file-scope type-registry (typeName → variant-name array) by
  // walking all type-decl nodes in the file. Mirrors how B15 resolves
  // engine for=Type by walking type-decls. Phase 4 may replace this with
  // proper type-system integration (the §14.10 bare-variant infrastructure).
  const enumRegistry: Map<string, string[]> = new Map();
  collectEnumTypes(nodes, enumRegistry, new WeakSet<object>());

  // Build a set of in-scope engine governedTypes for E-MATCH-ON-REQUIRED
  // resolution (auto-implied on= requires `<engine for=Type>` in scope).
  const engineGovernedTypes: Set<string> = new Set();
  collectEngineGovernedTypes(nodes, engineGovernedTypes, new WeakSet<object>());

  // Walk the AST tree, visiting every match-block node.
  walkMatchBlockNodes(nodes, errors, filePath, visited, enumRegistry, engineGovernedTypes);
}

function collectEnumTypes(
  nodes: any,
  registry: Map<string, string[]>,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) collectEnumTypes(n, registry, visited);
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  if (node.kind === "type-decl" && node.typeKind === "enum" && typeof node.name === "string" && typeof node.raw === "string") {
    const variants = extractEnumVariants(node.raw);
    if (variants.length > 0) {
      registry.set(node.name, variants);
    }
  }

  // Recurse through standard child arrays.
  for (const key of ["body", "children", "defChildren", "consequent", "alternate"]) {
    if (Array.isArray(node[key])) collectEnumTypes(node[key], registry, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) collectEnumTypes(arm.body, registry, visited);
    }
  }
}

function collectEngineGovernedTypes(
  nodes: any,
  governedTypes: Set<string>,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) collectEngineGovernedTypes(n, governedTypes, visited);
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  if (node.kind === "engine-decl" && typeof node.governedType === "string" && node.governedType.length > 0) {
    governedTypes.add(node.governedType);
  }

  for (const key of ["body", "children", "defChildren", "consequent", "alternate"]) {
    if (Array.isArray(node[key])) collectEngineGovernedTypes(node[key], governedTypes, visited);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) collectEngineGovernedTypes(arm.body, governedTypes, visited);
    }
  }
}

function walkMatchBlockNodes(
  nodes: any,
  errors: SYMDiagnostic[],
  filePath: string,
  visited: WeakSet<object>,
  enumRegistry: Map<string, string[]>,
  engineGovernedTypes: Set<string>,
): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    for (const n of nodes) walkMatchBlockNodes(n, errors, filePath, visited, enumRegistry, engineGovernedTypes);
    return;
  }
  if (typeof nodes !== "object") return;
  if (visited.has(nodes)) return;
  visited.add(nodes);

  const node = nodes as any;
  if (node.kind === "match-block") {
    validateMatchBlock(node, errors, filePath, enumRegistry, engineGovernedTypes);
  }

  for (const key of ["body", "children", "defChildren", "consequent", "alternate"]) {
    if (Array.isArray(node[key])) walkMatchBlockNodes(node[key], errors, filePath, visited, enumRegistry, engineGovernedTypes);
  }
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (arm && Array.isArray(arm.body)) walkMatchBlockNodes(arm.body, errors, filePath, visited, enumRegistry, engineGovernedTypes);
    }
  }
}

function validateMatchBlock(
  matchBlock: any,
  errors: SYMDiagnostic[],
  filePath: string,
  enumRegistry: Map<string, string[]>,
  engineGovernedTypes: Set<string>,
): void {
  const blockSpan: SYMDiagnostic["span"] = matchBlock.span ?? {
    file: filePath, start: 0, end: 0, line: 1, col: 1,
  };
  const forType: string = matchBlock.forType ?? "";
  const onExprRaw: string | null = matchBlock.onExprRaw ?? null;
  const armsRaw: string = matchBlock.armsRaw ?? "";

  // E-MATCH-ON-REQUIRED — auto-implied `on=` only legal when an
  // `<engine for=Type>` is in scope (per SPEC §18.0.1 line 9578-9580).
  if (onExprRaw === null && !engineGovernedTypes.has(forType)) {
    errors.push({
      code: "E-MATCH-ON-REQUIRED",
      message:
        `E-MATCH-ON-REQUIRED: \`<match for=${forType || "?"}>\` is missing required \`on=\` ` +
        `attribute and no \`<engine for=${forType || "?"}>\` is in scope (auto-implied resolution ` +
        `requires a same-type engine). Add \`on=expr\` to the \`<match>\` opener or declare a ` +
        `compatible engine in scope. (SPEC §18.0.1 + §34.)`,
      span: blockSpan,
      severity: "error",
    });
  }

  // Parse the arms.
  const parseResult = parseMatchArms(armsRaw);
  for (const d of parseResult.diagnostics) {
    errors.push({
      code: d.code,
      message: d.message,
      span: shiftSpan(blockSpan, matchBlock.span, d.spanStart, d.spanEnd),
      severity: "error",
    });
  }
  const arms: MatchArmEntry[] = parseResult.arms;

  // E-MATCH-NOT-EXHAUSTIVE — every variant of for=Type must have a matching
  // arm OR a `<_>` wildcard arm must be present (SPEC §18.0.1 line 9593-9594).
  const hasWildcard = arms.some((a) => a.isWildcard);
  if (!hasWildcard && forType) {
    const expectedVariants = enumRegistry.get(forType);
    if (expectedVariants) {
      const armVariantSet = new Set(arms.filter((a) => !a.isWildcard).map((a) => a.variantName));
      const missingVariants = expectedVariants.filter((v) => !armVariantSet.has(v));
      if (missingVariants.length > 0) {
        errors.push({
          code: "E-MATCH-NOT-EXHAUSTIVE",
          message:
            `E-MATCH-NOT-EXHAUSTIVE: \`<match for=${forType}>\` is missing arm(s) for variant(s): ` +
            `${missingVariants.map((v) => `.${v}`).join(", ")}. Add the missing arm(s) or include ` +
            `a wildcard \`<_>...</_>\` catch-all. (SPEC §18.0.1 + §34.)`,
          span: blockSpan,
          severity: "error",
        });
      }
    }
    // If enum type isn't in registry, we can't check exhaustiveness; skip
    // silently. Phase 4 may add E-MATCH-FOR-TYPE-UNKNOWN if useful.
  }

  // Per-arm validation.
  for (const arm of arms) {
    for (const attr of arm.attrs) {
      // W-MATCH-RULE-INERT — `rule=` on any arm (SPEC §18.0.2 line 9625).
      if (attr.name === "rule") {
        errors.push({
          code: "W-MATCH-RULE-INERT",
          message:
            `W-MATCH-RULE-INERT: \`rule=\` declared on \`<${arm.variantName}>\` inside a ` +
            `\`<match>\` block. Rules are legal-but-inert in match-blocks — match is read-only ` +
            `on the matched-on value, so the rule doesn't enforce. Promote to ` +
            `\`<engine for=${forType || "Type"} initial=.Variant>\` (Tier 2) to activate the rule ` +
            `contract and get \`E-ENGINE-INVALID-TRANSITION\` on violating writes. ` +
            `(SPEC §18.0.2 + §34.)`,
          span: shiftSpan(blockSpan, matchBlock.span, attr.spanStart, attr.spanEnd),
          severity: "warning",
        });
      }
      // E-MATCH-EFFECT-FORBIDDEN — `effect=` on any arm (SPEC §18.0.2 line 9626).
      if (attr.name === "effect") {
        errors.push({
          code: "E-MATCH-EFFECT-FORBIDDEN",
          message:
            `E-MATCH-EFFECT-FORBIDDEN: \`effect=\` declared on \`<${arm.variantName}>\` inside a ` +
            `\`<match>\` block. Effects presuppose transitions; transitions don't occur in match. ` +
            `Use \`<engine for=${forType || "Type"} initial=.Variant>\` (Tier 2) to use \`effect=\` ` +
            `or \`<onTransition>\`. (SPEC §18.0.2 + §34.)`,
          span: shiftSpan(blockSpan, matchBlock.span, attr.spanStart, attr.spanEnd),
          severity: "error",
        });
      }
    }

    // E-MATCH-ONTRANSITION-FORBIDDEN — `<onTransition>` element in any arm
    // body (SPEC §18.0.2 line 9627). Body-text scan for the opener token.
    // Phase 4 may upgrade to a structural body-AST walk once arm bodies are
    // re-parsed into proper sub-trees.
    if (arm.bodyForm === "bare-body" && /<\s*onTransition\b/i.test(arm.bodyRaw)) {
      errors.push({
        code: "E-MATCH-ONTRANSITION-FORBIDDEN",
        message:
          `E-MATCH-ONTRANSITION-FORBIDDEN: \`<onTransition>\` element appears inside a ` +
          `\`<match>\` arm body (\`<${arm.variantName}>\` arm). \`<onTransition>\` is engine-only ` +
          `— transitions don't occur in match. Use \`<engine for=${forType || "Type"} ` +
          `initial=.Variant>\` (Tier 2) for transition handlers. (SPEC §18.0.2 + §34.)`,
        span: shiftSpan(blockSpan, matchBlock.span, arm.spanStart, arm.spanEnd),
        severity: "error",
      });
    }
  }
}

/**
 * Convert a parser-local span (offsets within `armsRaw`) into a SYMDiagnostic
 * span by adding the match-block's absolute start position. Falls back to the
 * match-block's span when match-block.span is unavailable.
 *
 * Note: line/col here are approximate (carried from the match-block's opener);
 * arm-local line/col adjustment would require re-scanning newlines in armsRaw.
 * Phase 4 may add precise per-arm line/col when the arm-parser tracks it.
 */
function shiftSpan(
  fallback: SYMDiagnostic["span"],
  matchBlockSpan: any,
  localStart: number,
  localEnd: number,
): SYMDiagnostic["span"] {
  if (!matchBlockSpan || typeof matchBlockSpan !== "object") return fallback;
  const baseStart = typeof matchBlockSpan.start === "number" ? matchBlockSpan.start : 0;
  return {
    file: (matchBlockSpan as any).file ?? (fallback as any).file,
    start: baseStart + localStart,
    end: baseStart + localEnd,
    line: (matchBlockSpan as any).line ?? (fallback as any).line ?? 1,
    col: (matchBlockSpan as any).col ?? (fallback as any).col ?? 1,
  } as any;
}

/**
 * Run SYM over a batch of TAB results (mirrors `runNRBatch` shape).
 * Each AST is mutated in place. Returns per-file results in input order.
 *
 * B4: optional `exportRegistry` (from MOD) enables `E-IMPORT-PINNED-INVALID`
 * firing. When omitted (test-harness path), the registry check is skipped.
 */
export function runSYMBatch(
  tabResults: Array<{ filePath: string; ast: FileAST }>,
  exportRegistry?: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>>,
): SYMResult[] {
  const out: SYMResult[] = [];
  for (const r of tabResults) {
    if (!r || !r.ast) continue;
    out.push(runSYM({ filePath: r.filePath, ast: r.ast, exportRegistry }));
  }
  return out;
}

/**
 * Look up a state-cell by leaf name, walking the scope's parent chain.
 * Returns the closest enclosing record, or `null` if not found.
 *
 * V5-strict semantic: B2 uses this lookup for the E-NAME-COLLIDES-STATE
 * check (a local `let`/`const`/`tilde`/`lin` redeclaring a name registered
 * in this scope or any enclosing parent fires the error). B3 will use it
 * for `@name` resolution.
 */
export function lookupStateCell(
  scope: Scope | null | undefined,
  name: string,
): StateCellRecord | null {
  let s: Scope | null | undefined = scope;
  while (s) {
    const rec = s.stateCells.get(name);
    if (rec) return rec;
    s = s.parent;
  }
  return null;
}

/**
 * Look up a multi-segment qualified state-cell path.  Used for
 * `@signup.name` / `@outer.inner.leaf` resolution.
 *
 * Algorithm: resolve the FIRST segment via the parent-chain walk
 * (`lookupStateCell`); then for each subsequent segment, resolve into the
 * current record's compound sub-scope (the `_scope` annotation on the
 * compound parent's decl node).
 *
 * Returns the LEAF record on success, `null` if any segment fails.
 *
 * Edge cases:
 *   - Empty path → `null`.
 *   - Single-segment path → equivalent to `lookupStateCell`.
 *   - Intermediate segment isn't a compound parent → `null` (cannot descend).
 */
export function lookupQualifiedStateCell(
  scope: Scope | null | undefined,
  path: string[],
): StateCellRecord | null {
  if (!Array.isArray(path) || path.length === 0) return null;
  let current = lookupStateCell(scope, path[0]);
  if (!current) return null;
  for (let i = 1; i < path.length; i++) {
    // Descend through ANY cell that has a `_scope` attached. B11 attaches
    // `kind:"compound"` scopes on compound parents; B12 attaches
    // `kind:"field"` scopes on compound children for the per-field synth
    // surface. The lookup is uniform — whichever scope holds the next
    // segment wins. Cells without `_scope` (regular non-compound,
    // non-compound-child top-level cells) cannot be descended.
    const subScope = (current.declNode as ReactiveDeclNode & ScopeAnnotated)._scope;
    if (!subScope) return null;
    const next = subScope.stateCells.get(path[i]);
    if (!next) return null;
    current = next;
  }
  return current;
}

/**
 * B4 — Look up an import binding by local name. Walks the parent chain (so a
 * future per-function or per-component import-binding scope is forward-
 * compatible); today's importBindings live only on the file-level root.
 *
 * Returns the closest enclosing record, or `null` if not found.
 */
export function lookupImportBinding(
  scope: Scope | null | undefined,
  localName: string,
): ImportBindingRecord | null {
  let s: Scope | null | undefined = scope;
  while (s) {
    const rec = s.importBindings.get(localName);
    if (rec) return rec;
    s = s.parent;
  }
  return null;
}

/**
 * Reverse lookup: given an AST node, return the scope it lives in (the
 * scope created AT this node for scope-introducing nodes; otherwise the
 * scope of its declared/registered state-cell).
 *
 * Returns:
 *   - For a scope-introducing node (`function-decl`, FileAST, compound
 *     `state-decl`): the scope that node OPENS (its body's scope).
 *   - For a state-decl that is NOT a compound parent: the scope it's
 *     REGISTERED in (i.e., `_record.scope`).
 *   - For all other nodes: `null` (B1 does not annotate non-scope, non-decl
 *     nodes; future B-steps may extend this).
 */
export function getScopeForNode(node: ASTNode | FileAST | null | undefined): Scope | null {
  if (!node) return null;
  const annotated = node as (ASTNode | FileAST) & ScopeAnnotated & RecordAnnotated;
  if (annotated._scope) return annotated._scope;
  if (annotated._record) return annotated._record.scope;
  return null;
}

/**
 * B3 read API — return the resolved `StateCellRecord` stamped onto an
 * IdentExpr by PASS 3.
 *
 * Return shape:
 *   - `StateCellRecord` — `@name` was `@`-prefixed and resolved to a
 *     registered cell.
 *   - `null` — `@name` was `@`-prefixed but no cell with that name was
 *     registered in any enclosing scope (the resolution-fail case;
 *     B3 stamps null, no error).
 *   - `undefined` — the IdentExpr was either (a) not `@`-prefixed (so PASS 3
 *     correctly skipped it) or (b) the IdentExpr lives in an ExprNode
 *     position PASS 3's walker didn't traverse. Consumers should treat
 *     `undefined` as "not annotated" and fall back to their own resolution
 *     if needed.
 */
export function getResolvedStateCell(
  ident: IdentExpr | null | undefined,
): StateCellRecord | null | undefined {
  if (!ident) return undefined;
  const annotated = ident as IdentExpr & ResolvedAtNameAnnotated;
  return annotated._resolvedStateCell;
}

/**
 * B5 read API — return the `CellKind` stamped onto a state-decl node by
 * PASS 4.
 *
 * Return shape:
 *   - `CellKind` — one of `"plain" | "bindable" | "markup-typed" | "compound-parent"`.
 *   - `undefined` — the node was either not a state-decl, not walked by SYM
 *     (e.g., raw test-helper construction), or `null`. Consumers should treat
 *     `undefined` as "not classified" and either treat as plain (B6 fires
 *     `E-CELL-NO-RENDER-SPEC` on plain) or fall back to a fresh classifier
 *     call.
 */
export function getCellKind(
  decl: ReactiveDeclNode | null | undefined,
): CellKind | undefined {
  if (!decl) return undefined;
  const annotated = decl as ReactiveDeclNode & CellKindAnnotated;
  return annotated._cellKind;
}

/**
 * B5 read API — return the `_isBindable` boolean stamped onto a state-decl
 * node by PASS 4. Equivalent to `getCellKind(decl) === "bindable"` but
 * convenient for B6's hot-path render-by-tag check.
 *
 * Returns `undefined` when the node was not classified (treat as `false`).
 */
export function isCellBindable(
  decl: ReactiveDeclNode | null | undefined,
): boolean | undefined {
  if (!decl) return undefined;
  const annotated = decl as ReactiveDeclNode & CellKindAnnotated;
  return annotated._isBindable;
}

/**
 * B11 read API — return `true` iff the record is a synthesized validity-
 * surface cell registered by PASS 8. Mirrors `getCellKind` style.
 *
 * Returns `false` for plain (non-synth) state-cell records or for `null` /
 * `undefined` input (defensive — synth-discrimination on a missing record is
 * always "no").
 */
export function isSynthesizedCell(
  record: StateCellRecord | null | undefined,
): boolean {
  return !!record && record.isSynthesized === true;
}

/**
 * B11 read API — return the array of synthesized validity-surface records
 * registered for a given compound parent. Returns `[]` for non-compound
 * cells, for compounds whose surface was not synthesized (e.g., dev-declared
 * children shadowed all four names — not a normal case), or for `null` input.
 *
 * The returned array preserves declaration order (per `COMPOUND_SYNTH_PROPERTIES`):
 * `[isValid, errors, touched, submitted]`.
 */
export function getSynthRecords(
  compoundDecl: ReactiveDeclNode | null | undefined,
): StateCellRecord[] {
  if (!compoundDecl) return [];
  const annotated = compoundDecl as ReactiveDeclNode & ScopeAnnotated;
  const compoundScope = annotated._scope;
  if (!compoundScope) return [];
  const out: StateCellRecord[] = [];
  for (const property of COMPOUND_SYNTH_PROPERTIES) {
    const rec = compoundScope.stateCells.get(property);
    if (rec && rec.isSynthesized) out.push(rec);
  }
  return out;
}

/**
 * B12 read API — return the array of PER-FIELD synthesized validity-surface
 * records registered for a given compound CHILD field decl. Returns `[]` for
 * non-field cells (top-level decls with no parent compound), for compound
 * parents (whose synth lives at the compound level — use `getSynthRecords`
 * instead), or for `null` input.
 *
 * The returned array preserves declaration order (per
 * `PER_FIELD_SYNTH_PROPERTIES`): `[isValid, errors, touched]`. Per §55.6 +
 * §55.7 line 24468 — `submitted` is COMPOUND-LEVEL ONLY and is never
 * registered at per-field scope.
 *
 * Compound-typed children (e.g., `<form><address>...</></>` — `address` is
 * a child of `form` AND a compound parent) do NOT get duplicate per-field
 * records — `getPerFieldSynthRecords(addressDecl)` returns `[]`. The
 * compound-level synth on `address`'s compound-scope is the canonical
 * surface for that field path; consumers should use `getSynthRecords` on
 * the same decl for that case (the function correctly handles the
 * compound-typed case because B12 deliberately skips per-field
 * registration on compound-typed children — see `registerPerFieldSynthSurface`).
 */
export function getPerFieldSynthRecords(
  fieldDecl: ReactiveDeclNode | null | undefined,
): StateCellRecord[] {
  if (!fieldDecl) return [];
  const annotated = fieldDecl as ReactiveDeclNode & ScopeAnnotated;
  const fieldScope = annotated._scope;
  if (!fieldScope) return [];
  // Only `kind:"field"` scopes hold per-field synth records. Compound
  // parents have `kind:"compound"` scopes (those go through `getSynthRecords`).
  if (fieldScope.kind !== "field") return [];
  const out: StateCellRecord[] = [];
  for (const property of PER_FIELD_SYNTH_PROPERTIES) {
    const rec = fieldScope.stateCells.get(property);
    if (rec && rec.isSynthesized) out.push(rec);
  }
  return out;
}
