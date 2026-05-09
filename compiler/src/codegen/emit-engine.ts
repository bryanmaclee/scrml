/* SPDX-License-Identifier: MIT
 * Phase A1c Step C12 — Engine state-machine runtime substrate emission.
 *
 * Per SPEC §51.0.A through §51.0.G. Wave 4 foundational step — C13 layers
 * `.advance()` + `<onTransition>` on top; C14 layers `derived=expr`; C15
 * layers cross-file engine import + same-file singleton mount.
 *
 * **Distinct from `emit-machines.ts`:** the legacy file emits substrate for
 * the legacy `<machine>`-keyword + `transitions {}` block + arrow-rule
 * (`.From => .To`) form, driven by the type-system's `machineRegistry`. This
 * file emits substrate for the new `<engine>` keyword + state-children with
 * `rule=` attribute form, driven by B14/B15 PASS 10.A/PASS 11
 * `_record.engineMeta.stateChildren[]` annotations. Both surfaces are
 * preserved during the v0.next P1 deprecation window (§51.0.L).
 *
 * **What this file emits, per engine-decl with `engineMeta.stateChildren`:**
 *
 *   1. ONE auto-declared reactive variant cell (`@<varName>: Type`) with
 *      initial value resolved per §51.0.E (literal `initial=.X`, OR
 *      default-to-first-state-child fallback per W-ENGINE-INITIAL-MISSING
 *      lint behavior — A1b/B14 fires the warning; C12 does the codegen-time
 *      fallback because B14 leaves `initialVariant: null` when absent).
 *
 *   2. ONE static transition table const (`__scrml_engine_<varName>_transitions`)
 *      keyed by from-variant name. Each entry is one of:
 *        - `["X"]`           — single-target rule
 *        - `["A","B","C"]`   — multi-target rule
 *        - `"*"`             — wildcard rule (escape hatch; loses static guarantees)
 *        - `[]`              — terminal state (no `rule=` attribute)
 *      The wildcard `"*"` is a sentinel — runtime check is `entry === "*"`.
 *
 * **What this file does NOT emit (deferred):**
 *
 *   - Direct-write rule= validation (`E-ENGINE-INVALID-TRANSITION` runtime
 *     throw on illegal `@marioState = .Big` writes). Per C12 SURVEY: defer
 *     to C13 alongside `.advance()`. The transition table emitted here is
 *     all C13 needs to layer the validation hook on top.
 *   - `.advance(.Variant)` method emission. **C13 owns this.**
 *   - `<onTransition>` hook firing. **C13 owns this.**
 *   - `derived=expr` engines. **C14 owns this (B16 dependency).**
 *   - Cross-file engine import + `<EngineName/>` mount. **C15 owns this.**
 *   - Body-rendering (state-child markup expansion based on current variant).
 *     State-child bodies are RAW TEXT today (per
 *     `engine-statechild-parser.ts` line 14-21 — "no walkable children").
 *     C12 emits a placeholder marker comment at the engine's source position
 *     so a follow-on body-render emitter can locate it.
 *
 * **Naming convention** (per BRIEF Authorized Decisions):
 *   - `__scrml_engine_<varName>_transitions` — transition table const
 *   - The variant cell uses the standard reactive cell substrate
 *     (`_scrml_state` + `_scrml_reactive_get/set`) — NO new cell kind.
 */

// ---------------------------------------------------------------------------
// Types — canonical engine-decl + engineMeta shapes consumed
// ---------------------------------------------------------------------------

/**
 * The B15 EngineRuleForm shape (mirrored locally to avoid the symbol-table
 * ts dependency in this codegen module — keeps the import surface lean).
 * The shapes match `compiler/src/symbol-table.ts` `EngineRuleForm` exactly.
 */
type EngineRuleForm =
  | { kind: "absent" }
  | { kind: "single"; target: string; historyForm?: boolean }
  | { kind: "multi"; targets: string[]; historyForms?: boolean[] }
  | { kind: "wildcard" }
  | { kind: "legacy-arrow"; raw: string }
  | { kind: "parse-error"; raw: string; reason: string };

/**
 * The B15 EngineStateChildEntry shape (mirrored locally for the same reason
 * as EngineRuleForm above). Fields beyond `tag` and `rule` are ignored by
 * C12 — historyAttr/internalRule/onTimeoutElements/innerEngines all flow to
 * later Wave-4 sub-steps.
 */
interface EngineStateChildEntry {
  tag: string;
  rule: EngineRuleForm;
  bodyRaw?: string;
  isColonShorthand?: boolean;
  rawOffset?: number;
  historyAttr?: boolean;
  internalRule?: EngineRuleForm;
  onTimeoutElements?: unknown[];
  innerEngines?: unknown[];
}

interface EngineMetadata {
  forType: string;
  variants: string[];
  initialVariant: string | null;
  derivedExpr: unknown | null;
  varName: string;
  isExported: boolean;
  isPinned: boolean;
  stateChildren?: EngineStateChildEntry[];
  // ... Wave-4 follow-on fields ignored here.
}

interface EngineDeclLike {
  kind: "engine-decl";
  governedType?: string;
  engineName?: string;
  varName?: string;
  initialVariant?: string | null;
  rulesRaw?: string;
  sourceVar?: string | null;
  /**
   * Set by ast-builder to `true` when this engine-decl was authored with the
   * legacy `<machine>` keyword (§51.3, deprecated). The legacy projection
   * surface is handled by `emit-machines.ts` and triggers W-DEPRECATED-001.
   * C14's emission MUST EXCLUDE legacy-machine decls — they have their own
   * runtime path and including them would double-emit the projection.
   */
  legacyMachineKeyword?: boolean;
  _record?: { engineMeta?: EngineMetadata };
  _cellKind?: string;
}

// ---------------------------------------------------------------------------
// Engine-decl discovery — from the file AST
// ---------------------------------------------------------------------------

/**
 * Determine whether a given engine-decl AST node is in C12's emission scope.
 *
 * In scope:
 *   - `_record.engineMeta` exists (PASS 10.A registered the engine cell).
 *   - `engineMeta.stateChildren` is a non-empty array (PASS 11/B15 parsed
 *     the new `<engine>` state-child form, NOT the legacy arrow-rule body).
 *   - `engineMeta.derivedExpr` is null (NON-derived engines only — derived
 *     engines are C14 territory).
 *
 * Out of scope (returns false):
 *   - Legacy `<machine>` keyword bodies (rulesRaw is arrow-rule form;
 *     B15 leaves stateChildren empty — emit-machines.ts handles those).
 *   - Derived engines (`derivedExpr !== null`).
 *   - Engine-decls without B14 registration (parse-failure case; SYM
 *     diagnostic already fired).
 */
