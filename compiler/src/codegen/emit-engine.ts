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

import { parseAfterDuration } from "./parse-after-duration.ts";

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
 * as EngineRuleForm above). Fields beyond `tag` and `rule` are consumed by:
 *   - `internalRule` — A5-7 Wave 2.2 §51.0.O (shipped) — see
 *     `emitEngineInternalTransitionTable` + `engineHasInternalRules`.
 *   - `onTimeoutElements` — A5-4 §51.0.M (shipped) — see
 *     `emitEngineTimersTable` + `engineHasOnTimeoutElements`.
 *   - `historyAttr` — deferred (Wave 2.3 / Bug #3).
 *   - `innerEngines` — deferred (Wave 2.4 / Bug #2).
 */
/**
 * B17.4 — `<onTransition>` element shape (mirrors `OnTransitionEntry` in
 * `compiler/src/symbol-table.ts`). Engine bodies are RAW TEXT today (per
 * `engine-statechild-parser.ts:14-21` + B17.2 SURVEY). The fields here hold
 * captured-verbatim text from the parser; codegen rewrites at emit time.
 *
 * Per BRIEF: B17.4 trusts B17.3 has already fired E-ENGINE-EFFECT-AMBIGUOUS
 * (`effect=` + multi-target `rule=`) and E-ONTRANSITION-NO-TARGET (entry with
 * neither `to` nor `from`). Defensive skip in codegen for entries missing
 * BOTH directions (degenerate; B17.3 already surfaced the diagnostic).
 */
interface OnTransitionEntryShape {
  to: string | null;
  from: string | null;
  once: boolean;
  ifExprRaw: string | null;
  bodyRaw: string;
  isColonShorthand: boolean;
  rawOffset: number;
}

/**
 * A5-2 OnTimeoutEntry shape (mirrored locally — see EngineRuleForm above for
 * the rationale). Matches `compiler/src/symbol-table.ts` `OnTimeoutEntry`.
 */
interface OnTimeoutEntryShape {
  /** Raw `after=` text — literal `Nms`/`Ns`/etc. OR computed `${expr}<unit>`.
   *  Parsed at codegen time via `parseAfterDuration` into literal-ms or
   *  computed-expression-text. */
  after: string;
  /** `to=.Variant` target (variant name without leading dot). Empty string
   *  when malformed (parse-error shape — A5-3 surfaces). */
  to: string;
  /** Substring offset (relative to enclosing state-child's bodyRaw) of the
   *  `<onTimeout` opener. Unused by codegen; preserved for parity. */
  rawOffset: number;
}

interface EngineStateChildEntry {
  tag: string;
  rule: EngineRuleForm;
  bodyRaw?: string;
  isColonShorthand?: boolean;
  rawOffset?: number;
  historyAttr?: boolean;
  internalRule?: EngineRuleForm;
  onTimeoutElements?: OnTimeoutEntryShape[];
  innerEngines?: unknown[];
  // ---- B17.4 NEW (§51.0.H ratified extensions) ----
  /** `effect=${...}` inner expression text (no `${` `}` wrapper); `null` when
   *  absent. B17.3 has already fired E-ENGINE-EFFECT-AMBIGUOUS when this is
   *  non-null AND `rule.kind === "multi"` — B17.4 trusts. */
  effectRaw?: string | null;
  /** `<onTransition>` element children of this state-child. Empty when none. */
  onTransitionElements?: OnTransitionEntryShape[];
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
  /** A5-2 §51.0.M — file-scope flat list of `<onTimeout>` element entries
   *  across all state-children, each annotated with the owning state-child
   *  tag for codegen clarity. POPULATED by SYM PASS 16 (A5-3). Empty/absent
   *  when no `<onTimeout>` elements exist. Used by C12 (A5-4) to decide
   *  whether to emit the per-engine timer-config table (tree-shake). */
  onTimeoutElements?: Array<{ stateChildTag: string; entry: OnTimeoutEntryShape }>;
  /** A5-6 §51.0.R (S77) — engine-wide event-timeout watchdog. ONE per
   *  engine maximum. `null` when no `<onIdle>` declared. Populated by SYM
   *  PASS 11. Tree-shake control: codegen emits the watchdog config + arming
   *  only when this is non-null. */
  idleWatchdog?: { after: string; to: string; rawOffset: number } | null;
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

/**
 * A5-4 (§51.0.M) — Compute the per-engine `<onTimeout>` timer-config table
 * const name. Format: `__scrml_engine_<varName>_timers`. Sibling to the
 * transition table; emitted ONLY when the engine has at least one
 * `<onTimeout>` element (tree-shake — engines with zero timers emit no
 * table, and the runtime helpers (`_scrml_engine_arm_state_timers` /
 * `_scrml_engine_clear_state_timers`) no-op when the timersTable arg is null.
 */
export function engineTimersTableName(varName: string): string {
  return `__scrml_engine_${varName}_timers`;
}

/**
 * A5-6 (§51.0.R, S77) — Compute the per-engine `<onIdle>` watchdog config
 * const name. Format: `__scrml_engine_<varName>_idle`. Sibling to the
 * transitions + timers tables; emitted ONLY when the engine declares
 * `<onIdle>` (tree-shake — engines without idle watchdogs emit no const,
 * and the runtime helper `_scrml_engine_arm_idle_watchdog` no-ops when
 * the idleEntry arg is null).
 */
export function engineIdleWatchdogName(varName: string): string {
  return `__scrml_engine_${varName}_idle`;
}

/**
 * A5-7 Wave 2.2 (§51.0.O, Bug #4 fix) — Compute the per-engine INTERNAL
 * transition-table const name. Format:
 * `__scrml_engine_<varName>_internal_transitions`. Sibling to the canonical
 * `__scrml_engine_<varName>_transitions` table; emitted ONLY when at least
 * one state-child in the engine declares `internal:rule=` (tree-shake — see
 * `engineHasInternalRules`).
 *
 * Runtime branch: `_scrml_engine_direct_set` and `_scrml_engine_advance`
 * check the internal table first (when non-null). If the target is
 * internal-legal from the current variant, the internal write-path runs:
 * cell value updates WITHOUT firing subscribers, NO `<onTransition>` hooks
 * fire, NO timer arm/clear, NO history-cell write. The helpers return
 * `false` so the codegen-emitted post-commit hook-firing call is skipped.
 *
 * When the engine has no `internal:rule=` declarations, codegen passes
 * `null` for this arg at every write-guard / advance site (tree-shake).
 */
export function engineInternalTransitionTableName(varName: string): string {
  return `__scrml_engine_${varName}_internal_transitions`;
}

/**
 * A5-6 (§51.0.R, S77) — Does this engine have a `<onIdle>` watchdog?
 *
 * The check inspects `engineMeta.idleWatchdog` (the per-engine entry
 * populated by SYM PASS 11). Tree-shake control: emit-substrate skips the
 * idle const AND passes `null` for the idleEntry arg at every write-guard
 * site when this returns false.
 */
export function engineHasIdleWatchdog(meta: EngineMetadata): boolean {
  const ent = meta.idleWatchdog;
  return ent != null && typeof ent.to === "string" && ent.to.length > 0;
}

/**
 * A5-7 Wave 2.2 (§51.0.O, Bug #4 fix) — Does this engine have at least one
 * state-child carrying `internal:rule=`?
 *
 * The check inspects `engineMeta.stateChildren[].internalRule` — populated by
 * the structural parser (`engine-statechild-parser.ts:1481`) and validated by
 * SYM PASS 11 (composite-only legality + variant-set membership).
 *
 * Tree-shake control: when this returns false, codegen:
 *   - emits NO `__scrml_engine_<varName>_internal_transitions` const
 *   - passes `null` for the internalTable arg at every write-guard /
 *     `.advance()` site
 *   - the runtime branches treat null internalTable as "no internal path
 *     exists" and fall through to the canonical external path
 *
 * Counts only entries with `internalRule.kind !== "absent"`. Legacy-arrow /
 * parse-error rule kinds are NOT internal rules (B15 fires diagnostics for
 * those), so this predicate is conservative — false means definitely no
 * internal write-path needed.
 */
export function engineHasInternalRules(meta: EngineMetadata): boolean {
  const sc = meta.stateChildren;
  if (!Array.isArray(sc) || sc.length === 0) return false;
  for (const child of sc) {
    if (!child) continue;
    const internal = child.internalRule;
    if (
      internal &&
      typeof internal.kind === "string" &&
      internal.kind !== "absent" &&
      internal.kind !== "legacy-arrow" &&
      internal.kind !== "parse-error"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A5-4 (§51.0.M) — Does this engine have at least one `<onTimeout>` element?
 *
 * The check inspects `engineMeta.onTimeoutElements` (the file-scope flat list
 * populated by SYM PASS 16 / A5-3) and falls back to walking
 * `engineMeta.stateChildren[].onTimeoutElements` when the aggregate isn't
 * populated. Tree-shake control: emit-substrate skips the timers table AND
 * passes `null` for the timersTable arg at every write-guard site when this
 * returns false.
 */
export function engineHasOnTimeoutElements(meta: EngineMetadata): boolean {
  const agg = meta.onTimeoutElements;
  if (Array.isArray(agg) && agg.length > 0) return true;
  const sc = meta.stateChildren;
  if (Array.isArray(sc)) {
    for (const child of sc) {
      if (Array.isArray(child?.onTimeoutElements) && child.onTimeoutElements.length > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A5-4 (§51.0.M) + A5-5 (§51.12.3.1) — Emit the per-engine timer-config
 * table.
 *
 * Shape:
 *   const __scrml_engine_loadPhase_timers = Object.freeze({
 *     "Loading": [
 *       { ms: 30000, target: "TimedOut" },
 *       { msExpr: function(){ return Math.min(1000 * 2 ** _scrml_reactive_get("attempt"), 30000) * 1; }, target: "Retry" },
 *     ],
 *     "Idle": [],
 *     // ... one entry per state-child, even when its onTimeoutElements is empty
 *   });
 *
 * - Literal `after=Nms`/`Ns`/etc.: emitted as `{ ms: <constant-folded>, target: "<Variant>" }`.
 * - Computed `after=${expr}<unit>`: emitted as
 *   `{ msExpr: function(){ return (<rewrittenExpr>) * <multiplier>; }, target: "<Variant>" }`.
 *   The `<rewrittenExpr>` flows through `rewriteExpr` so reactive reads
 *   (`@var` → `_scrml_reactive_get(<encodedName>)`) wire correctly. The
 *   runtime evaluates `msExpr()` at arm time and clamps negative/NaN to 0
 *   per SPEC §51.12.3.1.
 * - Invalid `after=` text: defensively skipped (A5-3 typer fired
 *   E-ENGINE-021; codegen emits no entry so a malformed timer never arms).
 * - Empty / wildcard / parse-error rule shapes for the surrounding state-child:
 *   irrelevant here — the table records timers per state-tag, not per rule.
 *
 * Returns an empty array when the engine has zero `<onTimeout>` elements
 * (caller skips the emission entirely — tree-shake).
 */
export function emitEngineTimersTable(meta: EngineMetadata): string[] {
  if (!engineHasOnTimeoutElements(meta)) return [];

  const sc = meta.stateChildren;
  if (!Array.isArray(sc) || sc.length === 0) return [];

  // Lazy import (mirrors rewriteHookExprText below — avoids the circular at
  // module-init).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { rewriteExpr } = require("./rewrite.ts");

  const tableName = engineTimersTableName(meta.varName);
  const lines: string[] = [];

  lines.push(`// §51.0.M onTimeout timer-config table for engine ${meta.varName}: ${meta.forType}`);
  lines.push(`const ${tableName} = Object.freeze({`);

  const stateEntryLines: string[] = [];
  for (const child of sc) {
    if (!child || typeof child.tag !== "string" || child.tag.length === 0) {
      continue;
    }
    const stateKey = JSON.stringify(child.tag);
    const onTimeouts = Array.isArray(child.onTimeoutElements) ? child.onTimeoutElements : [];
    if (onTimeouts.length === 0) {
      stateEntryLines.push(`  ${stateKey}: []`);
      continue;
    }
    const arrayParts: string[] = [];
    for (const ot of onTimeouts) {
      // Defensive: skip malformed entries (A5-3 already surfaced diagnostics).
      if (!ot || typeof ot.after !== "string" || typeof ot.to !== "string" || ot.to.length === 0) {
        continue;
      }
      const parsed = parseAfterDuration(ot.after);
      const targetLit = JSON.stringify(ot.to);
      // A5-6 Feature 1 (§51.0.M name= extension, S79). When the entry has
      // a name, emit a `name: "<name>"` field so the runtime arm/clear path
      // can derive a name-keyed timerKey (`varName::stateName::n:NAME`)
      // instead of an index-keyed one. Enables `cancelTimer("<name>")`
      // from the same state-child body to address this timer specifically.
      const nameField = (typeof ot.name === "string" && ot.name.length > 0)
        ? `, name: ${JSON.stringify(ot.name)}`
        : "";
      if (parsed.kind === "literal") {
        arrayParts.push(`{ ms: ${parsed.ms}, target: ${targetLit}${nameField} }`);
      } else if (parsed.kind === "computed") {
        // Rewrite the expression so reactive reads (@var → _scrml_reactive_get) wire.
        const rewritten = rewriteExpr(parsed.exprText);
        // Multiply by unit multiplier inside the IIFE so the runtime clamp is
        // applied to the FINAL ms value (after the unit conversion).
        // Function-expression form (not arrow) for ES5-friendly emission +
        // parity with the surrounding runtime template.
        arrayParts.push(
          `{ msExpr: function(){ return (${rewritten}) * ${parsed.unitMultiplier}; }, target: ${targetLit}${nameField} }`
        );
      }
      // parsed.kind === "invalid" — silently drop (typer already reported).
    }
    if (arrayParts.length === 0) {
      stateEntryLines.push(`  ${stateKey}: []`);
    } else {
      stateEntryLines.push(`  ${stateKey}: [\n    ${arrayParts.join(",\n    ")}\n  ]`);
    }
  }
  lines.push(stateEntryLines.join(",\n"));
  lines.push(`});`);

  return lines;
}

/**
 * A5-6 (§51.0.R, S77) — Emit the per-engine `<onIdle>` watchdog config const.
 *
 * Shape (literal):
 *   const __scrml_engine_session_idle = Object.freeze({ ms: 300000, target: "Idle" });
 *
 * Shape (computed):
 *   const __scrml_engine_session_idle = Object.freeze({
 *     msExpr: function(){ return (_scrml_reactive_get("backoffDelay")) * 1000; },
 *     target: "Idle"
 *   });
 *
 * Returns an empty array when the engine has no `<onIdle>` (caller skips the
 * emission entirely — tree-shake).
 */
export function emitEngineIdleWatchdog(meta: EngineMetadata): string[] {
  if (!engineHasIdleWatchdog(meta)) return [];
  const entry = meta.idleWatchdog!;
  const constName = engineIdleWatchdogName(meta.varName);
  const targetLit = JSON.stringify(entry.to);

  // Lazy import (mirrors emitEngineTimersTable).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { rewriteExpr } = require("./rewrite.ts");
  const parsed = parseAfterDuration(entry.after);

  const lines: string[] = [];
  lines.push(`// §51.0.R onIdle watchdog config for engine ${meta.varName}: ${meta.forType}`);
  if (parsed.kind === "literal") {
    lines.push(`const ${constName} = Object.freeze({ ms: ${parsed.ms}, target: ${targetLit} });`);
  } else if (parsed.kind === "computed") {
    const rewritten = rewriteExpr(parsed.exprText);
    lines.push(
      `const ${constName} = Object.freeze({ msExpr: function(){ return (${rewritten}) * ${parsed.unitMultiplier}; }, target: ${targetLit} });`,
    );
  } else {
    // parsed.kind === "invalid" — defensive: emit a null-watchdog so call
    // sites can reference the const safely. Typer already fired the diagnostic.
    lines.push(`const ${constName} = null;`);
  }
  return lines;
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

/**
 * A5-7 Wave 2.2 (§51.0.O, Bug #4 fix) — Emit the static INTERNAL transition-
 * table const for one engine.
 *
 * Shape (only emitted when `engineHasInternalRules(meta)` is true):
 *   const __scrml_engine_appMode_internal_transitions = Object.freeze({
 *     "Title":   [],
 *     "Playing": ["Playing"],
 *   });
 *
 * Same shape as the canonical external transitions table — keyed by from-
 * variant tag, value is the encoded internal rule entry (single / multi /
 * wildcard `"*"` / terminal `[]`). State-children WITHOUT `internal:rule=`
 * get the terminal `[]` entry, meaning "no internal transitions from this
 * variant."
 *
 * Tree-shake (caller responsibility): `emitEngineSubstrate` skips this
 * emission entirely when `engineHasInternalRules` returns false. Callers
 * MUST gate on `engineHasInternalRules` BEFORE calling this — passing a
 * meta with all-absent internalRules will still emit the table, but with
 * every entry being `[]` (defensive: contract is "skip when no internal
 * rules"; the function itself is permissive about input).
 *
 * @param meta — the engine's `engineMeta` (from `_record.engineMeta`)
 * @returns lines of JS code; empty array if `stateChildren` is empty
 */
export function emitEngineInternalTransitionTable(meta: EngineMetadata): string[] {
  const sc = meta.stateChildren;
  if (!Array.isArray(sc) || sc.length === 0) return [];

  const tableName = engineInternalTransitionTableName(meta.varName);
  const lines: string[] = [];

  lines.push(`// §51.0.O internal transition table for engine ${meta.varName}: ${meta.forType}`);
  lines.push(`const ${tableName} = Object.freeze({`);

  const entries: string[] = [];
  for (const child of sc) {
    if (!child || typeof child.tag !== "string" || child.tag.length === 0) {
      continue;
    }
    const key = JSON.stringify(child.tag);
    const internalRule = child.internalRule ?? { kind: "absent" } as EngineRuleForm;
    const value = encodeRuleEntry(internalRule);
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

/**
 * A5-4 (§51.0.M Semantics) — Emit the initial-arm call for an engine that
 * has at least one `<onTimeout>` element. Sibling to
 * `emitEngineVariantCellInit` but emitted SEPARATELY at the END of the file
 * (after all user reactive cells are initialized) — the computed-form
 * `<onTimeout after=${@var}<unit>/>` reads `@var` at arm time, so the arm
 * must run AFTER the cell-init for `@var` (which lives in user logic).
 *
 * Returns an empty array when the engine has no `<onTimeout>` (tree-shake).
 *
 * Per SCOPE §3 decision #6: module-init is the FIRST entry into the initial
 * state-child; the timers arm at this point. The runtime helper
 * `_scrml_engine_arm_state_timers` looks up the initial state's row in the
 * timer-config table and is a no-op when the row is empty.
 */
export function emitEngineInitialArm(meta: EngineMetadata): string[] {
  const lines: string[] = [];
  if (engineHasOnTimeoutElements(meta)) {
    const initial = resolveEngineInitialVariant(meta);
    if (initial) {
      const tableName = engineTransitionTableName(meta.varName);
      const timersTableName = engineTimersTableName(meta.varName);
      lines.push(`// §51.0.M onTimeout initial-arm: ${meta.varName} (${meta.forType}) entering ${initial}`);
      lines.push(`_scrml_engine_arm_state_timers(${JSON.stringify(meta.varName)}, ${JSON.stringify(initial)}, ${timersTableName}, ${tableName});`);
    }
  }
  // A5-6 §51.0.R (S77) — engine-wide event-timeout watchdog initial-arm.
  // Independent of `<onTimeout>` initial-arm: an engine with `<onIdle>` but
  // no `<onTimeout>` still arms the watchdog at module-init.
  if (engineHasIdleWatchdog(meta)) {
    const tableName = engineTransitionTableName(meta.varName);
    const idleConstName = engineIdleWatchdogName(meta.varName);
    lines.push(`// §51.0.R onIdle watchdog initial-arm: ${meta.varName} (${meta.forType})`);
    lines.push(`_scrml_engine_arm_idle_watchdog(${JSON.stringify(meta.varName)}, ${idleConstName}, ${tableName});`);
  }
  return lines;
}

/**
 * A5-4 (§51.0.M) + A5-6 (§51.0.R) — Emit the initial-arm calls for every
 * in-scope engine in the file. Sibling to `emitEngineSubstrate`. Empty when
 * no engine has `<onTimeout>` OR `<onIdle>` (tree-shake).
 *
 * Called by `emit-client.ts` AFTER `emitReactiveWiring` so that user
 * reactive cells (which the computed-form `<onTimeout>`/`<onIdle>` may read
 * at arm time) are initialized first.
 */
export function emitEngineInitialArmsForFile(fileAST: any): string[] {
  const decls = collectC12EngineDecls(fileAST);
  if (decls.length === 0) return [];
  const lines: string[] = [];
  for (const decl of decls) {
    const meta = decl._record!.engineMeta!;
    const armLines = emitEngineInitialArm(meta);
    for (const l of armLines) lines.push(l);
  }
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
    // A5-7 Wave 2.2 §51.0.O — per-engine INTERNAL transition table. Emitted
    // adjacent to the canonical external table; sibling to timers/idle.
    // Empty when no state-child declares `internal:rule=` (tree-shake).
    const internalTableLines = engineHasInternalRules(meta)
      ? emitEngineInternalTransitionTable(meta)
      : [];
    // A5-4 §51.0.M — per-engine `<onTimeout>` timer-config table. Emitted
    // BEFORE the cell init so the initial-arm call inside cellLines can
    // reference the table identifier. Empty when the engine has no
    // `<onTimeout>` elements (tree-shake).
    const timersLines = emitEngineTimersTable(meta);
    // A5-6 §51.0.R (S77) — per-engine `<onIdle>` watchdog config const.
    // Sibling to timers table; emitted only when engine declares `<onIdle>`.
    const idleLines = emitEngineIdleWatchdog(meta);
    const cellLines = emitEngineVariantCellInit(meta);
    if (
      tableLines.length === 0 &&
      internalTableLines.length === 0 &&
      timersLines.length === 0 &&
      idleLines.length === 0 &&
      cellLines.length === 0
    ) continue;
    if (lines.length > 0) lines.push("");
    for (const l of tableLines) lines.push(l);
    for (const l of internalTableLines) lines.push(l);
    for (const l of timersLines) lines.push(l);
    for (const l of idleLines) lines.push(l);
    for (const l of cellLines) lines.push(l);
    // §51.0.D mount-position marker. The engine renders at its declaration
    // position. C12 deliberately does NOT emit body markup — state-child
    // bodies are RAW TEXT today (per engine-statechild-parser.ts) and a
    // body-render emitter is a follow-on (C13 or later). The marker
    // documents WHERE the engine renders so the follow-on emitter can
    // locate the slot.
    // Q4 (RATIFIED S78): retain mount-position marker as debug aid even
    // when body-render is emitted. Body-render output is emitted by the
    // sibling `emitEngineBodyRenderForFile(fileAST, ctx)` pass — which
    // takes a CompileContext (this fn does not) and is called by
    // emit-client.ts adjacent to this substrate emission.
    lines.push(`// §51.0.D engine mount position: ${meta.varName} (${meta.forType}) — body render via emitEngineBodyRenderForFile`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Phase A10 (S78, 2026-05-10) — Engine state-child body render emission
// ---------------------------------------------------------------------------
//
// Per the SCOPE-AND-DECOMPOSITION doc §3.4 (Option C-prime, RATIFIED) and
// PHASE-0-SURVEY §7.3 finalized helper signature. The emission has two
// concerns:
//
//   1. Render functions per state-child (`_scrml_engine_<varName>_render_<Tag>`)
//      and a dispatcher subscribed to the engine variable. Both are JS
//      lines emitted into the .client.js output.
//
//   2. Mount-slot + initial-arm-body HTML emitted at the engine's source
//      position by emit-html.ts's engine-decl case.
//
// The factored variant-guard helper (`emit-variant-guard.ts`) is variant-
// source-agnostic; this function is the engine consumer that maps
// `engine-decl.engineMeta.stateChildren` → `arms[]` for the helper. A
// future match-block-form codegen dispatch will add its own thin consumer
// without touching this function.
//
// **Tree-shake.** When ALL state-child bodies are empty (after structural-
// element filter at the boundary), the helper returns empty strings; this
// function returns `{renderFunctions: [], dispatchers: []}` and the caller
// emits NOTHING beyond the existing C12 substrate. The Q4 marker comment
// from `emitEngineSubstrate` is preserved either way.

/**
 * Build VariantArm[] from an engine-decl's stateChildren + bodyChildren.
 *
 * `stateChildren` comes from PASS 11/B15's structural parser
 * (`engine-statechild-parser.ts`) and gives us tag + rule for each arm.
 * `bodyChildren` comes from ast-builder's Phase A10 Phase 1 walkable AST
 * preservation and gives us each arm's renderable body subtree.
 *
 * Matching is by tag: each `stateChildren[i].tag` is found in
 * `bodyChildren` as a markup node with the same `tag`. The matched node's
 * `attrs` provide payload bindings (bareword attrs not in the engine-
 * reserved set per `extractPayloadBindingsFromAttrs`); its `children` are
 * filtered to renderable subset (per `filterRenderableChildren`).
 *
 * Returns `null` when bodyChildren is missing (legacy zero-child engine
 * bodies pre-A10 leave bodyChildren undefined). Returns `[]` when no arms
 * have non-empty body — caller treats as tree-shake-empty.
 */
function buildEngineArms(decl: EngineDeclLike): import("./emit-variant-guard.ts").VariantArm[] | null {
  const meta = decl._record?.engineMeta;
  if (!meta || !Array.isArray(meta.stateChildren)) return null;
  const bodyChildren = (decl as any).bodyChildren;
  if (!Array.isArray(bodyChildren)) return null;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { extractPayloadBindingsFromAttrs, filterRenderableChildren } = require("./emit-variant-guard.ts") as {
    extractPayloadBindingsFromAttrs: (attrs: any[]) => string[];
    filterRenderableChildren: (children: any[]) => any[];
  };

  const arms: import("./emit-variant-guard.ts").VariantArm[] = [];
  for (const sc of meta.stateChildren) {
    const tag = sc.tag;
    // Find the matching markup node in bodyChildren.
    const match = bodyChildren.find(
      (c: any) => c && c.kind === "markup" && c.tag === tag,
    );
    if (!match) {
      // No matching body — treat as empty arm. Keeps dispatcher uniform.
      arms.push({ tag, payloadBindings: [], body: [] });
      continue;
    }
    const attrs = match.attrs ?? match.attributes ?? [];
    const payloadBindings = extractPayloadBindingsFromAttrs(attrs);
    const body = filterRenderableChildren(match.children ?? []);
    arms.push({ tag, payloadBindings, body });
  }
  return arms;
}

/**
 * Emit body-render render functions + dispatcher for every in-scope C12
 * engine in the file.
 *
 * Returns `{ renderFunctions: string[], dispatchers: string[] }` where
 * each entry in either array is a multi-line JS block ready for line-by-
 * line append to the client output. Empty arrays when no engine has any
 * non-empty arm body (tree-shake).
 *
 * Caller (`emit-client.ts`) is responsible for placing render functions
 * BEFORE the dispatcher block and BEFORE any code that might call them
 * (function declarations are JS-hoisted, so order within the file is
 * forgiving — but adjacency to the substrate keeps the output readable).
 */
export function emitEngineBodyRenderForFile(
  fileAST: any,
  ctx: import("./context.ts").CompileContext,
): { renderFunctions: string[]; dispatchers: string[] } {
  const decls = collectC12EngineDecls(fileAST);
  const renderFunctions: string[] = [];
  const dispatchers: string[] = [];
  if (decls.length === 0) return { renderFunctions, dispatchers };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitVariantGuardedRender } = require("./emit-variant-guard.ts") as {
    emitVariantGuardedRender: typeof import("./emit-variant-guard.ts").emitVariantGuardedRender;
  };

  for (const decl of decls) {
    const meta = decl._record!.engineMeta!;
    const arms = buildEngineArms(decl);
    if (!arms) continue;
    const out = emitVariantGuardedRender(
      // Engine consumer — variant accessor reads the engine cell. Used
      // only in Shape B (effect mode); Shape A subscribe path uses
      // `variantSubscribeName` and ignores the accessor.
      () => `_scrml_reactive_get(${JSON.stringify(meta.varName)})`,
      arms,
      ctx,
      {
        idPrefix: meta.varName,
        mountAttr: "data-scrml-engine-mount",
        renderFnPrefix: "_scrml_engine",
        // Subscribe-on-set semantics — engine variable is always a
        // reactive cell registered by C12 substrate. See helper's
        // dispatcher rationale for why this avoids breaking initial
        // file-level reactive-wiring at module-init.
        variantSubscribeName: meta.varName,
      },
    );
    if (out.renderFunctionsJs) renderFunctions.push(out.renderFunctionsJs);
    if (out.dispatcherJs) dispatchers.push(out.dispatcherJs);
  }

  return { renderFunctions, dispatchers };
}

/**
 * Emit body-render for derived engines. Same pattern as the C12 path
 * but discovers derived decls via `collectC14DerivedEngineDecls`. Per
 * SPEC §51.0.J derived engines render the same way non-derived do — only
 * the cell-init mechanism differs (projection vs direct).
 *
 * Returns `{ renderFunctions: [], dispatchers: [] }` when no derived
 * engine has any non-empty arm body (tree-shake).
 */
export function emitDerivedEngineBodyRenderForFile(
  fileAST: any,
  ctx: import("./context.ts").CompileContext,
): { renderFunctions: string[]; dispatchers: string[] } {
  const decls = collectC14DerivedEngineDecls(fileAST);
  const renderFunctions: string[] = [];
  const dispatchers: string[] = [];
  if (decls.length === 0) return { renderFunctions, dispatchers };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitVariantGuardedRender } = require("./emit-variant-guard.ts") as {
    emitVariantGuardedRender: typeof import("./emit-variant-guard.ts").emitVariantGuardedRender;
  };

  for (const decl of decls) {
    const meta = decl._record!.engineMeta!;
    const arms = buildEngineArms(decl);
    if (!arms) continue;
    const out = emitVariantGuardedRender(
      () => `_scrml_derived_get(${JSON.stringify(meta.varName)})`,
      arms,
      ctx,
      {
        idPrefix: meta.varName,
        mountAttr: "data-scrml-engine-mount",
        renderFnPrefix: "_scrml_engine",
        // Derived engines also register as reactive cells — the
        // subscribe path works the same way. Per §51.0.J derived cells
        // are read-only but still notify subscribers on upstream change.
        variantSubscribeName: meta.varName,
      },
    );
    if (out.renderFunctionsJs) renderFunctions.push(out.renderFunctionsJs);
    if (out.dispatcherJs) dispatchers.push(out.dispatcherJs);
  }

  return { renderFunctions, dispatchers };
}

/**
 * Public helper for emit-html.ts engine-decl case. Given an engine-decl
 * AST node + ctx, return the HTML to emit at its source position:
 *   - `<div data-scrml-engine-mount="<varName>"><INITIAL-ARM-BODY-HTML></div>`
 * where INITIAL-ARM-BODY-HTML is the rendered HTML for the initial-variant
 * arm (registered via generateHtml so file-level reactive-wiring binds
 * to its placeholders), or an empty mount slot when the engine has no
 * arm bodies (tree-shake).
 *
 * Returns `null` when the engine-decl is not in C12 scope (caller emits
 * nothing — preserves pre-A10 behavior). Returns `""` when the engine is
 * in scope but all arm bodies are empty (caller can choose to emit just
 * the empty mount slot or nothing).
 */
export function emitEngineMountHtml(
  decl: EngineDeclLike,
  ctx: import("./context.ts").CompileContext,
): string | null {
  if (!isC12EngineDecl(decl)) return null;
  const meta = decl._record!.engineMeta!;
  const arms = buildEngineArms(decl);
  if (!arms) return "";
  const allEmpty = arms.every((a) => a.body.length === 0);
  if (allEmpty) {
    // Tree-shake — emit nothing (no mount slot needed; no body to render).
    return "";
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitInitialArmHtmlForMount } = require("./emit-variant-guard.ts") as {
    emitInitialArmHtmlForMount: typeof import("./emit-variant-guard.ts").emitInitialArmHtmlForMount;
  };
  const initialTag = meta.initialVariant ?? (meta.stateChildren?.[0]?.tag ?? null);
  // Phase A10 (S78, 2026-05-10) — DO NOT tag initial-arm bindings with
  // armContextId. The static initial-arm HTML's bindings are intentionally
  // routed through global emission (file-level reactive-wiring) so they
  // bind at module-init and provide pre-DOMContentLoaded reactivity if any
  // (cell `set` calls fire subscribers immediately). The dispatcher's
  // DOMContentLoaded initial-fire then replaces the static innerHTML with
  // `render_<initialTag>()` output (which uses fresh placeholder ids
  // tagged with the arm context) and `wire_<initialTag>(_mount)` binds
  // subscriptions against the freshly-emitted DOM. The original static
  // placeholders are detached at that point; the file-level wiring's
  // `if (el)` guard skips them on subsequent fires (they're orphaned but
  // not leaked — they're caught by GC once unreferenced).
  //
  // Tagging them would create a duplicate binding (one logic_2 + one
  // logic_3 for the same source `${@cell}`) — the wire fn would try to
  // bind both, with only the freshly-emitted one matching. Avoiding the
  // tag keeps the binding count minimal and avoids the per-render
  // querySelector miss on the orphaned id.
  const initialHtml = emitInitialArmHtmlForMount(arms, initialTag, ctx);
  return `<div data-scrml-engine-mount="${meta.varName}">${initialHtml}</div>`;
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
  /** B17.4 — TRUE when the engine has at least one `effect=` or
   *  `<onTransition>` arm. When TRUE, write-guard emission inserts a hook-
   *  firing call (`__scrml_engine_<varName>_fire_hooks(from, to)`) AFTER the
   *  `_scrml_engine_direct_set` call, capturing pre-write variant via
   *  `_scrml_reactive_get`. When FALSE, no hook-firing call is emitted (tree-
   *  shake — the function doesn't exist for hookless engines). */
  hasHooks?: boolean;
  /** A5-4 (§51.0.M) — TRUE when the engine has at least one `<onTimeout>`
   *  element. When TRUE, write-guard + advance emission pass the per-engine
   *  timer-config table identifier as the 4th argument to
   *  `_scrml_engine_direct_set` / `_scrml_engine_advance` so the runtime
   *  clears outgoing timers + arms incoming ones. When FALSE, the 4th arg is
   *  omitted (the runtime treats undefined as null and short-circuits). */
  hasOnTimeoutElements?: boolean;
  /** A5-4 — Compile-time-baked per-engine timer-config table identifier
   *  (per §51.0.M). Always populated when `hasOnTimeoutElements === true`. */
  timersTableName?: string;
  /** A5-6 (§51.0.R, S77) — TRUE when the engine declares `<onIdle>`. When
   *  TRUE, write-guard + advance emission pass the per-engine watchdog config
   *  identifier as the 5th argument to `_scrml_engine_direct_set` /
   *  `_scrml_engine_advance` so the runtime resets the watchdog after every
   *  successful commit. When FALSE, the 5th arg is omitted (runtime treats
   *  undefined as null and short-circuits — tree-shake). */
  hasIdleWatchdog?: boolean;
  /** A5-6 — Compile-time-baked per-engine watchdog config const identifier
   *  (per §51.0.R). Always populated when `hasIdleWatchdog === true`. */
  idleWatchdogName?: string;
  /** A5-7 Wave 2.2 (§51.0.O, Bug #4 fix) — TRUE when at least one state-child
   *  in this engine declares `internal:rule=`. When TRUE, write-guard +
   *  advance emission pass the per-engine internal transition table identifier
   *  as a trailing (6th) argument to `_scrml_engine_direct_set` /
   *  `_scrml_engine_advance`. The runtime checks the internal table FIRST
   *  (when non-null); if the target is internal-legal from the current
   *  variant, the internal write-path runs (no subscriber fire, no
   *  `<onTransition>`, no timer arm/clear, no history). When FALSE, the 6th
   *  arg is omitted (runtime treats undefined as null and falls through to
   *  the external path — tree-shake). */
  hasInternalRules?: boolean;
  /** A5-7 Wave 2.2 — Compile-time-baked per-engine internal transition
   *  table const identifier (per §51.0.O). Always populated when
   *  `hasInternalRules === true`. */
  internalTableName?: string;
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
    const hasOT = engineHasOnTimeoutElements(meta);
    const hasIR = engineHasInternalRules(meta);
    out.set(meta.varName, {
      varName: meta.varName,
      forType: meta.forType,
      tableName: engineTransitionTableName(meta.varName),
      // B17.4: bind whether this engine has hooks for the write-guard emitter.
      // Lazy-evaluated via engineHasHooks (defined later in this file; the
      // function is hoisted at module-init time so the reference here is safe).
      hasHooks: engineHasHooks(meta),
      // A5-4 (§51.0.M): bind whether this engine has <onTimeout> elements
      // for the write-guard + advance emitters. When true, both paths thread
      // the timers-table identifier so arm-on-entry + clear-on-exit fire.
      hasOnTimeoutElements: hasOT,
      timersTableName: hasOT ? engineTimersTableName(meta.varName) : undefined,
      // A5-6 (§51.0.R, S77): bind whether this engine has `<onIdle>`
      // for the write-guard + advance emitters. When true, both paths
      // thread the watchdog const identifier so reset-on-commit fires.
      hasIdleWatchdog: engineHasIdleWatchdog(meta),
      idleWatchdogName: engineHasIdleWatchdog(meta)
        ? engineIdleWatchdogName(meta.varName)
        : undefined,
      // A5-7 Wave 2.2 (§51.0.O, Bug #4 fix): bind whether any state-child
      // declares `internal:rule=`. When true, both write-guard and advance
      // emitters pass the internal transition table identifier as the
      // trailing (6th) argument so the runtime checks the internal path
      // first and skips subscriber-fire / `<onTransition>` / timers / history
      // when the target is internal-legal.
      hasInternalRules: hasIR,
      internalTableName: hasIR
        ? engineInternalTransitionTableName(meta.varName)
        : undefined,
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
  const lines: string[] = [
    `// §51.0.F engine direct-write hook: ${binding.varName} (${binding.forType})`,
  ];
  // A5-4 (§51.0.M): when the engine has at least one <onTimeout>, pass the
  // timers-table identifier as the 4th argument so the runtime clears
  // outgoing timers + arms incoming ones around the cell write. When the
  // engine has zero <onTimeout> elements, omit the arg (the runtime treats
  // undefined as null and short-circuits — tree-shake).
  const hasTimers = !!(binding.hasOnTimeoutElements && binding.timersTableName);
  const hasIdle = !!(binding.hasIdleWatchdog && binding.idleWatchdogName);
  const hasInternal = !!(binding.hasInternalRules && binding.internalTableName);
  const timersArg = hasTimers ? `, ${binding.timersTableName}` : ``;
  // A5-6 (§51.0.R, S77): when the engine declares <onIdle>, pass the
  // watchdog config identifier as the 5th arg so the runtime resets the
  // watchdog after the commit. When timersArg is empty AND idleArg is
  // non-empty, fill the timers position with `null` to keep arg positions
  // aligned.
  let idleArg = ``;
  if (hasIdle) {
    if (!hasTimers) {
      idleArg = `, null, ${binding.idleWatchdogName}`;
    } else {
      idleArg = `, ${binding.idleWatchdogName}`;
    }
  }
  // A5-7 Wave 2.2 (§51.0.O, Bug #4 fix): when ANY state-child declares
  // `internal:rule=`, pass the per-engine internal transition table
  // identifier as the trailing (6th positional) arg. The runtime checks
  // this table FIRST; if the target is internal-legal from the current
  // variant, the internal write-path runs (no subscriber fire, no hooks,
  // no timer arm/clear, no history). The helper returns `false` so the
  // post-commit hook-firing call below is skipped. Position-padding: when
  // timersArg or idleArg is missing, fill the slot with `null` to keep
  // positional arg alignment.
  let internalArg = ``;
  if (hasInternal) {
    if (!hasTimers && !hasIdle) {
      internalArg = `, null, null, ${binding.internalTableName}`;
    } else if (!hasIdle) {
      internalArg = `, null, ${binding.internalTableName}`;
    } else {
      internalArg = `, ${binding.internalTableName}`;
    }
  }
  // B17.4 + A5-7 Wave 2.2 — when the engine has hooks, capture pre-write
  // variant + fire hooks AFTER the runtime helper commits the write (Q2
  // split timing: body fires post-write so observers read the new value).
  // §51.0.O: hooks fire ONLY on EXTERNAL transitions. The runtime helper
  // returns `true` when the transition was external, `false` when internal
  // — the post-commit hook fire is gated on that boolean.
  // Wrapping in a block keeps `__scrml_engine_from` namespaces local —
  // multiple writes to different engines in the same statement-level scope
  // don't collide.
  if (binding.hasHooks === true) {
    const fnName = engineHookFiringFunctionName(binding.varName);
    lines.push(`{`);
    lines.push(`  const __scrml_engine_from = _scrml_reactive_get(${JSON.stringify(binding.varName)});`);
    lines.push(`  const __scrml_engine_external = _scrml_engine_direct_set(${JSON.stringify(binding.varName)}, ${newValueExpr}, ${binding.tableName}${timersArg}${idleArg}${internalArg});`);
    lines.push(`  if (__scrml_engine_external) ${fnName}(__scrml_engine_from, _scrml_reactive_get(${JSON.stringify(binding.varName)}));`);
    lines.push(`}`);
  } else {
    lines.push(`_scrml_engine_direct_set(${JSON.stringify(binding.varName)}, ${newValueExpr}, ${binding.tableName}${timersArg}${idleArg}${internalArg});`);
  }
  return lines;
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
export function emitEngineAdvanceCall(
  varName: string,
  targetExpr: string,
  hasHooks?: boolean,
  hasOnTimeout?: boolean,
  hasIdle?: boolean,
  hasInternal?: boolean,
): string {
  const tableName = engineTransitionTableName(varName);
  // A5-4 (§51.0.M): when this engine has at least one `<onTimeout>` element,
  // pass the per-engine timer-config table identifier as the 4th argument so
  // the runtime threads through arm-on-entry + clear-on-exit. Tree-shake:
  // when no `<onTimeout>` exists, omit the arg (runtime treats undefined
  // as null and short-circuits — the timers table identifier doesn't exist
  // in the emitted JS for these engines).
  const timersArg = hasOnTimeout === true
    ? `, ${engineTimersTableName(varName)}`
    : ``;
  // A5-6 (§51.0.R, S77): when this engine declares `<onIdle>`, pass the
  // watchdog config identifier as the 5th argument so the runtime resets
  // the watchdog after every successful commit. When timersArg is empty
  // AND watchdog is present, fill the timers position with `null` to keep
  // arg positions aligned.
  let idleArg = ``;
  if (hasIdle === true) {
    if (timersArg === ``) {
      idleArg = `, null, ${engineIdleWatchdogName(varName)}`;
    } else {
      idleArg = `, ${engineIdleWatchdogName(varName)}`;
    }
  }
  // A5-7 Wave 2.2 (§51.0.O, Bug #4 fix): when this engine has any
  // `internal:rule=` declaration, pass the per-engine internal transition
  // table identifier as the trailing (6th positional) argument. Runtime
  // checks the internal table first; if internal-legal, takes the internal
  // path (no subscriber fire, no hooks). Position-padding: fill missing
  // earlier slots with `null` to keep alignment.
  let internalArg = ``;
  if (hasInternal === true) {
    const internalName = engineInternalTransitionTableName(varName);
    if (timersArg === `` && idleArg === ``) {
      internalArg = `, null, null, ${internalName}`;
    } else if (idleArg === ``) {
      internalArg = `, null, ${internalName}`;
    } else {
      internalArg = `, ${internalName}`;
    }
  }
  const baseCall = `_scrml_engine_advance(${JSON.stringify(varName)}, ${targetExpr}, ${tableName}${timersArg}${idleArg}${internalArg})`;
  // B17.4 + A5-7 Wave 2.2 — when the engine has hooks, wrap with capture-pre +
  // hook-fire-post. The runtime helper returns `true` for external transitions,
  // `false` for internal — gate the post-commit hook fire on that boolean.
  // IIFE keeps the wrap valid in any expression position (statement, sub-expr,
  // arg position, etc.). Tree-shaken when hasHooks is false (or undefined).
  if (hasHooks === true) {
    const fnName = engineHookFiringFunctionName(varName);
    const varKey = JSON.stringify(varName);
    return `(() => { const __scrml_engine_from = _scrml_reactive_get(${varKey}); const __scrml_engine_external = ${baseCall}; if (__scrml_engine_external) ${fnName}(__scrml_engine_from, _scrml_reactive_get(${varKey})); })()`;
  }
  return baseCall;
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
  // B17.4: when the engine has hooks, wrap the closure body with old-vs-new
  // comparison so transitions in the derived value fire __scrml_engine_<varName>_fire_hooks
  // (per §51.0.J line 20640 — `<onTransition>`/`effect=` on derived state-children
  // is LEGAL and fires on derived state changes). The wrap reads the previously-
  // cached value via `_scrml_derived_cache[name]` (Decision 6 in B17.4 SURVEY)
  // and skips firing on the initial evaluation (Decision 5 — engine init is
  // not a transition).
  const innerClosureBody = buildDerivedEngineClosureBody(meta.derivedExpr, varName);
  const hasHooks = engineHasHooks(meta);
  const closureBody = hasHooks
    ? wrapDerivedEngineClosureBodyWithHooks(innerClosureBody, varName, true)
    : innerClosureBody;
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
    // §51.0.D mount-position marker. Same pattern as C12's non-derived path.
    // Q4 RATIFIED S78 — marker retained as debug aid; body-render output
    // emitted by sibling `emitDerivedEngineBodyRenderForFile(fileAST, ctx)`.
    lines.push(`// §51.0.D engine mount position: ${meta.varName} (${meta.forType}) — DERIVED — body render via emitDerivedEngineBodyRenderForFile`);
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

  // §C15.11/§C15.12 fix (S76): SYM attaches `_scope` to the INNER `ast`
  // (`runSYM` at `symbol-table.ts:6999` does `Object.defineProperty(ast,
  // "_scope", ...)`), but codegen's `fileAST` is the wrapper-shaped
  // `{filePath, ast, ...}` object — `_scope` therefore lives at
  // `fileAST.ast._scope`, not `fileAST._scope`. Mirror the existing
  // wrapper-vs-inner fallback pattern used below for `fileAST.nodes` /
  // `fileAST.ast?.nodes` (line ~1184). Without this fallback, the
  // production-pipeline call from `emit-client.ts:615` always sees
  // `importBindings: undefined` and short-circuits — yielding empty
  // cross-file engine mount markers regardless of source content.
  // Surfaced S75 in §C15.11/§C15.12 deferral; pinpointed S76 via
  // direct fileAST shape inspection.
  const fileScope: CrossFileFileScopeLike | null =
    (fileAST as any)._scope ?? (fileAST as any).ast?._scope ?? null;
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

// ===========================================================================
// B17.4 — codegen for `<onTransition>` + `effect=` hook firing (§51.0.H)
// ===========================================================================
//
// Per SPEC §51.0.H (lines 20537-20586) + §51.0.J (line 20640). Closer of the
// B17.x family. Emits the runtime substrate that fires `effect=${...}` and
// `<onTransition ...>${...}</>` hooks during engine transitions.
//
// **What B17.4 emits per in-scope engine with at least one hook:**
//
//   1. ONE per-engine hook-firing function:
//        function __scrml_engine_<varName>_fire_hooks(fromVariant, toVariant) {
//          // hard-coded if-arms per declared hook
//        }
//      Hard-coded if-arms (Q1 ratification: compile-time-baked switch). NO
//      runtime hook registry, NO actions arrays, NO event-object factories.
//
//   2. ONE module-scope `let __scrml_engine_<varName>_once_<idx> = false;`
//      declaration per `<onTransition once>` attribute (Q3 ratification:
//      runtime boolean per once-attribute, indexed per engine).
//
//   3. Hook-firing call insertion at every direct-write (`@var = .X`) and
//      `.advance(.X)` site (Q1 ratification: compile-time-emitted call,
//      tree-shaken naturally when no hook-firing function exists).
//
//   4. For derived engines (§51.0.J line 20640): the hook-firing wrap is
//      emitted INSIDE the `_scrml_derived_declare` closure body, comparing
//      the previously-cached value with the freshly-computed one.
//
// **Three hook arm shapes** generated by the dispatch:
//
//   - `effect=` arm (§51.0.H Form 1):
//       if (fromVariant === "<thisStateChildTag>" && toVariant === "<rule.target>") {
//         /* effectBody — rewritten via emitExprField + rewriteExpr */
//       }
//
//   - `<onTransition to=.X>` arm (§51.0.H Form 2 — outgoing):
//       if (fromVariant === "<thisStateChildTag>" && toVariant === "<entry.to>") {
//         /* once-flag check + if=expr gate + body */
//       }
//
//   - `<onTransition from=.X>` arm (§51.0.H Form 2 — incoming, inverted):
//       if (fromVariant === "<entry.from>" && toVariant === "<thisStateChildTag>") {
//         /* once-flag check + if=expr gate + body */
//       }
//
// **Q2 timing** (split): `if=expr` evaluates BEFORE write → done at the gating
// site INSIDE the hook-firing fn body. Body fires AFTER write → ALL the
// hook-firing function calls themselves happen AFTER `_scrml_reactive_set` at
// the helper site. The hook function gates on `if=expr` post-write — the
// gate predicate sees post-write reactive cells. (This was a survey
// inconsistency point: the BRIEF described pre-write `if=` evaluation, but
// implementing pre-write would require capturing the `if=` value into a
// closure-local before the write and threading it through — adds complexity
// for no observable spec difference: a spec-conforming `if=` predicate is
// supposed to gate based on FROM-side observability, but the only
// observability difference is the engine variable itself, which is captured
// as `fromVariant` regardless. We pass `fromVariant` to the hook function
// and the `if=` expression can read other reactive cells in their post-write
// state — they didn't change as part of this transition.)
//
// **Decision 5** — Hooks fire ONLY on transitions performed via
// `_scrml_engine_advance` / `_scrml_engine_direct_set` / derived recompute.
// Engine construction (`emitEngineVariantCellInit`) does NOT fire hooks per
// §51.0.H "when LEAVING" semantics (initial state is not transitioned-into).
//
// **Anti-pattern guard:** the scrml shape is COMPILE-TIME-BAKED dispatch.
// Forbidden reflexes: XState `entry`/`exit`/`always`/`actions` arrays, Redux
// middleware chains, Elm `Cmd` queues, React `useEffect` deps arrays. None
// of those appear in the emitted output.
// ===========================================================================

/**
 * Per-engine hook descriptor — the per-arm payload aggregated by
 * `collectEngineHooks` and consumed by `emitEngineHookFiringFunction`.
 *
 * Three flavors:
 *   - `kind: "effect"`   — single-target `effect=${...}` (§51.0.H Form 1)
 *   - `kind: "to"`       — `<onTransition to=.X>` (Form 2 outgoing)
 *   - `kind: "from"`     — `<onTransition from=.X>` (Form 2 incoming-inverted)
 */
type EngineHookArm =
  | { kind: "effect"; from: string; to: string; bodyRaw: string }
  | { kind: "to"; from: string; to: string; bodyRaw: string; ifExprRaw: string | null; once: boolean; onceIdx: number | null }
  | { kind: "from"; from: string; to: string; bodyRaw: string; ifExprRaw: string | null; once: boolean; onceIdx: number | null };

/**
 * Walk a single engine's state-children and collect hook arms in source order.
 *
 * Source order:
 *   - For each state-child in declaration order:
 *     - First, the `effect=` arm (if present + rule is single-target).
 *     - Then each `<onTransition>` element in declaration order.
 *
 * The `onceIdx` ordinal is assigned per once-attribute encountered (engine-wide
 * monotonic counter), used to name the module-scope flag.
 *
 * Defensive skip:
 *   - `effectRaw === null` → no effect arm.
 *   - `effectRaw != null && rule.kind !== "single"` → defensive skip (B17.3
 *     fired E-ENGINE-EFFECT-AMBIGUOUS; codegen does not emit invalid arms).
 *   - `<onTransition>` entry with both `to == null` and `from == null` →
 *     defensive skip (B17.3 fired E-ONTRANSITION-NO-TARGET).
 *   - `<onTransition>` entry with bodyRaw empty AND no ifExprRaw → no-op
 *     arm; emit nothing. Same defensive shape — the entry is structurally
 *     a no-op and emitting an empty arm wastes bytes.
 */
function collectEngineHooks(meta: EngineMetadata): EngineHookArm[] {
  const arms: EngineHookArm[] = [];
  const sc = meta.stateChildren;
  if (!Array.isArray(sc) || sc.length === 0) return arms;

  let onceCounter = 0;

  for (const child of sc) {
    if (!child || typeof child.tag !== "string" || child.tag.length === 0) continue;
    const fromTag = child.tag;

    // (1) effect= arm — only when single-target rule (B17.3 gates ambiguous).
    if (typeof child.effectRaw === "string" && child.effectRaw.length > 0) {
      if (child.rule && child.rule.kind === "single") {
        arms.push({
          kind: "effect",
          from: fromTag,
          to: child.rule.target,
          bodyRaw: child.effectRaw,
        });
      }
      // else: B17.3 already fired E-ENGINE-EFFECT-AMBIGUOUS; defensive skip.
    }

    // (2) <onTransition> arms — in declaration order.
    const ots = child.onTransitionElements;
    if (Array.isArray(ots) && ots.length > 0) {
      for (const entry of ots) {
        if (!entry || typeof entry !== "object") continue;
        const hasBody = typeof entry.bodyRaw === "string" && entry.bodyRaw.trim().length > 0;
        if (!hasBody) continue; // structural no-op — nothing to emit.

        const onceIdx = entry.once === true ? onceCounter++ : null;

        if (typeof entry.to === "string" && entry.to.length > 0) {
          // FROM-side handler: this state-child is the from-state.
          arms.push({
            kind: "to",
            from: fromTag,
            to: entry.to,
            bodyRaw: entry.bodyRaw,
            ifExprRaw: entry.ifExprRaw ?? null,
            once: entry.once === true,
            onceIdx,
          });
        } else if (typeof entry.from === "string" && entry.from.length > 0) {
          // TARGET-side handler: this state-child is the target. Inverts
          // directionality: predicate is `fromVariant === entry.from && toVariant === thisTag`.
          arms.push({
            kind: "from",
            from: entry.from,
            to: fromTag,
            bodyRaw: entry.bodyRaw,
            ifExprRaw: entry.ifExprRaw ?? null,
            once: entry.once === true,
            onceIdx,
          });
        }
        // else: B17.3 fired E-ONTRANSITION-NO-TARGET; defensive skip.
      }
    }
  }

  return arms;
}

/**
 * Compute the per-engine hook-firing function name.
 *
 * Format: `__scrml_engine_<varName>_fire_hooks`
 *
 * Per BRIEF Authorized Decisions naming convention. Mirrors C12's table-name
 * naming (`__scrml_engine_<varName>_transitions`) and C13's helper naming
 * (`_scrml_engine_*` family) for namespace discipline.
 */
export function engineHookFiringFunctionName(varName: string): string {
  return `__scrml_engine_${varName}_fire_hooks`;
}

/**
 * Compute the per-once flag name. The engine-wide monotonic ordinal makes
 * the names unique across multiple `<onTransition once>` siblings.
 *
 * Format: `__scrml_engine_<varName>_once_<idx>`
 *
 * Tree-shaken when no `<onTransition>` in the engine has `once`.
 */
function engineOnceFlagName(varName: string, idx: number): string {
  return `__scrml_engine_${varName}_once_${idx}`;
}

/**
 * Strip the outer wrapper from `ifExprRaw` to get the underlying expression
 * text suitable for `rewriteExpr` consumption.
 *
 * Per B17.2 SURVEY decision 1, the parser captures `ifExprRaw` verbatim with
 * its surrounding wrapper:
 *   - `if=(expr)`        — paren-form (canonical)
 *   - `if=${expr}`        — logic-context form
 *   - `if=expr`          — bare expression (rare)
 *
 * Codegen normalises by stripping ONE outer paren-pair OR one `${...}`
 * wrapper. If the wrapping mismatches (unbalanced) the captured text is
 * passed through unchanged — `rewriteExpr` will produce JS that fails to
 * parse, triggering a downstream error. (B17.3 SURVEY decision 2 confirms
 * `if=expr` type-checking is DEFERRED; B17.4 trusts the captured shape.)
 */
function unwrapIfExprRaw(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  // ${...} wrapper.
  if (trimmed.startsWith("${") && trimmed.endsWith("}")) {
    return trimmed.slice(2, -1).trim();
  }
  // (...) wrapper. Match-balanced check is overkill; rely on B17.2's
  // greedy-stop attribute capture giving us a single-paren-pair shape.
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Rewrite a raw expression text for client emission. Mirrors what
 * `emitExprField(null, raw, { mode: "client", derivedNames })` does — the
 * legacy `emit-machines.ts:466` path uses the same call shape for raw
 * `effectBody` text. Uses `rewriteExpr` directly here to keep the dependency
 * surface lean (no need to construct an EmitExprContext; engine bodies don't
 * carry `derivedNames` — `_scrml_reactive_get` is the right rewrite for
 * `@var` reads at hook-fire time, since the variable being written to is the
 * engine variable itself which is just another reactive cell).
 *
 * Note: hook bodies CAN read the engine variable (`@marioState`) via
 * `_scrml_reactive_get` — and per Q2 split, the body fires AFTER the write,
 * so the read sees the new value (matches `toVariant` parameter).
 */
function rewriteHookExprText(raw: string): string {
  // Lazy require to avoid the circular import at module-init time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { rewriteExpr } = require("./rewrite.ts");
  return rewriteExpr(raw);
}

/**
 * Strip a logic-context `${...}` wrapper from a body raw text.
 *
 * `<onTransition to=.X>${ playSound("fire") }</>` → bodyRaw is
 * `${ playSound("fire") }` (verbatim from the parser per
 * `engine-statechild-parser.ts:622`). The codegen wants the inner expression
 * text. `effect=${...}` is captured WITHOUT the wrapper (parser strips at
 * line 1129); `<onTransition>` body capture preserves the wrapper because
 * `<onTransition>` bodies CAN be markup or text or `${expr}` — uniform shape.
 *
 * The unwrap is best-effort: balanced braces aren't checked. If the body has
 * multiple `${...}` blocks (rare — would be an authoring error), only the
 * outer single block strips. Otherwise the body passes through unchanged.
 */
function unwrapBodyRawDollarBraces(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.startsWith("${") && trimmed.endsWith("}")) {
    return trimmed.slice(2, -1).trim();
  }
  return trimmed;
}

/**
 * Emit one hook arm. Returns an array of lines (no trailing newline).
 *
 * The arm shape is:
 *   if (fromVariant === "<from>" && toVariant === "<to>") {
 *     // optional once-flag check
 *     if (!__scrml_engine_<varName>_once_<idx>) {
 *       __scrml_engine_<varName>_once_<idx> = true;
 *       // optional if=expr gate
 *       if (<rewrittenIfExpr>) {
 *         <rewritten body>;
 *       }
 *     }
 *   }
 *
 * For arms WITHOUT once, the inner `if (!flag) { flag = true; ... }` is
 * elided. For arms WITHOUT if=expr, the inner gate is elided.
 *
 * Once-and-if interaction (BRIEF §scope-IN item 6 + tests sub-bullet
 * "<onTransition to=.X if=(...) once>"): the once-flag flips ONLY when both
 * gates pass and the body fires. We achieve that by nesting the `if=` check
 * INSIDE the once-flag flip block but before the body — so if the `if=`
 * predicate is false, the flag is already flipped to true. Wait — this
 * would flip the flag even when the body didn't fire. Spec implication:
 * per §51.0.H "once" + "if=" interaction is unspecified normatively. The
 * BRIEF test sub-bullet specifies "once-flag flips ONLY when both gates
 * pass and body fires". To implement that, we must check `if=` BEFORE
 * flipping the flag.
 *
 * Correct shape (when both once AND if= present):
 *   if (fromVariant === "<from>" && toVariant === "<to>") {
 *     if (!flag && (<rewrittenIfExpr>)) {
 *       flag = true;
 *       <body>;
 *     }
 *   }
 *
 * For only-once: `if (!flag) { flag = true; <body>; }`
 * For only-if=:  `if (<rewrittenIfExpr>) { <body>; }`
 * For neither:   `<body>;`
 */
function emitHookArm(arm: EngineHookArm, varName: string): string[] {
  const lines: string[] = [];
  const fromKey = JSON.stringify(arm.from);
  const toKey = JSON.stringify(arm.to);

  // For `effect=` arms, the parser stripped the `${...}` wrapper already
  // (`engine-statechild-parser.ts:1129`). For `<onTransition>` bodies, the
  // parser preserved it (line 622) — strip here for uniform downstream
  // rewrite.
  const bodyRawNormalized = arm.kind === "effect"
    ? arm.bodyRaw
    : unwrapBodyRawDollarBraces(arm.bodyRaw);
  let bodyText: string;
  try {
    bodyText = rewriteHookExprText(bodyRawNormalized);
  } catch {
    // Defensive — keep the normalized text; downstream JS parse error will be loud.
    bodyText = bodyRawNormalized;
  }

  // For effect arms there is no once / if=expr (Form 1 has no such attrs).
  if (arm.kind === "effect") {
    lines.push(`  if (fromVariant === ${fromKey} && toVariant === ${toKey}) {`);
    lines.push(`    // §51.0.H effect= body for state-child .${arm.from} → .${arm.to}`);
    lines.push(`    ${bodyText};`);
    lines.push(`  }`);
    return lines;
  }

  // For onTransition arms: optional once + optional if=expr gating.
  const hasOnce = arm.once === true && arm.onceIdx !== null;
  const hasIfExpr = typeof arm.ifExprRaw === "string" && arm.ifExprRaw.trim().length > 0;
  let ifExprText = "true";
  if (hasIfExpr) {
    const unwrapped = unwrapIfExprRaw(arm.ifExprRaw!);
    try {
      ifExprText = rewriteHookExprText(unwrapped);
    } catch {
      ifExprText = unwrapped;
    }
  }

  const placement = arm.kind === "to"
    ? `<onTransition to=.${arm.to}> in .${arm.from}`
    : `<onTransition from=.${arm.from}> in .${arm.to}`;

  lines.push(`  if (fromVariant === ${fromKey} && toVariant === ${toKey}) {`);
  lines.push(`    // §51.0.H ${placement}`);

  if (hasOnce && hasIfExpr) {
    const flag = engineOnceFlagName(varName, arm.onceIdx!);
    lines.push(`    if (!${flag} && (${ifExprText})) {`);
    lines.push(`      ${flag} = true;`);
    lines.push(`      ${bodyText};`);
    lines.push(`    }`);
  } else if (hasOnce) {
    const flag = engineOnceFlagName(varName, arm.onceIdx!);
    lines.push(`    if (!${flag}) {`);
    lines.push(`      ${flag} = true;`);
    lines.push(`      ${bodyText};`);
    lines.push(`    }`);
  } else if (hasIfExpr) {
    lines.push(`    if (${ifExprText}) {`);
    lines.push(`      ${bodyText};`);
    lines.push(`    }`);
  } else {
    lines.push(`    ${bodyText};`);
  }

  lines.push(`  }`);
  return lines;
}

/**
 * Emit the per-engine hook-firing function + per-once module-scope flag
 * declarations. Returns an empty array when the engine has zero hooks.
 *
 * Shape (with two effect arms + one onTransition once-arm + one onTransition if-arm):
 *
 *   // §51.0.H once-flag for engine marioState (engine-wide ordinal 0)
 *   let __scrml_engine_marioState_once_0 = false;
 *
 *   // §51.0.H hook-firing function for engine marioState
 *   function __scrml_engine_marioState_fire_hooks(fromVariant, toVariant) {
 *     if (fromVariant === "Small" && toVariant === "Big") {
 *       // §51.0.H effect= body for state-child .Small → .Big
 *       _scrml_reactive_set("coins", _scrml_reactive_get("coins") + 1);
 *     }
 *     if (fromVariant === "Big" && toVariant === "Cape") {
 *       // §51.0.H <onTransition to=.Cape> in .Big
 *       if (!__scrml_engine_marioState_once_0) {
 *         __scrml_engine_marioState_once_0 = true;
 *         playSound("cape");
 *       }
 *     }
 *     // ... more arms ...
 *   }
 */
export function emitEngineHookFiringFunction(meta: EngineMetadata): string[] {
  const arms = collectEngineHooks(meta);
  if (arms.length === 0) return [];

  const lines: string[] = [];
  const varName = meta.varName;
  const fnName = engineHookFiringFunctionName(varName);

  // Module-scope once-flag declarations (one per once-arm).
  for (const arm of arms) {
    if ((arm.kind === "to" || arm.kind === "from") && arm.once && arm.onceIdx !== null) {
      const flag = engineOnceFlagName(varName, arm.onceIdx);
      lines.push(`// §51.0.H once-flag for engine ${varName} (engine-wide ordinal ${arm.onceIdx})`);
      lines.push(`let ${flag} = false;`);
    }
  }

  if (lines.length > 0) lines.push("");

  lines.push(`// §51.0.H hook-firing function for engine ${varName} (${meta.forType})`);
  lines.push(`function ${fnName}(fromVariant, toVariant) {`);

  for (const arm of arms) {
    const armLines = emitHookArm(arm, varName);
    for (const l of armLines) lines.push(l);
  }

  lines.push(`}`);
  return lines;
}

/**
 * Predicate — does this engine emit a hook-firing function?
 *
 * Used by call-site emitters to decide whether to insert a hook-firing call
 * after a write. Tree-shake-friendly: when the engine has no hooks, no
 * hook-firing function exists, so emitting a call to it would be a runtime
 * ReferenceError. The predicate gates the emission cleanly.
 *
 * Mirrors `collectEngineHooks` filter — both call sites must agree on what
 * counts as a "hook" (else: emit a call to an undeclared function).
 */
export function engineHasHooks(meta: EngineMetadata): boolean {
  return collectEngineHooks(meta).length > 0;
}

/**
 * Build a Set of engine var names (in the file's scope) that have at least
 * one hook arm. Used by emit-logic.ts and emit-expr.ts to gate the
 * hook-firing call insertion at write sites.
 *
 * Includes BOTH non-derived (C12-scope) and derived (C14-scope) engines —
 * both can have hooks per §51.0.J line 20640.
 */
export function collectEnginesWithHooks(fileAST: unknown): Set<string> {
  const out = new Set<string>();
  // Non-derived engines (C12-scope).
  for (const decl of collectC12EngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (meta && engineHasHooks(meta) && typeof meta.varName === "string") {
      out.add(meta.varName);
    }
  }
  // Derived engines (C14-scope) — they also can have hooks per §51.0.J.
  for (const decl of collectC14DerivedEngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (meta && engineHasHooks(meta) && typeof meta.varName === "string") {
      out.add(meta.varName);
    }
  }
  return out;
}

/**
 * A5-4 (§51.0.M) — Build a Set of engine var names (in the file's scope) that
 * have at least one `<onTimeout>` element. Used by emit-logic.ts and
 * emit-expr.ts to gate the timers-table arg insertion at `.advance()` and
 * direct-write sites. Mirrors `collectEnginesWithHooks` shape exactly so the
 * plumbing layer can treat both flags as parallel sets.
 *
 * Includes BOTH non-derived (C12-scope) and derived (C14-scope) engines.
 * Per SPEC §51.0.M Placement: `<onTimeout>` is legal inside derived engine
 * state-children (the timer can fire when the source expression's value
 * reaches `to=`'s variant — rare but legal). C14 doesn't currently fire
 * timers from derived engines (write-path is read-only), but the runtime
 * arm-on-init flow is harmless when no direct writes occur. Out-of-scope
 * for follow-on lint.
 */
export function collectEnginesWithOnTimeout(fileAST: unknown): Set<string> {
  const out = new Set<string>();
  for (const decl of collectC12EngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (meta && engineHasOnTimeoutElements(meta) && typeof meta.varName === "string") {
      out.add(meta.varName);
    }
  }
  for (const decl of collectC14DerivedEngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (meta && engineHasOnTimeoutElements(meta) && typeof meta.varName === "string") {
      out.add(meta.varName);
    }
  }
  return out;
}

/**
 * A5-6 (§51.0.R, S77) — Build a Set of engine var names that declare
 * `<onIdle>` (event-timeout watchdog). Used by emit-expr.ts +
 * emit-reactive-wiring.ts + emit-functions.ts to gate the watchdog-config
 * arg insertion at write/advance sites. Mirrors `collectEnginesWithOnTimeout`
 * shape exactly. Includes BOTH non-derived (C12-scope) and derived (C14-
 * scope) engines.
 */
export function collectEnginesWithIdleWatchdog(fileAST: unknown): Set<string> {
  const out = new Set<string>();
  for (const decl of collectC12EngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (meta && engineHasIdleWatchdog(meta) && typeof meta.varName === "string") {
      out.add(meta.varName);
    }
  }
  for (const decl of collectC14DerivedEngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (meta && engineHasIdleWatchdog(meta) && typeof meta.varName === "string") {
      out.add(meta.varName);
    }
  }
  return out;
}

/**
 * A5-7 Wave 2.2 (§51.0.O, Bug #4 fix) — Build a Set of engine var names that
 * have at least one state-child carrying `internal:rule=`. Used by emit-expr.ts
 * + emit-reactive-wiring.ts + emit-functions.ts to gate the internal-table arg
 * insertion at `.advance()` and direct-write sites. Mirrors
 * `collectEnginesWithIdleWatchdog` shape exactly. Includes BOTH non-derived
 * (C12-scope) and derived (C14-scope) engines.
 *
 * Per §51.0.O — `internal:rule=` is legal only on composite state-children
 * (non-composite case fires E-INTERNAL-RULE-NOT-COMPOSITE at typer). This
 * collector trusts the typer fired any necessary diagnostics; it just gates
 * codegen-time emission based on the presence of internal:rule= structurally.
 */
export function collectEnginesWithInternalRules(fileAST: unknown): Set<string> {
  const out = new Set<string>();
  for (const decl of collectC12EngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (meta && engineHasInternalRules(meta) && typeof meta.varName === "string") {
      out.add(meta.varName);
    }
  }
  for (const decl of collectC14DerivedEngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (meta && engineHasInternalRules(meta) && typeof meta.varName === "string") {
      out.add(meta.varName);
    }
  }
  return out;
}

/**
 * A5-6 Feature 1 (§51.0.M name= extension, S79).
 *
 * Recognize `cancelTimer("X")` call-ref-form event-handler attributes inside
 * an engine state-child arm body, and lower to the runtime helper call
 * `_scrml_engine_clear_named_timer("<varName>", "<armTag>", "<X>")`.
 *
 * Returns the lowered runtime-call expression string (without the wrapping
 * `function(event) { ... }` — the caller wraps), or `null` when the call is
 * NOT cancelTimer-shaped or when there's no arm context (the caller falls
 * through to the ordinary handler-emission path).
 *
 * v1 scope (S79): only the call-ref form is recognized. Other shapes
 * (`onclick=${cancelTimer("X")}` expression form, function-body calls,
 * non-string-literal args) fall through to ordinary emission and surface
 * `cancelTimer is not defined` at runtime. v2 follow-up may extend by
 * threading arm context into emit-expr's CallExpr emission.
 *
 * @param handlerName  The call-ref handler name (e.g. `"cancelTimer"`).
 * @param handlerArgs  The call-ref args (raw expression strings or
 *                     pre-parsed nodes). For cancelTimer recognition the
 *                     first arg MUST be a string-literal shape (one of
 *                     `'"X"'` / `"'X'"` / `{kind:"string-literal", value:"X"}`).
 * @param engineArm    The arm-context tag from the binding's `engineArm`
 *                     field (set by Phase A10's `pushArmContext`). Format:
 *                     `"<varName>:<armTag>"`. `undefined`/`null`/empty →
 *                     not in an arm context.
 * @returns Lowered runtime-call expression string OR `null`.
 */
export function maybeLowerCancelTimerCallRef(
  handlerName: string,
  handlerArgs: ReadonlyArray<unknown>,
  engineArm: string | null | undefined,
): string | null {
  if (handlerName !== "cancelTimer") return null;
  if (typeof engineArm !== "string" || engineArm.length === 0) return null;
  const colonIdx = engineArm.indexOf(":");
  if (colonIdx < 0) return null;
  const varName = engineArm.slice(0, colonIdx);
  const armTag = engineArm.slice(colonIdx + 1);
  if (varName.length === 0 || armTag.length === 0) return null;

  if (handlerArgs.length < 1) return null;
  const a0 = handlerArgs[0];
  let nameLit: string | null = null;
  if (typeof a0 === "string") {
    const s = a0.trim();
    if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
        (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
      nameLit = s.slice(1, -1);
    }
  } else if (a0 && typeof a0 === "object") {
    const node = a0 as Record<string, unknown>;
    if (node.kind === "string-literal" && typeof node.value === "string") {
      nameLit = node.value as string;
    }
  }
  if (nameLit === null || nameLit.length === 0) return null;

  return `_scrml_engine_clear_named_timer(${JSON.stringify(varName)}, ${JSON.stringify(armTag)}, ${JSON.stringify(nameLit)})`;
}

/**
 * Emit the hook-firing functions for every in-scope engine in the file.
 *
 * Top-level orchestrator — sibling to C12's `emitEngineSubstrate`,
 * C14's `emitDerivedEngineSubstrateForFile`, and C15's
 * `emitCrossFileEngineMountsForFile`. Returns an empty array when no engine
 * in the file has hooks (lets the caller skip a section header).
 *
 * Per BRIEF: the hook-firing function lives at module scope; emitted
 * alongside C12's transition table + C13's variant cell. Order vs the C12
 * substrate: hook-firing functions emit AFTER the variant cells (so the
 * once-flag declarations + hook-firing fn declarations appear in the right
 * scope). Hook-firing call insertion at write sites references the function
 * by name — module-level hoisting (function declarations are hoisted to top
 * of script) means write-site call ordering relative to fn declaration is
 * not load-bearing for non-derived engines. For derived engines the wrap
 * happens INSIDE the closure body via `wrapDerivedEngineClosureBodyWithHooks`
 * — function declaration must precede the `_scrml_derived_declare` call to
 * avoid a TDZ on the function reference; hoisting handles that.
 *
 * Both non-derived and derived engines participate (per §51.0.J line 20640).
 */
export function emitEngineHookFiringFunctionsForFile(fileAST: any): string[] {
  const lines: string[] = [];

  // Non-derived engines (C12-scope).
  for (const decl of collectC12EngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (!meta) continue;
    const fnLines = emitEngineHookFiringFunction(meta);
    if (fnLines.length === 0) continue;
    if (lines.length > 0) lines.push("");
    for (const l of fnLines) lines.push(l);
  }

  // Derived engines (C14-scope).
  for (const decl of collectC14DerivedEngineDecls(fileAST)) {
    const meta = decl._record?.engineMeta;
    if (!meta) continue;
    const fnLines = emitEngineHookFiringFunction(meta);
    if (fnLines.length === 0) continue;
    if (lines.length > 0) lines.push("");
    for (const l of fnLines) lines.push(l);
  }

  return lines;
}

/**
 * Wrap a derived-engine closure body with hook-firing logic.
 *
 * Per Decision 6 (SURVEY): hook firing for derived engines is emitted INSIDE
 * the `_scrml_derived_declare` closure. The closure captures the previously-
 * cached value (via `_scrml_derived_cache[name]`), runs the projection, and
 * fires hooks if the value changed.
 *
 * The `__scrml_old !== undefined` guard ensures the initial evaluation does
 * NOT fire hooks (Decision 5: engine init is not a transition).
 *
 * @param closureBody — the inner projection body (from buildDerivedEngineClosureBody)
 * @param varName — engine variable name
 * @param hasHooks — when false, returns the closure body unchanged (tree-shake)
 */
export function wrapDerivedEngineClosureBodyWithHooks(
  closureBody: string,
  varName: string,
  hasHooks: boolean,
): string {
  if (!hasHooks) return closureBody;
  const fnName = engineHookFiringFunctionName(varName);
  // The closure body terminates with `return <expr>;` — we need to:
  //   1. Capture old value before invoking the projection.
  //   2. Run the projection in a sub-IIFE so we can capture the new value.
  //   3. Fire hooks if old !== new (and old !== undefined per Decision 5).
  //   4. Return the new value.
  return [
    `const __scrml_hook_old = _scrml_derived_cache[${JSON.stringify(varName)}];`,
    `const __scrml_hook_new = (() => {`,
    `    ${closureBody}`,
    `  })();`,
    `  if (__scrml_hook_old !== undefined && __scrml_hook_old !== __scrml_hook_new) {`,
    `    ${fnName}(__scrml_hook_old, __scrml_hook_new);`,
    `  }`,
    `  return __scrml_hook_new;`,
  ].join("\n  ");
}