export function isC12EngineDecl(node: EngineDeclLike): boolean {
  if (!node || node.kind !== "engine-decl") return false;
  const meta = node._record?.engineMeta;
  if (!meta) return false;
  if (meta.derivedExpr != null) return false;
  if (!Array.isArray(meta.stateChildren) || meta.stateChildren.length === 0) {
    return false;
  }
  return true;
}

/**
 * Walk a file AST and collect all engine-decl nodes that are in C12's
 * emission scope. Walks markup containers (engines live as markup children
 * per `ast-builder.js:9311-9325`); skips logic blocks (engines are
 * file-scope only per §51.0.K Machine Cohesion in v0.next P1).
 *
 * Prefers `fileAST.machineDecls` (pre-collected by ast-builder's
 * `collectHoisted`) when available; falls back to a manual walk for safety.
 */
export function collectC12EngineDecls(fileAST: any): EngineDeclLike[] {
  const out: EngineDeclLike[] = [];
  if (!fileAST) return out;

  // Prefer the pre-collected list — ast-builder.js builds it during the
  // hoist pass and stamps it onto `fileAST.machineDecls`.
  const preCollected = (fileAST.machineDecls as EngineDeclLike[] | undefined)
    ?? (fileAST.ast?.machineDecls as EngineDeclLike[] | undefined);
  if (Array.isArray(preCollected) && preCollected.length > 0) {
    for (const node of preCollected) {
      if (isC12EngineDecl(node)) out.push(node);
    }
    return out;
  }

  // Fallback: manual walk over markup children. Mirrors B16's
  // `collectAllEngineDecls` shape in `compiler/src/dependency-graph.ts`.
  const nodes: any[] = (fileAST.nodes as any[] | undefined)
    ?? (fileAST.ast?.nodes as any[] | undefined)
    ?? [];
  function visit(list: any[]): void {
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "engine-decl" && isC12EngineDecl(node)) {
        out.push(node);
      }
      if (Array.isArray(node.children)) visit(node.children);
    }
  }
  visit(nodes);
  return out;
}

// ---------------------------------------------------------------------------
// Naming convention — exported so C13/C14/C15 can use the same names
// ---------------------------------------------------------------------------

/**
 * Compute the transition-table const name for an engine.
 *
 * Format: `__scrml_engine_<varName>_transitions`
 *
 * Used at:
 *   - This file's `emitEngineTransitionTable` (definition site).
 *   - C13's direct-write hook + `.advance()` emission (table-lookup site).
 *
 * Two underscores prefix matches the convention `__scrml_transitions_<MachineName>`
 * used by `emit-machines.ts` for the legacy machine table; with the `engine_`
 * infix the two namespaces never collide even if a project mixes
 * `<engine for=Foo>` (var: `foo`) with `<machine name=Foo for=Foo>`.
 */
export function engineTransitionTableName(varName: string): string {
  return `__scrml_engine_${varName}_transitions`;
}

// ---------------------------------------------------------------------------
// Initial-variant resolution — §51.0.E + W-ENGINE-INITIAL-MISSING fallback
// ---------------------------------------------------------------------------

/**
 * Resolve the initial variant for a non-derived engine.
 *
 * Per SPEC §51.0.E:
 *   - If `initial=.Variant` was specified, use that variant.
 *   - If absent: the lint `W-ENGINE-INITIAL-MISSING` is fired (by B15) and
 *     the compiler defaults to the FIRST state-child's variant.
 *
 * B14 stores the literal `initial=` value as `engineMeta.initialVariant`
 * (`null` when absent). C12 implements the fallback at codegen time so the
 * emitted variant cell always has a concrete starting variant.
 *
 * Returns the variant name, or `null` if no fallback is possible (no
 * stateChildren OR no initialVariant — defensive case the caller skips).
 */
export function resolveEngineInitialVariant(meta: EngineMetadata): string | null {
  if (typeof meta.initialVariant === "string" && meta.initialVariant.length > 0) {
    return meta.initialVariant;
  }
  // W-ENGINE-INITIAL-MISSING fallback — first state-child's variant tag.
  // B15 fires the lint; C12 honors the resolution.
  const sc = meta.stateChildren;
  if (
    Array.isArray(sc) && sc.length > 0 &&
    typeof sc[0]?.tag === "string" && sc[0]!.tag.length > 0
  ) {
    return sc[0]!.tag;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Transition table emission — §51.0.F three rule= forms
// ---------------------------------------------------------------------------

/**
 * Encode an EngineRuleForm into the table-entry value shape.
 *
 * | rule= form        | EngineRuleForm                  | Encoded entry              |
 * |-------------------|---------------------------------|----------------------------|
 * | (absent)          | `{kind:"absent"}`               | `[]`  (terminal — no transitions) |
 * | `rule=.X`         | `{kind:"single",target:"X"}`    | `["X"]`                    |
 * | `rule=(.A | .B)`  | `{kind:"multi",targets:[...]}`  | `["A","B"]`                |
 * | `rule=*`          | `{kind:"wildcard"}`             | `"*"`                       |
 *
 * Legacy-arrow / parse-error rule forms are encoded as `[]` (terminal) here
 * because B15 already fired diagnostics for them; the emitted table is
 * defensively empty so runtime cannot dispatch through a malformed entry.
 *
 * The `.history` target form (§51.0.N) is currently flattened — the variant
 * name is recorded without the history modifier. History semantics are
 * out of A1c Wave 4 scope per the BRIEF (S67 §51.0.N is a follow-on).
 */
function encodeRuleEntry(rule: EngineRuleForm): string {
  switch (rule.kind) {
    case "single":
      return JSON.stringify([rule.target]);
    case "multi":
      return JSON.stringify(rule.targets);
    case "wildcard":
      return JSON.stringify("*");
    case "absent":
    case "legacy-arrow":
    case "parse-error":
    default:
      return JSON.stringify([]);
  }
}

/**
 * Emit the static transition-table const for one engine.
 *
 * Shape:
 *   const __scrml_engine_marioState_transitions = Object.freeze({
 *     "Small": ["Big"],
 *     "Big":   ["Fire","Cape","Small"],
 *     "Fire":  ["Small"],
 *     "Cape":  ["Small"],
 *   });
 *
 * `Object.freeze` is defensive — the table is read-only metadata; freezing
 * documents the "compile-time-baked" intent and turns accidental mutation
 * into a TypeError under strict mode.
 *
 * @param meta — the engine's `engineMeta` (from `_record.engineMeta`)
 * @returns lines of JS code; empty array if `stateChildren` is empty
 */
export function emitEngineTransitionTable(meta: EngineMetadata): string[] {
  const sc = meta.stateChildren;
  if (!Array.isArray(sc) || sc.length === 0) return [];

  const tableName = engineTransitionTableName(meta.varName);
  const lines: string[] = [];

  lines.push(`// §51.0.F transition table for engine ${meta.varName}: ${meta.forType}`);
  lines.push(`const ${tableName} = Object.freeze({`);

  const entries: string[] = [];
  for (const child of sc) {
    if (!child || typeof child.tag !== "string" || child.tag.length === 0) {
      continue;
    }
    const key = JSON.stringify(child.tag);
    const value = encodeRuleEntry(child.rule);
    entries.push(`  ${key}: ${value}`);
  }
  lines.push(entries.join(",\n"));
  lines.push(`});`);

  return lines;
}

// ---------------------------------------------------------------------------
// Variant cell init emission — §51.0.C auto-declared variable
// ---------------------------------------------------------------------------

/**
 * Build the JS expression for the initial variant value.
 *
 * Variants in the runtime are encoded by `emitEnumVariantObjects` (§14.4)
 * as either:
 *   - Unit variant:    `Status.Loading` evaluates to `"Loading"` (bare string).
 *   - Payload variant: `Status.Failed("err")` evaluates to `{variant:"Failed",data:{...}}`.
 *
 * `initial=.Variant` is a UNIT-VARIANT reference (no payload — `initial=`
 * doesn't accept payload-constructor calls per §51.0.E grammar). The runtime
 * shape for a unit variant is the bare string. We emit the bare string
 * directly to avoid depending on the enum object's runtime initialization
 * order (the enum object const + the engine cell init may emit close
 * together; preferring the bare string is order-independent).
 *
 * Note: this matches the parity contract documented at
 * `emit-machines.ts:548-557` for variant extraction — both bare strings and
 * `.variant`-bearing objects flow through the same `__prevVariant` /
 * `__nextVariant` extraction path.
 */
function emitInitialVariantValue(initialVariant: string): string {
  return JSON.stringify(initialVariant);
}

/**
 * Emit the variant cell init for one engine.
 *
 * Shape:
 *   // §51.0.C auto-declared engine variable: marioState (MarioState)
 *   _scrml_reactive_set("marioState", "Small");
 *
 * The cell is registered at the standard reactive-cell substrate
 * (`_scrml_state` + `_scrml_subscribers`). No new helper is needed; the
 * engine variable is structurally identical to a `@var = init` reactive
 * cell, with the engine's transition-table layered ON TOP of the cell at
 * write time (C13's hook).
 *
 * **Encoding-context note:** unlike user-authored state-decls, engine
 * variables do NOT pass through `encodingCtx.encode()`. The variable name
 * is canonical (per §51.0.C) and the stable encoded name is just the
 * variable name itself. This matches the legacy machine variable wiring
 * (per `emit-machines.ts:572` — uses the bare variable name in error
 * messages and `_scrml_reactive_set` keys).
 *
 * @param meta — the engine's `engineMeta`
 * @returns lines of JS code; empty array if `initialVariant` cannot resolve
 */
export function emitEngineVariantCellInit(meta: EngineMetadata): string[] {
  const lines: string[] = [];
  const initial = resolveEngineInitialVariant(meta);
  if (!initial) {
    // No way to resolve initial — defensive skip. B15 should have fired
    // E-ENGINE-INITIAL-INVALID-VARIANT or W-ENGINE-INITIAL-MISSING earlier.
    return lines;
  }

  lines.push(`// §51.0.C auto-declared engine variable: ${meta.varName} (${meta.forType})`);
  lines.push(`_scrml_reactive_set(${JSON.stringify(meta.varName)}, ${emitInitialVariantValue(initial)});`);
  return lines;
}

// ---------------------------------------------------------------------------
// Top-level emission — orchestrates all engines in a file
// ---------------------------------------------------------------------------

/**
 * Emit the C12 substrate for every in-scope engine in the file.
 *
 * Order per engine: transition table FIRST (table is read-only data;
 * declaring it before the cell init lets future write-hook code reference
 * the table at module-init time), then the variant cell init.
 *
 * Per-file ordering: engines are emitted in source order (the order the
 * walker discovered them, mirrors `fileAST.machineDecls` order).
 *
 * Returns an empty array when there are no in-scope engines (lets the
 * caller skip a section header without checking length).
 */
export function emitEngineSubstrate(fileAST: any): string[] {
  const decls = collectC12EngineDecls(fileAST);
  if (decls.length === 0) return [];

  const lines: string[] = [];
  for (const decl of decls) {
    const meta = decl._record!.engineMeta!;
    const tableLines = emitEngineTransitionTable(meta);
    const cellLines = emitEngineVariantCellInit(meta);
    if (tableLines.length === 0 && cellLines.length === 0) continue;
    if (lines.length > 0) lines.push("");
    for (const l of tableLines) lines.push(l);
    for (const l of cellLines) lines.push(l);
    // §51.0.D mount-position marker. The engine renders at its declaration
    // position. C12 deliberately does NOT emit body markup — state-child
    // bodies are RAW TEXT today (per engine-statechild-parser.ts) and a
    // body-render emitter is a follow-on (C13 or later). The marker
    // documents WHERE the engine renders so the follow-on emitter can
    // locate the slot.
    lines.push(`// §51.0.D engine mount position: ${meta.varName} (${meta.forType}) — body rendering deferred to follow-on`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// C13 — engine-bindings map (write-hook seam) + write-guard emitter
// ---------------------------------------------------------------------------

/**
 * Per-engine binding info consumed by `_emitReactiveSet` to dispatch a
 * `<engine>`-form write to the C13 runtime hook (`_scrml_engine_direct_set`).
 *
 * Sibling to legacy `<machine>` bindings (built by
 * `emit-reactive-wiring.ts:buildMachineBindingsMap`). Per C13 SURVEY q1, the
 * two surfaces are FORKED — the legacy `TransitionRule[]` shape is too
 * entangled with machine-only features (guards, effects, labels, audit,
 * temporal, payload bindings) for a clean merge with the new C12 table
 * format (`["X"]` / `"*"` / `[]` per from-variant).
 */
export interface EngineBindingInfo {
  /** Engine variable name (e.g., `"marioState"`). */
  varName: string;
  /** Governed enum type name (e.g., `"MarioState"`). */
  forType: string;
  /** Compile-time-baked transition-table identifier (per §51.0.F + C12). */
  tableName: string;
}

/**
 * Walk the file AST and collect a map from engine-variable name → binding info.
 * Returns null when no in-scope C12 engines exist (caller skips the wiring
 * cost).
 *
 * Mirrors C12's discovery walker (`collectC12EngineDecls`) for consistency.
 * The map is consumed by `_emitReactiveSet` in `emit-logic.ts` to dispatch a
 * direct-write `@engineVar = .X` to the C13 runtime hook instead of the bare
 * `_scrml_reactive_set`.
 */
export function buildEngineBindingsMap(fileAST: unknown): Map<string, EngineBindingInfo> | null {
  const decls = collectC12EngineDecls(fileAST);
  if (decls.length === 0) return null;
  const out = new Map<string, EngineBindingInfo>();
  for (const decl of decls) {
    const meta = decl._record?.engineMeta;
    if (!meta || typeof meta.varName !== "string" || meta.varName.length === 0) continue;
    out.set(meta.varName, {
      varName: meta.varName,
      forType: meta.forType,
      tableName: engineTransitionTableName(meta.varName),
    });
  }
  return out.size > 0 ? out : null;
}

/**
 * Emit the runtime helper-call for a direct write to an engine variable.
 *
 * Per §51.0.F (Move 12) — `@engineVar = .X` is intercepted; the C13 runtime
 * hook (`_scrml_engine_direct_set`) reads the current variant, looks up the
 * from-state's `rule=` entry in the compile-time-baked table, and either
 * commits the write or throws `E-ENGINE-INVALID-TRANSITION`.
 *
 * Shape:
 *   _scrml_engine_direct_set("marioState", <newValueExpr>, __scrml_engine_marioState_transitions);
 *
 * The table-name is emitted as a BARE IDENTIFIER (not a string) so the
 * runtime does NOT have to look it up — the const is in scope at the use
 * site (table emission precedes any code that writes the engine variable;
 * see `emit-client.ts` orchestration).
 */
export function emitEngineWriteGuard(binding: EngineBindingInfo, newValueExpr: string): string[] {
  return [
    `// §51.0.F engine direct-write hook: ${binding.varName} (${binding.forType})`,
    `_scrml_engine_direct_set(${JSON.stringify(binding.varName)}, ${newValueExpr}, ${binding.tableName});`,
  ];
}

// ---------------------------------------------------------------------------
// C13 — `.advance()` codegen helpers (consumed by emit-expr.ts)
// ---------------------------------------------------------------------------

/**
 * Compute the set of engine variable names in the file's scope. Used by
 * `emit-expr.ts:emitCall` to detect `.advance` calls on engine variables.
 *
 * Returns an empty Set when there are no in-scope engines (caller's
 * detection arm short-circuits).
 */
export function collectEngineVarNames(fileAST: unknown): Set<string> {
  const out = new Set<string>();
  for (const decl of collectC12EngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (meta && typeof meta.varName === "string" && meta.varName.length > 0) {
      out.add(meta.varName);
    }
  }
  return out;
}

/**
 * Emit the `.advance(.X)` runtime helper call for a known engine variable.
 *
 * Per §51.0.G (Move 13) — `@engineVar.advance(.X)` is intercepted; the C13
 * runtime hook (`_scrml_engine_advance`) reads the current variant, looks
 * up the from-state's `rule=` entry, and either commits the transition or
 * throws E-ENGINE-INVALID-TRANSITION with the "asserted advance failed"
 * framing per §51.0.G's loud-failure semantics.
 *
 * Shape:
 *   _scrml_engine_advance("marioState", <targetExpr>, __scrml_engine_marioState_transitions)
 *
 * Returns a single expression string (no trailing semicolon — `.advance()`
 * is a CallExpr; its emission is composed by `emitCall` and the surrounding
 * statement wrapper adds the semicolon).
 */
export function emitEngineAdvanceCall(varName: string, targetExpr: string): string {
  const tableName = engineTransitionTableName(varName);
  return `_scrml_engine_advance(${JSON.stringify(varName)}, ${targetExpr}, ${tableName})`;
}

// ===========================================================================
// C14 — Derived engines (`derived=expr` emission, L20)
// ===========================================================================
//
// Per SPEC §51.0.J (lines 20607-20642). A derived engine computes its current
// value from an upstream reactive expression instead of being driven by direct
// writes. The engine variant cell becomes a READ-ONLY derived cell at the
// runtime layer (registered via C2's `_scrml_derived_declare` substrate, not
// the plain `_scrml_reactive_set` path used by non-derived engines in C12).
//
// **What C14 emits per derived engine:**
//
//   1. ONE auto-declared READ-ONLY reactive variant cell registered with
//      `_scrml_derived_declare(<varName>, () => <projection-closure>)`. The
//      closure body computes the engine's current variant from the upstream
//      cell(s) the `derived=expr` reads.
//
//   2. ONE `_scrml_derived_subscribe(<varName>, <upstream>)` call per upstream
//      cell the `derived=expr` reads — registers the dirty-propagation edge so
//      the closure re-evaluates when an upstream cell changes.
//
//   3. INLINE `E-DERIVED-ENGINE-INITIAL-UNDEFINED` throw inside the closure:
//      if the projection yields `undefined`, throw at runtime per §34 line
//      14460. Fires both at engine-init time (forced read via
//      `_scrml_derived_get`) AND on every subsequent re-evaluation when the
//      upstream cell takes a value with no matching arm — same error code per
//      the catalog row (no separate "transition undefined" code exists).
//
//   4. Mount-position marker comment per C12's pattern.
//
// **What C14 does NOT emit (deferred):**
//
//   - `<onTransition>` / `effect=` firing on derived state-children — same
//     parser blocker as C13. Per §51.0.J line 20639, these ARE legal on
//     derived engines (they fire on derived state changes). Deferred to the
//     parser-extension follow-on step that lands `<onTransition>`/`effect=`
//     parsing.
//   - Transition table — per §51.0.J line 20636, `rule=` on derived
//     state-children is REJECTED (E-DERIVED-ENGINE-NO-RULES, A1b/B16
//     enforces). NO transition table needed.
//   - Direct-write hook — per §51.0.J line 20638, direct writes to derived
//     engine variables are REJECTED at compile time
//     (E-DERIVED-ENGINE-NO-WRITE, A1b/B16 enforces). NO runtime hook needed.
//   - `.advance()` — derived engines have no `.advance` API per §51.0.G
//     (covered by E-DERIVED-ENGINE-NO-WRITE family).
//   - Body rendering — same C12 deferral; mount-position marker mirrors C12's.
//
// **Today's parser-and-B14 limitation:**
//   `engineMeta.derivedExpr` ONLY carries the legacy single-source-var form
//   `{ kind: "legacy-source-var", varName: <upstream> }` — produced when
//   `ast-builder.js` line 8593 matches `derived=@varname`. The §51.0.J
//   rich form `derived=match @x { ... }` is NOT YET STRUCTURALLY PARSED.
//   When the rich form lands (parser-extension step), this emitter's shell
//   stays the same — only the closure body and the dependency-set inputs
//   change (the body becomes the rewritten match-expression; the deps come
//   from `forEachIdentInExprNode` over the parsed ExprNode).
//
// For the legacy single-source-var form, the projection IS the identity
// projection — engine variant equals upstream cell value, coerced into the
// engine's variant set. When the upstream cell's value is not in the engine's
// variant set, the projection is `undefined` → E-DERIVED-ENGINE-INITIAL-
// UNDEFINED.
// ===========================================================================

/**
 * Determine whether a given engine-decl AST node is in C14's emission scope.
 *
 * In scope:
 *   - `_record.engineMeta` exists (PASS 10.A registered the engine cell).
 *   - `engineMeta.derivedExpr` is non-null (DERIVED engines only — non-derived
 *     engines are C12 territory).
 *   - `legacyMachineKeyword !== true` (LEGACY `<machine>` derived projections
 *     are handled by `emit-machines.ts` — including them here would double-
 *     emit and break legacy `<machine derived=@x>` runtime semantics).
 *
 * **Sibling to `isC12EngineDecl`** — the inverse polarity on `derivedExpr`.
 * Per C14 SURVEY q1, kept as a sibling predicate (not a parameterized fn) so
 * call sites read self-documenting names.
 *
 * Out of scope (returns false):
 *   - Non-derived engines (`derivedExpr === null` — C12 territory).
 *   - Engine-decls without B14 registration (parse-failure case; SYM
 *     diagnostic already fired).
 *   - Legacy `<machine>` keyword decls (their derived-projection path is
 *     `emit-machines.ts` + `_scrml_derived_fns` registration via the legacy
 *     surface; W-DEPRECATED-001 fires for the keyword separately).
 */
export function isC14DerivedEngineDecl(node: EngineDeclLike): boolean {
  if (!node || node.kind !== "engine-decl") return false;
  if (node.legacyMachineKeyword === true) return false;
  const meta = node._record?.engineMeta;
  if (!meta) return false;
  if (meta.derivedExpr == null) return false;
  return true;
}

/**
 * Walk a file AST and collect all engine-decl nodes that are in C14's
 * emission scope. Mirrors `collectC12EngineDecls` shell exactly — only the
 * predicate filter changes (`isC14DerivedEngineDecl` instead of
 * `isC12EngineDecl`).
 *
 * Prefers `fileAST.machineDecls` (pre-collected by ast-builder's
 * `collectHoisted`); falls back to a manual walk for safety.
 */
export function collectC14DerivedEngineDecls(fileAST: any): EngineDeclLike[] {
  const out: EngineDeclLike[] = [];
  if (!fileAST) return out;

  const preCollected = (fileAST.machineDecls as EngineDeclLike[] | undefined)
    ?? (fileAST.ast?.machineDecls as EngineDeclLike[] | undefined);
  if (Array.isArray(preCollected) && preCollected.length > 0) {
    for (const node of preCollected) {
      if (isC14DerivedEngineDecl(node)) out.push(node);
    }
    return out;
  }

  const nodes: any[] = (fileAST.nodes as any[] | undefined)
    ?? (fileAST.ast?.nodes as any[] | undefined)
    ?? [];
  function visit(list: any[]): void {
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "engine-decl" && isC14DerivedEngineDecl(node)) {
        out.push(node);
      }
      if (Array.isArray(node.children)) visit(node.children);
    }
  }
  visit(nodes);
  return out;
}

/**
 * Extract the upstream-cell dependencies the `derived=expr` reads.
 *
 * Today's parser-and-B14 produces ONLY the legacy single-source-var form:
 *   derivedExpr = { kind: "legacy-source-var", varName: <upstream> }
 *
 * This helper returns the upstream as a single-element list. When the
 * §51.0.J rich form lands (`derived=match @x { ... }`), `derivedExpr` will
 * carry a parsed ExprNode and this helper will walk it via
 * `forEachIdentInExprNode` to enumerate ALL `@cell` reads.
 *
 * Returns an empty list when the expression shape is unrecognized
 * (defensive — caller emits no `_scrml_derived_subscribe` calls in that case,
 * so the closure runs at init time but does not re-evaluate on upstream
 * changes; B16 should have rejected unrecognized shapes earlier).
 */
function collectDerivedEngineDeps(derivedExpr: unknown): string[] {
  if (!derivedExpr || typeof derivedExpr !== "object") return [];
  const obj = derivedExpr as Record<string, unknown>;
  if (obj.kind === "legacy-source-var" && typeof obj.varName === "string" && obj.varName.length > 0) {
    return [obj.varName];
  }
  // Future: rich-expr shape — walk parsed ExprNode via forEachIdentInExprNode.
  return [];
}

/**
 * Build the JS expression that is the closure BODY for a derived-engine's
 * projection.
 *
 * **For the legacy single-source-var form** (`derived=@upstream`):
 *   The projection IS the identity projection — engine variant equals upstream
 *   cell value. The body reads the upstream via `_scrml_reactive_get` and
 *   returns it directly. The runtime variant-set check is implicit:
 *   downstream consumers (the variant-cell readers) treat the value as the
 *   engine's variant; if it's not in the variant set, downstream variant
 *   matching naturally returns no-match.
 *
 *   For the initial-value-undefined check (§51.0.J line 20640), we wrap the
 *   read with an `undefined`-detector: if the upstream value is `undefined`,
 *   throw `E-DERIVED-ENGINE-INITIAL-UNDEFINED` per §34 line 14460. This fires
 *   at init time AND on every subsequent re-evaluation if the upstream
 *   becomes undefined.
 *
 * **When the rich form lands** (`derived=match @x { ... }`):
 *   The body becomes the rewritten match-expression; an `undefined` result
 *   (no match-arm fired) triggers the same throw.
 *
 * @param derivedExpr — `engineMeta.derivedExpr` value
 * @param varName — engine variable name (for diagnostic in the throw message)
 * @returns the closure body — a JS expression block ready to be wrapped in `() => { ... }`
 */
function buildDerivedEngineClosureBody(derivedExpr: unknown, varName: string): string {
  if (derivedExpr && typeof derivedExpr === "object") {
    const obj = derivedExpr as Record<string, unknown>;
    if (obj.kind === "legacy-source-var" && typeof obj.varName === "string" && obj.varName.length > 0) {
      const upstream = obj.varName;
      // Identity projection: engine variant === upstream cell value.
      // Inline E-DERIVED-ENGINE-INITIAL-UNDEFINED throw per §51.0.J line 20640
      // + §34 line 14460. Fires at init time (forced eval) AND on every
      // re-evaluation when upstream becomes undefined.
      return [
        `const __scrml_derived_v = _scrml_reactive_get(${JSON.stringify(upstream)});`,
        `if (__scrml_derived_v === undefined) {`,
        `  throw new Error("E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT: derived engine '${varName}' yielded no value " +`,
        `    "(upstream '${upstream}' is undefined). " +`,
        `    "Per §51.0.J + §34: derived=expr must produce a defined variant for the source's initial state. " +`,
        `    "Add a default arm or a wildcard arm in the derivation.");`,
        `}`,
        `return __scrml_derived_v;`,
      ].join("\n  ");
    }
  }
  // Defensive: unrecognized shape — emit a closure that always throws so the
  // failure is loud at engine-init time. B16 should have rejected
  // unrecognized shapes earlier.
  return [
    `throw new Error("E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT: derived engine '${varName}' has an unrecognized derivedExpr shape. " +`,
    `  "This is a compiler internal error — B16 should have rejected this earlier.");`,
  ].join("\n  ");
}

/**
 * Emit the C14 substrate for one derived engine.
 *
 * Shape:
 *   // §51.0.J derived engine: marioState (MarioState) — derived from upstream(s)
 *   _scrml_derived_declare("marioState", () => {
 *     const __scrml_derived_v = _scrml_reactive_get("upstream");
 *     if (__scrml_derived_v === undefined) {
 *       throw new Error("E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT: ...");
 *     }
 *     return __scrml_derived_v;
 *   });
 *   _scrml_derived_subscribe("marioState", "upstream");
 *   // Force initial evaluation so init-time E-DERIVED-ENGINE-INITIAL-UNDEFINED fires loudly.
 *   _scrml_derived_get("marioState");
 *
 * The forced initial `_scrml_derived_get` call is critical: derived cells are
 * lazy by default (`_scrml_derived_dirty[name] = true` after declare). Without
 * a forced read at init time, the throw would not fire until something
 * downstream attempted to read the engine variable — that's the wrong
 * semantics per §51.0.J line 20640 (the spec says "Initial-value undefined"
 * is checked at engine-init time, not at first-use).
 *
 * @param meta — the engine's `engineMeta`
 * @returns lines of JS code; empty array when the meta is invalid
 */
export function emitDerivedEngineSubstrate(meta: EngineMetadata): string[] {
  if (!meta || typeof meta.varName !== "string" || meta.varName.length === 0) {
    return [];
  }
  if (meta.derivedExpr == null) {
    return [];
  }

  const lines: string[] = [];
  const varName = meta.varName;
  const forType = meta.forType ?? "";
  const deps = collectDerivedEngineDeps(meta.derivedExpr);

  lines.push(`// §51.0.J derived engine: ${varName} (${forType}) — derived from ${deps.length > 0 ? deps.join(", ") : "<unknown>"}`);

  // _scrml_derived_declare with the projection closure (inline init-undefined throw).
  const closureBody = buildDerivedEngineClosureBody(meta.derivedExpr, varName);
  lines.push(`_scrml_derived_declare(${JSON.stringify(varName)}, () => {`);
  lines.push(`  ${closureBody}`);
  lines.push(`});`);

  // One _scrml_derived_subscribe per upstream dependency.
  for (const dep of deps) {
    lines.push(`_scrml_derived_subscribe(${JSON.stringify(varName)}, ${JSON.stringify(dep)});`);
  }

  // Force initial evaluation so init-time E-DERIVED-ENGINE-INITIAL-UNDEFINED
  // fires loudly per §51.0.J line 20640. Without this read, the lazy-pull
  // semantics of `_scrml_derived_get` would defer the throw to first-use.
  lines.push(`_scrml_derived_get(${JSON.stringify(varName)});`);

  return lines;
}

/**
 * Emit the C14 substrate for every in-scope DERIVED engine in the file.
 *
 * Sibling to C12's `emitEngineSubstrate` (non-derived engines). Both run per
 * compile; their outputs go into the same client-output section, derived
 * engines AFTER non-derived (so any derived engine projecting from a
 * non-derived engine variant cell sees the upstream's initial value).
 *
 * Returns an empty array when there are no in-scope derived engines (lets
 * the caller skip a section header without checking length).
 */
export function emitDerivedEngineSubstrateForFile(fileAST: any): string[] {
  const decls = collectC14DerivedEngineDecls(fileAST);
  if (decls.length === 0) return [];

  const lines: string[] = [];
  for (const decl of decls) {
    const meta = decl._record!.engineMeta!;
    const declLines = emitDerivedEngineSubstrate(meta);
    if (declLines.length === 0) continue;
    if (lines.length > 0) lines.push("");
    for (const l of declLines) lines.push(l);
    // §51.0.D mount-position marker. Same pattern as C12's non-derived path —
    // C14 deliberately does NOT emit body markup (state-child bodies are RAW
    // TEXT today; body-render is a follow-on).
    lines.push(`// §51.0.D engine mount position: ${meta.varName} (${meta.forType}) — DERIVED — body rendering deferred to follow-on`);
  }

  return lines;
}

// ===========================================================================
// C15 — Cross-file engine mount + auto-declared engine variable (M16, M18)
// ===========================================================================
//
// Per SPEC §21.8 (cross-file engine import normative, lines 12328-12395) +
// §51.0.D (engine mount position rules + cross-file singleton via
// `<EngineName/>`, lines 20380-20426). Wave 4 closer; depends on C12 (variant
// cell + transition table substrate), C13 (write-hook + .advance()), C14
// (derived-engine substrate). Sibling-aware: B17.2 (parser-extension for
// `<onTransition>` + `effect=`) is in flight in parallel; B17.2 owns the
// parser/symbol-table territory while C15 owns the codegen territory.
//
// **What C15 emits per importer file with cross-file engine mount sites:**
//
//   1. Per `<engineVarName/>` use-site in markup whose `engineVarName`
//      resolves (via importBindings × exportRegistry) to an exported engine
//      in another file: a §21.8 mount-position MARKER COMMENT documenting
//      the singleton mount. Mirrors C12 / C14's same-file mount-position
//      marker pattern.
//
//   2. The JS module-import side is HANDLED BY `emit-client.ts:498-514`'s
//      existing import-rewriter — `import { Phase } from './engines.scrml'`
//      becomes `import { Phase } from "./engines.client.js"`, which forces
//      engines.client.js to load. The exporter's module-init-time
//      `_scrml_reactive_set("appPhase", "Idle")` runs during that load,
//      populating the page-shared `_scrml_state` (§Q1 of C15 SURVEY:
//      `_scrml_state` IS module-scope-shared in production via classic-script
//      global lex env — see `compiler/src/runtime-template.js:81`).
//
// **What C15 does NOT emit (deferred):**
//
//   - State-child body rendering at the use-site DOM position. SAME parser
//     blocker as C12/C13/C14 — engine state-child bodies are RAW TEXT today.
//     The mount-position marker comment marks the slot for a follow-on
//     body-render emitter to fill.
//   - `<onTransition>` / `effect=` firing on cross-file mounted engines —
//     SAME parser blocker as C13/C14.
//   - `<EngineName/>` INSIDE a component body — A1b B17 deferred this; C15
//     should NOT handle (B17 follow-on territory).
//   - Implicit auto-import per §21.8 line 12353 (`import { Phase }` only,
//     then `<appPhase/>` works) — DEFERRED. Requires TAB/MOD-extension to
//     desugar the implicit `appPhase` into the importer's importBindings.
//     The EXPLICIT auto-import form (`import { Phase, appPhase } from
//     './engines.scrml'`) is fully shipped per §21.8 line 12354.
//   - Re-export of an imported engine (§21.4 standard re-export) at the
//     emit level — re-export is already handled by MOD's re-export-chain
//     resolution; C15 just consumes the resolved exportRegistry entry.
//
// **Discrimination annotation (Q4 in C15 SURVEY):**
//   NR (`name-resolver.ts:419-435`) does NOT discriminate engine-imports
//   from other user-state-type imports — `category === "engine"` is
//   collapsed into `kind: "user-state-type"` at NR's importedRegistry build.
//   C15 codegen re-derives the discrimination at emit time using the same
//   primitives B14 PASS 10.B uses: `fileScope.importBindings` lookup +
//   `exportRegistry` source-export category check.
//
// **Singleton invariant (§51.0.A + §51.0.D line 20413):**
//   A cross-file imported engine is the SAME instance across all use-sites
//   in all importing files. The singleton mechanism is the page-shared
//   `_scrml_state` table — exporter's `_scrml_reactive_set("appPhase", ...)`
//   writes to the same map all importers read from. NO new instance per
//   importer. Multiple use-sites in one importer → same instance. Multiple
//   importers → same instance. Transitions in any mount-site location
//   update the shared cell.
// ===========================================================================

/**
 * Per-mount-site descriptor for a cross-file engine use-site detected in the
 * importer's markup. C15's emission consumes this; produced by
 * `collectCrossFileEngineMounts`.
 */
export interface CrossFileEngineMountSite {
  /** The local binding name in the importer's scope (the `<varName/>` tag). */
  varName: string;
  /** The exporter file's absolute path (from importBindings.sourcePath). */
  exporterPath: string;
  /** The exporter's exported name (matches `varName` unless aliased on import). */
  exportedName: string;
}

/**
 * Type-shape mirror for the shape `fileAST._scope` carries (file-level Scope).
 * Mirrored locally to avoid the symbol-table.ts dependency in this codegen
 * module — keeps the import surface lean. Matches `compiler/src/symbol-table.ts`
 * `Scope` exactly for the fields we read (importBindings).
 */
interface CrossFileFileScopeLike {
  importBindings?: Map<string, { localName: string; exportedName: string; sourcePath: string; pinned?: boolean }>;
}

/**
 * The MOD exportRegistry shape — outer Map<absolutePath, …>, inner
 * Map<exportName, {kind, category, isComponent}>. Mirrors
 * `compiler/src/module-resolver.js:buildExportRegistry`.
 */
type CrossFileExportRegistry = Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>>;

/**
 * Walk the importer file's AST + markup and collect every `<varName/>` use-
 * site whose source export is `category: "engine"`. Mirrors B14 PASS 10.B's
 * walker (`symbol-table.ts:3997-4066`) for symmetry — both use the SAME
 * lookup primitives (importBindings × exportRegistry × `category === "engine"`).
 *
 * Self-closing PascalCase / lowercase tags resolved against importBindings
 * are component instantiations, engine mounts, channel mounts, or other
 * imported entities. The discriminator is the SOURCE EXPORT'S CATEGORY:
 *
 *   - `category === "engine"`             → cross-file engine mount (THIS WALKER)
 *   - `category === "user-component"`     → component instantiation (CE territory)
 *   - other (function, type, channel, …)  → E-ENGINE-MOUNT-NOT-ENGINE fired by B14
 *
 * Same-file engines render at decl position per §51.0.D (no use-site tag form);
 * the walker only fires on tags resolved through the import path. Returns an
 * empty array when no exportRegistry is provided (test harnesses) OR when the
 * importer has no cross-file engine mount sites.
 *
 * **Re-export support (§21.4):** when the source export is a re-export chain,
 * MOD's exportRegistry SHOULD have already resolved the chain to the ultimate
 * engine-category entry. C15 does not chase re-export chains itself —
 * single-step lookup against the `binding.sourcePath` Map suffices.
 *
 * **Path-shape resilience:** `importBindings.sourcePath` carries the LITERAL
 * import-statement source string (e.g., `"./engines.scrml"`), which is a
 * RELATIVE path in user source. MOD's `exportRegistry` is keyed by ABSOLUTE
 * paths (post-`resolveModulePath` resolution). To make the lookup robust
 * against both shapes (unit-test harnesses pass relative-keyed registries;
 * the production pipeline keys by absolute), the walker tries:
 *   (1) the literal `binding.sourcePath` (relative form — matches
 *       harness-fed registries),
 *   (2) the absolute resolved form `resolveModulePath(sourcePath, importerPath)`
 *       — matches the production-pipeline registry.
 * The first non-empty source-map wins. This costs one extra Map.get when the
 * relative key matches; when it doesn't, a single resolve+lookup is the
 * cheapest correct path.
 */
export function collectCrossFileEngineMounts(
  fileAST: any,
  exportRegistry: CrossFileExportRegistry | null | undefined,
): CrossFileEngineMountSite[] {
  const out: CrossFileEngineMountSite[] = [];
  if (!exportRegistry) return out; // no MOD result → nothing to discriminate.
  if (!fileAST) return out;

  const fileScope: CrossFileFileScopeLike | null = (fileAST as any)._scope ?? null;
  const importBindings = fileScope?.importBindings;
  if (!importBindings || importBindings.size === 0) return out; // no imports → no cross-file mounts.

  // Importer's path — needed to resolve relative import sources to absolute
  // for the production-shape exportRegistry lookup. May be empty in synthetic
  // unit tests; the relative-path lookup still works for those.
  const importerPath: string = (fileAST as any).filePath ?? "";

  const visited = new WeakSet<object>();
  const seen = new Set<string>(); // de-dup multiple use-sites of the same varName
  const orderedMounts: CrossFileEngineMountSite[] = [];

  /**
   * Look up the source's exportRegistry entry, trying both the literal
   * (relative) source and the absolute-resolved path. See the "path-shape
   * resilience" note in the parent function's docblock.
   */
  function lookupSourceMap(sourcePath: string): { map: Map<string, { kind: string; category: string; isComponent: boolean }> | undefined; resolvedPath: string } {
    // (1) Try literal — matches unit-test harnesses that build exportRegistry
    // with relative path keys (e.g., engine-binding-b14.test.js).
    const directMap = exportRegistry!.get(sourcePath);
    if (directMap && directMap.size > 0) {
      return { map: directMap, resolvedPath: sourcePath };
    }
    // (2) Try absolute-resolved — matches production-pipeline exportRegistry
    // keyed by post-`resolveModulePath` absolute paths. Use a dynamic require
    // to avoid the static dependency at this codegen module's import-time
    // (keeps the import surface lean + makes the function tree-shakeable
    // when no cross-file engines are used).
    if (sourcePath.startsWith("./") || sourcePath.startsWith("../")) {
      if (importerPath && importerPath.length > 0) {
        try {
          // Lazy require to avoid the import surface dependency.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { resolveModulePath } = require("../module-resolver.js");
          const absSource: string = resolveModulePath(sourcePath, importerPath);
          const absMap = exportRegistry!.get(absSource);
          if (absMap && absMap.size > 0) {
            return { map: absMap, resolvedPath: absSource };
          }
        } catch {
          // resolveModulePath unavailable or threw — fall through with
          // undefined map (caller short-circuits).
        }
      }
    }
    return { map: undefined, resolvedPath: sourcePath };
  }

  function visit(node: any): void {
    if (!node || typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);

    if (node.kind === "markup" && node.selfClosing === true && typeof node.tag === "string") {
      const tag = node.tag;
      const binding = importBindings.get(tag);
      if (binding) {
        const { map: sourceMap, resolvedPath } = lookupSourceMap(binding.sourcePath);
        if (sourceMap) {
          const exportInfo = sourceMap.get(binding.exportedName);
          if (exportInfo && exportInfo.category === "engine") {
            // De-dup: multiple use-sites of the same varName in one file
            // resolve to the SAME singleton — emit one marker site
            // descriptor (C15's emission writes one comment per unique
            // varName per file; the singleton invariant is global across
            // all use-sites). The de-dup also keeps the emitted marker
            // count proportional to the engine count, not the use-site
            // count.
            //
            // Note: this de-dup affects the EMITTED MARKER count. The
            // SINGLETON invariant is enforced at runtime via the shared
            // `_scrml_state` table — every use-site reads the same cell
            // regardless of how many marker comments are emitted.
            if (!seen.has(tag)) {
              seen.add(tag);
              orderedMounts.push({
                varName: tag,
                // Record the RESOLVED path so the marker comment is
                // unambiguous (production: absolute; harness: literal).
                exporterPath: resolvedPath,
                exportedName: binding.exportedName,
              });
            }
          }
        }
      }
    }

    // Recurse into children + body + consequent + alternate + arms.
    // Mirrors B14 PASS 10.B's recursion shape exactly so the walker visits
    // the same node set.
    if (Array.isArray(node.children)) for (const c of node.children) visit(c);
    if (Array.isArray(node.body)) for (const c of node.body) visit(c);
    if (Array.isArray(node.consequent)) for (const c of node.consequent) visit(c);
    if (Array.isArray(node.alternate)) for (const c of node.alternate) visit(c);
    if (Array.isArray(node.arms)) {
      for (const arm of node.arms) {
        if (arm && Array.isArray(arm.body)) for (const c of arm.body) visit(c);
      }
    }
  }

  const nodes: any[] = (fileAST.nodes as any[] | undefined)
    ?? (fileAST.ast?.nodes as any[] | undefined)
    ?? [];
  for (const n of nodes) visit(n);

  for (const m of orderedMounts) out.push(m);
  return out;
}

/**
 * Emit the §21.8 cross-file engine mount-position marker for a single mount
 * site. Mirrors C12's same-file `// §51.0.D engine mount position: …` pattern.
 *
 * Body rendering at the use-site DOM position is DEFERRED — same parser
 * blocker as C12/C13/C14 (`engine-statechild-parser.ts:14-21` — engine
 * state-child bodies are RAW TEXT today; no walkable AST). The marker
 * documents WHERE the imported engine renders so a follow-on body-render
 * emitter can locate the slot.
 *
 * The actual SINGLETON resolution + mount mechanism is:
 *   - Importer's `import { ... } from './engines.scrml'` is rewritten to
 *     `import { ... } from "./engines.client.js"` by `emit-client.ts:498-514`.
 *     The .client.js import is PRESERVED by the GITI-003 prune (line 869 of
 *     emit-client.ts) — never dropped, even when no symbol from the import
 *     is used in the importer's body, because the IMPORT's SIDE EFFECT
 *     (running the exporter's module-init code) IS the load-bearing reason
 *     to keep it.
 *   - Loading engines.client.js runs the exporter's
 *     `_scrml_reactive_set("appPhase", "Idle")` at module-init time.
 *   - The shared `_scrml_state` table (page-global classic-script lex env)
 *     surfaces the cell to all importers.
 *
 * @param site — the mount-site descriptor from `collectCrossFileEngineMounts`
 * @returns the marker-comment line
 */
export function emitCrossFileEngineMount(site: CrossFileEngineMountSite): string {
  return `// §21.8 cross-file engine mount: ${site.varName} from ${site.exporterPath} — singleton via shared _scrml_state — body rendering deferred to follow-on`;
}

/**
 * Emit the C15 substrate for every cross-file engine mount site in the file.
 *
 * Top-level orchestrator — sibling to `emitEngineSubstrate` (C12) and
 * `emitDerivedEngineSubstrateForFile` (C14). Returns an empty array when no
 * cross-file mount sites exist (lets the caller skip a section header
 * without checking length).
 *
 * Per SPEC §21.8 + §51.0.D — cross-file engine sharing is render-only at
 * the use-site; the engine's declaration in the EXPORTER file controls all
 * attributes. The IMPORTER's use-site emits ONLY the mount marker; the
 * engine's variant cell + transition table + derived projection (per C12 /
 * C13 / C14) all live in the EXPORTER's compiled output. The importer's
 * compiled JS includes the exporter's module via the standard import-rewrite
 * (handled by `emit-client.ts:498-514`); the side effect of that import's
 * module-init code populates the page-shared `_scrml_state`, giving the
 * importer transparent read access to the singleton cell.
 *
 * **Singleton verification at runtime:** multiple use-sites in the same
 * importer (or across different importers) MUST resolve to the same
 * `_scrml_reactive_get("varName")` cell. The walker above de-dups multiple
 * use-sites of the same varName at the EMITTED MARKER level; the runtime
 * singleton is enforced by the shared `_scrml_state` table itself (one map
 * keyed by varName → one cell value).
 *
 * @param fileAST — the importer file's AST (must have `_scope.importBindings`)
 * @param exportRegistry — MOD's exportRegistry (null = no cross-file detection)
 * @returns lines of JS code; empty array when no cross-file mounts exist
 */
export function emitCrossFileEngineMountsForFile(
  fileAST: any,
  exportRegistry: CrossFileExportRegistry | null | undefined,
): string[] {
  const sites = collectCrossFileEngineMounts(fileAST, exportRegistry);
  if (sites.length === 0) return [];

  const lines: string[] = [];
  for (const site of sites) {
    lines.push(emitCrossFileEngineMount(site));
  }
  return lines;
}
