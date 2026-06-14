/**
 * §51.5 Machine Codegen — Transition Tables + Runtime Guards
 *
 * Generates:
 *   1. Transition lookup tables for each enum with transitions{} and each < machine>
 *   2. Runtime guard wrappers for machine-bound reactive variable assignments
 *   3. Effect block execution after successful transitions
 *
 * The lookup table is a constant object: { "From:To": true }
 * Runtime guard pattern:
 *   const __prev = _scrml_reactive_get("varName");
 *   if (!__scrml_transitions_MachineName[__prev.variant + ":" + newValue.variant]) {
 *     throw new Error("E-ENGINE-001-RT: ...");
 *   }
 *   _scrml_reactive_set("varName", newValue);
 */

import { emitExprField } from "./emit-expr.ts";
import { CGError } from "./errors.ts";
import { autoDeriveEngineVarName } from "../engine-varname.ts";

// ---------------------------------------------------------------------------
// §51.5.1 — Compile-time illegal-transition collector (S28 slice 3)
// ---------------------------------------------------------------------------
// Module-level buffer for E-ENGINE-001 compile errors detected during
// transition-guard emission. Populated by the classifier when a literal RHS
// cannot match any rule in the machine. Drained by the codegen top level
// (index.ts) into the file's error list before returning. Cleared at the
// start of every compile via `clearMachineCodegenErrors()`.

const _machineCodegenErrors: CGError[] = [];

export function drainMachineCodegenErrors(): CGError[] {
  const out = _machineCodegenErrors.slice();
  _machineCodegenErrors.length = 0;
  return out;
}

export function clearMachineCodegenErrors(): void {
  _machineCodegenErrors.length = 0;
}

// ---------------------------------------------------------------------------
// §51.5 — No-elide flag (S28 slice 4)
// ---------------------------------------------------------------------------
// Debug knob: when set, `classifyTransition` always returns `unknown` so the
// full guard emits on every machine-bound assignment. Used by CI to run the
// full test suite twice (elided default + non-elided parity) and by devs
// wanting to breakpoint the runtime throw site.
//
// Activation:
//   - Environment variable `SCRML_NO_ELIDE=1` at module load.
//   - Programmatic `setNoElide(true)` from tests.

let _noElide = (typeof process !== "undefined"
  && (process as unknown as { env?: Record<string, string | undefined> }).env?.SCRML_NO_ELIDE === "1");

export function setNoElide(v: boolean): void {
  _noElide = v;
}

export function isNoElide(): boolean {
  return _noElide;
}

// ---------------------------------------------------------------------------
// §51.12.3 + §51.12.3.1 (S67) — Duration emission helper (A5-5)
// ---------------------------------------------------------------------------
//
// Emit the JS expression for a temporal rule's `after` duration. Two shapes:
//
//   1. Literal (constant-folded at compile time):  `30000` (bare number).
//   2. Computed (per-arm runtime computation):     IIFE-wrapped expression
//      that clamps negative/NaN to 0 and rounds to integer ms.
//
// Caller embeds the returned string at the `_scrml_machine_arm_timer` call
// site (the 2nd argument). Both shapes are valid inside any expression
// position.
//
// **Reactive read rewrite:** the computed-form text is passed through
// `rewriteExpr` so `@var` reads become `_scrml_reactive_get(<encodedName>)`.
// The full expression (including the unit multiplier `(@x) * 1000`) is then
// evaluated inside the IIFE; the final number is clamped + rounded.
//
// Per SCOPE §3 decision #3: clamp shape is
// `(typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : 0`
// — equivalent to `Math.max(0, v)` but more defensive against NaN.
function emitDurationLiteral(rule: TransitionRule): string {
  if (rule.afterMs != null) return String(rule.afterMs);
  if (rule.afterExpr != null) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rewriteExpr } = require("./rewrite.ts");
    const rewritten = rewriteExpr(rule.afterExpr);
    return `(function(){ var v = ${rewritten}; return (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : 0; })()`;
  }
  // Defensive — non-temporal rules are filtered before reaching this helper.
  return "0";
}

// ---------------------------------------------------------------------------
// §51.5.2 — Transition Lookup Table
// ---------------------------------------------------------------------------

interface RuleBinding {
  localName: string;
  fieldName: string;
}

interface TransitionRule {
  from: string;
  to: string;
  guard: string | null;
  label: string | null;
  effectBody: string | null;
  // §51.3.2 (S22) — payload bindings resolved against the governed enum.
  // null when the rule had no binding-group on that side.
  fromBindings?: RuleBinding[] | null;
  toBindings?: RuleBinding[] | null;
  // §51.12 (S25) — temporal transition delay in milliseconds. null/undefined
  // for non-temporal rules.
  afterMs?: number | null;
  // §51.12.3.1 (S67 amendment, A5-5) — computed-delay form. When non-null,
  // the rule fires after a runtime-computed duration; codegen wraps the
  // expression in an IIFE that clamps negative/NaN to 0. Mutually exclusive
  // with afterMs — exactly ONE is non-null for a temporal rule. The text
  // is the FULL computed-form JS expression INCLUDING the unit multiplier
  // (e.g. for `${@x}s` the stored text is `(@x) * 1000`); codegen calls
  // rewriteExpr on it at emit time so `_scrml_reactive_get` wires correctly.
  afterExpr?: string | null;
}

/**
 * Emit a transition lookup table as a const declaration.
 *
 * @param tableName — JS variable name for the table (e.g. "__scrml_transitions_OrderStatus")
 * @param rules — transition rules from the enum or machine
 * @returns lines of JS code
 */
export function emitTransitionTable(tableName: string, rules: TransitionRule[]): string[] {
  const lines: string[] = [];
  const entries: string[] = [];

  for (const rule of rules) {
    const key = `${rule.from}:${rule.to}`;
    // §51.11.4 (S27) — labels are baked into the table so the audit push can
    // resolve them via the same wildcard-fallback chain that picks __rule.
    // Entry shapes:
    //   plain            "A:B": true
    //   guarded          "A:B": { guard: true }
    //   labeled          "A:B": { label: "foo" }
    //   guarded+labeled  "A:B": { guard: true, label: "foo" }
    const labelFrag = rule.label ? `, label: ${JSON.stringify(rule.label)}` : "";
    if (rule.guard) {
      entries.push(`  "${key}": { guard: true${labelFrag} }`);
    } else if (rule.label) {
      entries.push(`  "${key}": { label: ${JSON.stringify(rule.label)} }`);
    } else {
      entries.push(`  "${key}": true`);
    }
  }

  // Also add wildcard expansions: if "*.X" exists, it means "any => X"
  // We don't expand wildcards into the table — runtime checks handle them

  lines.push(`const ${tableName} = {`);
  lines.push(entries.join(",\n"));
  lines.push(`};`);

  return lines;
}

// ---------------------------------------------------------------------------
// §51.5.2 — Runtime Guard Wrapper
// ---------------------------------------------------------------------------

/**
 * Emit a runtime transition guard for a reactive assignment.
 *
 * Pattern:
 *   // §51 transition guard: @varName (MachineName)
 *   (function() {
 *     const __prev = _scrml_reactive_get("varName");
 *     const __next = <newValueExpr>;
 *     const __key = (__prev?.variant ?? "*") + ":" + (__next?.variant ?? "*");
 *     const __rule = __scrml_transitions_<Name>[__key]
 *       ?? __scrml_transitions_<Name>["*:" + (__next?.variant ?? "*")]
 *       ?? __scrml_transitions_<Name>[(__prev?.variant ?? "*") + ":*"]
 *       ?? __scrml_transitions_<Name>["*:*"];
 *     if (!__rule) {
 *       throw new Error("E-ENGINE-001-RT: ...");
 *     }
 *     _scrml_reactive_set("varName", __next);
 *   })();
 *
 * @param encodedVarName — the encoded reactive variable name
 * @param newValueExpr — the JS expression for the new value
 * @param tableName — the transition table variable name
 * @param engineName — machine or enum name for error messages
 * @param guardRules — rules that have guards (for runtime guard evaluation)
 * @returns lines of JS code
 */
// ---------------------------------------------------------------------------
// §51.9 (S22) — Derived / Projection Machine Codegen
// ---------------------------------------------------------------------------

interface DerivedMachineLike {
  name: string;
  governedTypeName: string;
  sourceVar?: string | null;
  projectedVarName?: string | null;
  rules: TransitionRule[];
}

/**
 * §51.9 — Emit the projection function for a derived machine.
 *
 * Shape:
 *   function _scrml_project_UI(src) {
 *     var tag = (src != null && typeof src === "object") ? src.variant : src;
 *     if (tag === "Draft") return "Editable";
 *     if (tag === "Submitted") return "ReadOnly";
 *     ...
 *     // Exhaustiveness was checked at compile time; this fallthrough
 *     // should be unreachable for well-typed source values.
 *     return undefined;
 *   }
 *
 * Projection rules with a `given` guard are evaluated top-to-bottom; the
 * first matching rule wins. Unguarded rules terminate their group per
 * §51.9.3. Destination is emitted as a plain string when unit; if the
 * projection enum declares the RHS variant with a payload, we still emit
 * a string (projection RHSs are single-variant-no-binding per §51.9.2 —
 * the spec reserves payload projections for future work, §51.9.7).
 */
export function emitProjectionFunction(machine: DerivedMachineLike): string[] {
  const fnName = `_scrml_project_${machine.name}`;
  const lines: string[] = [];
  lines.push(`function ${fnName}(src) {`);
  lines.push(`  var tag = (src != null && typeof src === "object") ? src.variant : src;`);
  for (const rule of machine.rules) {
    const toLiteral = `"${rule.to}"`;
    if (rule.guard) {
      // §51.5 (S26) — rewrite @reactive refs to _scrml_reactive_get(...)
      // before emitting the guard as a JS expression. rule.guard captures
      // raw scrml text from the machine body; without this rewrite, guards
      // referencing reactive vars emit invalid JS (raw `@name` token).
      const guardJs = emitExprField(null, rule.guard, { mode: "client" });
      lines.push(`  if (tag === "${rule.from}" && (${guardJs})) return ${toLiteral};`);
    } else {
      lines.push(`  if (tag === "${rule.from}") return ${toLiteral};`);
    }
  }
  // Defensive fallthrough — exhaustiveness was checked at compile time so
  // this branch should be unreachable for well-typed source values. Return
  // `null` (canonical scrml absence per M-7C-D-12 + §42.5) rather than the
  // bare `undefined` keyword (W-CG-UNDEFINED-INTERPOLATION leak).
  lines.push(`  return null;`);
  lines.push(`}`);
  return lines;
}

/**
 * §51.9 — Emit the runtime registration of the projected reactive.
 *
 * Registers the projected var in `_scrml_derived_fns` so `_scrml_reactive_get`
 * will delegate to `_scrml_derived_get` (see `runtime-template.js:71`). Also
 * subscribes the derived var to its source's dirty propagation edge so
 * writes to the source trigger DOM re-reads on the projection.
 *
 * Shape:
 *   _scrml_derived_fns["ui"] = function() {
 *     return _scrml_project_UI(_scrml_reactive_get("order"));
 *   };
 *   _scrml_derived_dirty["ui"] = true;
 *   (_scrml_derived_downstreams["order"] = _scrml_derived_downstreams["order"] || new Set()).add("ui");
 */
export function emitDerivedDeclaration(machine: DerivedMachineLike): string[] {
  const lines: string[] = [];
  // §51.0.C — prefer the type-system-supplied projected name; when absent, derive via
  // the ONE canonical rule (engine-varname.ts) so the fallback agrees with SYM/type-system
  // (was `machine.name.toLowerCase()`, which collapsed `MarioState`->`mariostate`).
  const projected = machine.projectedVarName ?? autoDeriveEngineVarName(machine.name);
  const source = machine.sourceVar ?? "";
  const fnName = `_scrml_project_${machine.name}`;
  lines.push(`// §51.9 derived machine: @${projected} projects @${source} through ${machine.name}`);
  lines.push(`_scrml_derived_fns[${JSON.stringify(projected)}] = function() { return ${fnName}(_scrml_reactive_get(${JSON.stringify(source)})); };`);
  lines.push(`_scrml_derived_dirty[${JSON.stringify(projected)}] = true;`);
  lines.push(`(_scrml_derived_downstreams[${JSON.stringify(source)}] = _scrml_derived_downstreams[${JSON.stringify(source)}] || new Set()).add(${JSON.stringify(projected)});`);
  return lines;
}

/**
 * §51.3.2 (S22) — Build the destructuring statements for a rule's from-/to-
 * bindings. Emits `var <local> = __prev.data.<field>;` for from-bindings and
 * `var <local> = __next.data.<field>;` for to-bindings. Uses `var` rather
 * than `let` so the declarations function-hoist within the IIFE and stay
 * visible to the guard and effect bodies that follow.
 *
 * Exported for the gauntlet-s22 tests that assert on the emitted shape.
 */
export function buildBindingPreludeStmts(rule: TransitionRule): string[] {
  const out: string[] = [];
  for (const b of rule.fromBindings ?? []) {
    out.push(`var ${b.localName} = __prev != null && __prev.data != null ? __prev.data.${b.fieldName} : undefined;`);
  }
  for (const b of rule.toBindings ?? []) {
    out.push(`var ${b.localName} = __next != null && __next.data != null ? __next.data.${b.fieldName} : undefined;`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// §51.5.1 — Compile-time transition classifier (S28 validation elision)
// ---------------------------------------------------------------------------

/**
 * Classify a machine-bound assignment for validation elision.
 *
 * Returns:
 *   - { kind: "legal", matchedKey, matchedRule }  — emit minimal side-effect-only
 *     shape (no variant extraction, no matched-key resolution, no rejection throw)
 *   - { kind: "illegal", targetVariant }           — trivially-illegal; E-ENGINE-001
 *     compile-time error (§51.5.1). Caller surfaces into the codegen error list
 *     via `_machineCodegenErrors` and emits a full guard as a safety net so the
 *     compiled JS remains syntactically valid if the caller chooses to continue.
 *   - { kind: "unknown" }                          — emit the full runtime guard
 *
 * S28 slice 1 (Cat 2.a / 2.b): literal unit-variant RHS, unguarded wildcard rule
 * covers the target unambiguously.
 * S28 slice 2 (Cat 2.d): same conditions with a payload constructor call on the
 * RHS (`EnumName.VariantName(args)`). The payload data is carried through the
 * state commit; no binding extraction is performed because elision gates on the
 * machine having no payload bindings anywhere.
 * S28 slice 3 (Cat 2.f): literal RHS (unit or payload) that no rule in the
 * machine can ever match (no `X:target`, no `*:target`, no `X:*`, no `*:*`)
 * → §51.5.1 compile error.
 *
 * Preconditions for elision (preserved from slice 1):
 *   - NO rule has a `given` guard (runtime resolution could pre-empt with a
 *     guarded rule for some `__prev` value).
 *   - NO rule has payload `fromBindings` / `toBindings` (bindings imply runtime
 *     observation that elision cannot reproduce).
 *
 * Illegal-detection conditions (slice 3):
 *   - RHS matches the literal-variant pattern (unit or payload).
 *   - NO rule in the rules list has `to === targetVariant` OR `to === "*"`.
 *   - No exception for guarded rules — a guard can only narrow legality, not
 *     widen it; if no rule lists the target at all, runtime will throw regardless.
 *
 * The compile-time-baked matched key is contractually identical to what the
 * runtime wildcard-fallback chain would resolve (§51.5.2 normative — see
 * the 2026-04-19 amendment clarifying validation elision).
 *
 * Categories deferred to future slices:
 *   - 2.c self-assignment, 2.e flow-sensitive __prev.
 */
type TriageResult =
  | { kind: "legal"; matchedKey: string; matchedRule: TransitionRule }
  | { kind: "illegal"; targetVariant: string }
  | { kind: "unknown" };

/**
 * Extract the target variant name from a literal RHS, or null if the RHS is
 * not a clean literal. Accepts:
 *   - Unit variant:    `EnumName.VariantName`    or `EnumName_VariantName`
 *   - Payload variant: `EnumName.VariantName(…)` or `EnumName_VariantName(…)`
 * Rejects anything else (runtime expressions, arithmetic, function calls not
 * at the end, etc.).
 */
function extractLiteralTarget(newValueExpr: string): string | null {
  const s = newValueExpr.trim();
  // Unit-variant pattern (no parens)
  let m = s.match(/^[A-Z][A-Za-z0-9_]*[._]([A-Z][A-Za-z0-9_]*)$/);
  if (m) return m[1];
  // Payload-variant pattern: identifier prefix + parenthesized args at end.
  // Verify parens are balanced end-to-end (not just `(` appearing inside).
  m = s.match(/^[A-Z][A-Za-z0-9_]*[._]([A-Z][A-Za-z0-9_]*)\(/);
  if (m && s.endsWith(")")) {
    // Cheap balance check: scan parens depth, ignoring content inside
    // strings. If depth returns to 0 only at the final char, this is a
    // top-level call.
    let depth = 0;
    let inStr: string | null = null;
    const body = s;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (inStr) {
        if (ch === "\\") { i++; continue; }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0 && i !== body.length - 1) return null;
      }
    }
    if (depth === 0) return m[1];
  }
  return null;
}

export function classifyTransition(
  newValueExpr: string,
  rules: TransitionRule[],
): TriageResult {
  // Extract the literal target (unit or payload). Non-literal RHS means
  // neither elision nor illegal-detection is possible — fall through to
  // full guard.
  const targetVariant = extractLiteralTarget(newValueExpr);
  if (!targetVariant) return { kind: "unknown" };

  // §51.5.1 (S28 slice 3) — trivially-illegal detection runs BEFORE the
  // no-elide gate because §51.5.1 is a normative correctness obligation,
  // not a performance optimization. A debug flag should not silence a
  // compile error. If NO rule in the machine has `to === target` and no
  // wildcard target-side rule exists, runtime will always throw; raise a
  // compile-time E-ENGINE-001 instead.
  const anyTargetCoverage = rules.some(r => r.to === targetVariant || r.to === "*");
  if (!anyTargetCoverage) {
    return { kind: "illegal", targetVariant };
  }

  // §51.5 (S28 slice 4) — debug escape: skip elision (the performance
  // optimization) and fall back to the full guard. Illegal-detection above
  // still runs so the normative §51.5.1 behavior is preserved.
  if (_noElide) return { kind: "unknown" };

  // Slice-1 sledgehammer (elision gates): any guard or binding anywhere
  // disables elision because either could selectively match at runtime for
  // some prev value. Illegality check above is independent because no rule
  // covering the target exists at all — a guard cannot widen legality.
  for (const r of rules) {
    if (r.guard) return { kind: "unknown" };
    if ((r.fromBindings && r.fromBindings.length > 0) ||
        (r.toBindings && r.toBindings.length > 0)) {
      return { kind: "unknown" };
    }
  }

  // Case (a): `*:target` match is safe iff no specific `X:target` rule
  // exists — otherwise runtime would pick `X:target` for some prev and
  // our baked-in matched key would disagree with the §51.11 `rule` field.
  const wildTarget = rules.find(r => r.from === "*" && r.to === targetVariant);
  if (wildTarget) {
    const hasSpecificTarget = rules.some(r => r.from !== "*" && r.to === targetVariant);
    if (!hasSpecificTarget) {
      return { kind: "legal", matchedKey: `*:${targetVariant}`, matchedRule: wildTarget };
    }
  }

  // Case (b): `*:*` match is safe only when no higher-precedence shape
  // exists at all — no `X:target`, no `*:target`, no `X:*`. Conservative
  // but correct.
  const fullWild = rules.find(r => r.from === "*" && r.to === "*");
  if (fullWild) {
    const hasHigherPrecedence = rules.some(r =>
      (r.from !== "*" && r.to === targetVariant) ||   // X:target
      (r.from === "*" && r.to === targetVariant) ||   // *:target
      (r.from !== "*" && r.to === "*"));              // X:*
    if (!hasHigherPrecedence) {
      return { kind: "legal", matchedKey: "*:*", matchedRule: fullWild };
    }
  }

  return { kind: "unknown" };
}

/**
 * Emit the elided side-effect-only shape. Validation work is dropped;
 * §51.11 audit push, §51.12 timer arm/clear, §51.3.2 effect body, and
 * the §51.5.2(5) state commit all run as the full guard would.
 *
 * The matched key is a compile-time string constant; the matched rule's
 * label (if any) is baked in as well. Temporal timer-arm is emitted only
 * for rules whose `from` matches the statically-proven target variant.
 */
function emitElidedTransition(
  encodedVarName: string,
  newValueExpr: string,
  engineName: string,
  matchedKey: string,
  matchedRule: TransitionRule,
  rules: TransitionRule[],
  auditTarget: string | null,
): string[] {
  const targetVariant = matchedRule.to === "*" ? null : matchedRule.to;
  // §51.12 + §51.12.3.1 — temporal rules include BOTH literal-form (afterMs)
  // and computed-form (afterExpr). Either non-null marks a rule as temporal.
  const temporalRules = rules.filter(r => r.afterMs != null || r.afterExpr != null);
  const relevantTemporals = targetVariant
    ? temporalRules.filter(r => r.from === targetVariant)
    : [];
  const hasEffect = matchedRule.effectBody != null && matchedRule.effectBody !== "";
  const hasAudit = auditTarget != null;
  const hasTemporal = temporalRules.length > 0;

  const lines: string[] = [];
  lines.push(`// §51.5 elided transition: ${encodedVarName} (${engineName}) — matched ${matchedKey} at compile time`);

  // Minimal collapse: no audit / no effect / no temporal → bare set.
  if (!hasEffect && !hasAudit && !hasTemporal) {
    lines.push(`_scrml_reactive_set("${encodedVarName}", ${newValueExpr});`);
    return lines;
  }

  // Otherwise we need the IIFE so the side-effect helpers can read __prev/__next.
  lines.push(`(function() {`);
  lines.push(`  var __prev = _scrml_reactive_get("${encodedVarName}");`);
  lines.push(`  var __next = ${newValueExpr};`);
  lines.push(`  _scrml_reactive_set("${encodedVarName}", __next);`);

  if (hasEffect) {
    lines.push(`  // Effect block (from matched rule ${matchedRule.from}:${matchedRule.to})`);
    lines.push(`  {`);
    lines.push(`    var event = { from: __prev, to: __next };`);
    lines.push(`    ${emitExprField(null, matchedRule.effectBody!, { mode: "client" })}`);
    lines.push(`  }`);
  }

  if (hasAudit) {
    const labelLit = matchedRule.label ? JSON.stringify(matchedRule.label) : "null";
    lines.push(`  // §51.11 audit log push (matched key baked in)`);
    lines.push(`  _scrml_reactive_set("${auditTarget}", (_scrml_reactive_get("${auditTarget}") || []).concat([Object.freeze({ from: __prev, to: __next, at: Date.now(), rule: ${JSON.stringify(matchedKey)}, label: ${labelLit} })]));`);
  }

  if (hasTemporal) {
    lines.push(`  // §51.12 temporal timer management`);
    lines.push(`  _scrml_machine_clear_timer("${encodedVarName}");`);
    if (relevantTemporals.length > 0) {
      // Chained re-arm payload: ONLY literal-form rules participate in the
      // serializable rulesJson (computed-form afterExpr cannot round-trip
      // through JSON.parse since it's a runtime expression). The chained
      // re-arm path inside _scrml_machine_arm_initial inspects this list to
      // continue the chain on expiry. Computed rules opt out of auto-chain;
      // the user can use a write to drive transitions if chaining-after-
      // computed is needed. Documented as A5-5 behavior — not a regression
      // because pre-S67 had no computed support at all.
      const rulesPayload = JSON.stringify(
        temporalRules
          .filter(r => r.afterMs != null)
          .map(r => ({
            from: r.from,
            afterMs: r.afterMs,
            to: r.to,
            label: r.label ?? null,
          }))
      );
      const auditTargetLit = auditTarget ? JSON.stringify(auditTarget) : "null";
      for (const r of relevantTemporals) {
        const labelLit = r.label ? JSON.stringify(r.label) : "null";
        const durationExpr = emitDurationLiteral(r);
        lines.push(`  _scrml_machine_arm_timer("${encodedVarName}", ${durationExpr}, "${r.to}", { fromVariant: "${r.from}", label: ${labelLit}, auditTarget: ${auditTargetLit}, rulesJson: ${JSON.stringify(rulesPayload)} });`);
      }
    }
  }

  lines.push(`})();`);
  return lines;
}

export function emitTransitionGuard(
  encodedVarName: string,
  newValueExpr: string,
  tableName: string,
  engineName: string,
  rules: TransitionRule[],
  auditTarget: string | null = null,
): string[] {
  // §51.5.2 (S28) — validation elision: when the compiler can prove the
  // transition is legal at compile time, emit the side-effect-only shape.
  const triage = classifyTransition(newValueExpr, rules);
  if (triage.kind === "legal") {
    return emitElidedTransition(
      encodedVarName,
      newValueExpr,
      engineName,
      triage.matchedKey,
      triage.matchedRule,
      rules,
      auditTarget,
    );
  }
  // §51.5.1 (S28 slice 3) — trivially-illegal: target variant has no rule
  // in the machine. Push E-ENGINE-001 and fall through to emit the full
  // guard so compilation can continue and produce a complete file; the
  // runtime throw will fire if this code ever executes, but the compile
  // error is the primary signal.
  if (triage.kind === "illegal") {
    _machineCodegenErrors.push(new CGError(
      "E-ENGINE-001",
      "E-ENGINE-001: Illegal transition. Assignment to @" + encodedVarName +
      " (governed by " + engineName + ") targets variant ." + triage.targetVariant +
      " but no rule in " + engineName + " covers that target " +
      "(no exact `X:" + triage.targetVariant + "` rule, no `*:" + triage.targetVariant + "` wildcard, " +
      "no `X:*` wildcard, no `*:*` catch-all). The runtime would always throw " +
      "E-ENGINE-001-RT on this assignment; surfacing at compile time per §51.5.1. " +
      "To fix: add a transition rule that covers ." + triage.targetVariant +
      " or re-target the assignment.",
      {},
    ));
  }

  const lines: string[] = [];

  lines.push(`// §51 transition guard: ${encodedVarName} (${engineName})`);
  lines.push(`(function() {`);
  lines.push(`  var __prev = _scrml_reactive_get("${encodedVarName}");`);
  lines.push(`  var __next = ${newValueExpr};`);
  // Variant extraction: payload variants emit as `{variant, data}` objects;
  // unit variants emit as bare strings (see emitEnumVariantObjects in
  // emit-client.ts). Both shapes reach this guard at runtime, and both must
  // compose a correct table key. Fallback order:
  //   1. object with `.variant` field → use that field
  //   2. non-null primitive (bare-string unit variant) → use the value itself
  //   3. null/undefined → "*" (matches the wildcard fallback contract below)
  // This mirrors the error-message fallback at line ~243 (`String(__prev)`)
  // that pre-dated the parity fix.
  lines.push(`  var __prevVariant = (__prev != null ? (__prev.variant != null ? __prev.variant : __prev) : "*");`);
  lines.push(`  var __nextVariant = (__next != null ? (__next.variant != null ? __next.variant : __next) : "*");`);
  lines.push(`  var __key = __prevVariant + ":" + __nextVariant;`);
  // §51.11.4 (S27) — track both the matched rule value AND the canonical
  // table key. The key is recorded in audit entries as the `rule` field so
  // replay consumers can identify which declared rule fired after wildcard
  // fallback. Precedence mirrors the `__rule` fallback chain: exact →
  // "*:To" → "From:*" → "*:*".
  lines.push(`  var __matchedKey = (${tableName}[__key] != null) ? __key`);
  lines.push(`    : (${tableName}["*:" + __nextVariant] != null) ? ("*:" + __nextVariant)`);
  lines.push(`    : (${tableName}[__prevVariant + ":*"] != null) ? (__prevVariant + ":*")`);
  lines.push(`    : (${tableName}["*:*"] != null) ? "*:*"`);
  lines.push(`    : null;`);
  lines.push(`  var __rule = __matchedKey != null ? ${tableName}[__matchedKey] : null;`);
  lines.push(`  if (!__rule) {`);
  lines.push(`    throw new Error("E-ENGINE-001-RT: Illegal transition. Variable: ${encodedVarName}, governed by: ${engineName}. Move: " + (__prev != null && __prev.variant != null ? "." + __prev.variant : String(__prev)) + " => " + (__next != null && __next.variant != null ? "." + __next.variant : String(__next)) + ". No rule permits this transition.");`);
  lines.push(`  }`);

  // §51.3.2 (S22) — payload-binding prelude. Before guard and effect bodies,
  // destructure `.data.<field>` for each from-/to-binding into a locally scoped
  // block. Each rule with bindings gets its own keyed guard so the vars are
  // only exposed when the (from → to) transition matches.
  const rulesWithBindings = rules.filter(r =>
    (r.fromBindings && r.fromBindings.length > 0) ||
    (r.toBindings && r.toBindings.length > 0)
  );

  // Guard evaluation (+ binding prelude when applicable)
  const guardRules = rules.filter(r => r.guard != null && r.guard !== "");
  if (guardRules.length > 0) {
    lines.push(`  // Guard evaluation`);
    for (const rule of guardRules) {
      if (!rule.guard) continue;
      const guardKey = `${rule.from}:${rule.to}`;
      const label = rule.label ? ` [${rule.label}]` : "";
      const prelude = buildBindingPreludeStmts(rule);
      // §51.5 (S26) — rewrite @reactive refs to _scrml_reactive_get(...) for
      // the JS evaluation. Diagnostic "Guard:" text keeps the raw scrml form
      // so the user sees the source they wrote.
      const guardJs = emitExprField(null, rule.guard, { mode: "client" });
      const guardDiag = rule.guard.replace(/"/g, '\\"');
      // S27: match against __matchedKey (the canonical rule key the
      // wildcard-fallback chain resolved to) rather than __key (the
      // literal runtime variants). Pre-S27 the comparison used __key,
      // so a rule like `* => .X given (…)` never fired its guard at
      // runtime — __key was e.g. "Pending:X", guardKey "*:X", and the
      // equality check always failed. With __matchedKey, wildcard
      // rules compare against the key the runtime actually selected.
      if (prelude.length > 0) {
        // Open a keyed block, declare bindings, then evaluate the guard.
        lines.push(`  if (__matchedKey === "${guardKey}") {`);
        for (const p of prelude) lines.push(`    ${p}`);
        lines.push(`    if (!(${guardJs})) {`);
        lines.push(`      throw new Error("E-ENGINE-001-RT: Transition guard failed${label}. Variable: ${encodedVarName}, governed by: ${engineName}. Move: .${rule.from} => .${rule.to}. Guard: ${guardDiag}");`);
        lines.push(`    }`);
        lines.push(`  }`);
      } else {
        lines.push(`  if (__matchedKey === "${guardKey}" && !(${guardJs})) {`);
        lines.push(`    throw new Error("E-ENGINE-001-RT: Transition guard failed${label}. Variable: ${encodedVarName}, governed by: ${engineName}. Move: .${rule.from} => .${rule.to}. Guard: ${guardDiag}");`);
        lines.push(`  }`);
      }
    }
  }

  lines.push(`  _scrml_reactive_set("${encodedVarName}", __next);`);

  // Effect blocks. Includes effect-only rules that have no `given` guard
  // (pre-S25 this filtered `guardRules`, which silently dropped any rule
  // whose effect was not paired with a guard).
  const effectRules = rules.filter(r => r.effectBody);
  if (effectRules.length > 0) {
    lines.push(`  // Effect blocks`);
    for (const rule of effectRules) {
      if (!rule.effectBody) continue;
      const effectKey = `${rule.from}:${rule.to}`;
      const prelude = buildBindingPreludeStmts(rule);
      // S27: same parity fix as guards — match on __matchedKey so
      // wildcard effect rules fire when the runtime resolves to them.
      lines.push(`  if (__matchedKey === "${effectKey}") {`);
      lines.push(`    var event = { from: __prev, to: __next };`);
      for (const p of prelude) lines.push(`    ${p}`);
      // S27: effect-body text is raw scrml until we rewrite it. Before
      // this pass, `@trace = @trace.concat([...])` inside an effect block
      // emitted literal `@` tokens — invalid JS. rewriteExpr runs the
      // same pipeline used for all other logic-context expressions
      // (reactive-ref rewrite, match lowering, fn-keyword, etc.) so the
      // effect body behaves like any other bare statement.
      lines.push(`    ${emitExprField(null, rule.effectBody, { mode: "client" })}`);
      lines.push(`  }`);
    }
  }

  // Rules with bindings but no guard or effect (e.g. reserved for future inline
  // assertions) still need the bindings compile-time-visible, so we emit a
  // keyed block that only contains the destructuring. This is intentional
  // dead code at runtime but keeps the declarative surface consistent — the
  // spec says "bindings expose ... locals inside guard and effect-block",
  // which implies they are scoped to those constructs. When neither exists,
  // there is nothing for the bindings to be visible inside, so we skip the
  // emission entirely.
  // (No emission needed — left as a comment for future reviewers.)
  void rulesWithBindings;

  // §51.11 (S24 / S27) — audit clause emission. After state commit and
  // effect blocks, append an audit entry to the target reactive. Shape
  // per §51.11.4:
  //   { from: __prev, to: __next, at: Date.now(),
  //     rule: __matchedKey, label: <from table entry or null> }
  // The concat-then-set pattern produces a fresh array each transition so
  // the reactive fires its subscribers (mutating push would not). `rule`
  // is the canonical table key (with wildcards preserved); `label` is
  // extracted from the matched table entry when it's an object carrying a
  // `label` field (labeled guards per §51.3.2), else null.
  if (auditTarget) {
    lines.push(`  // §51.11 audit log push`);
    lines.push(`  var __auditLabel = (__rule != null && typeof __rule === "object" && __rule.label != null) ? __rule.label : null;`);
    // §51.11.4 specifies audit entries are frozen objects so consumers
    // (replay, time-travel, server-side log aggregators) can safely hold
    // long-lived references without worrying about mutation.
    lines.push(`  _scrml_reactive_set("${auditTarget}", (_scrml_reactive_get("${auditTarget}") || []).concat([Object.freeze({ from: __prev, to: __next, at: Date.now(), rule: __matchedKey, label: __auditLabel })]));`);
  }

  // §51.12 (S25) — temporal transitions. After state commit, clear any
  // previously-armed timer for this machine-bound var and, if the new
  // variant has outgoing temporal rules, arm a fresh one. Re-entering the
  // same variant clears and re-arms (reset-on-reentry default per the
  // deep-dive).
  // §51.12 + §51.12.3.1 — include both literal-form (afterMs) and computed-
  // form (afterExpr) temporal rules. emitDurationLiteral handles the shape
  // discrimination at emit time.
  const temporalRules = rules.filter(r => r.afterMs != null || r.afterExpr != null);
  if (temporalRules.length > 0) {
    lines.push(`  // §51.12 temporal transitions`);
    lines.push(`  _scrml_machine_clear_timer("${encodedVarName}");`);
    // __nextVariant is already declared at the top of the IIFE for matched-key
    // resolution (§51.11.4). The top declaration defaults to "*" for
    // variant-less values, which is equivalent for timer-arming purposes
    // because temporal rules always name a specific `from` variant.
    //
    // S27 (§51.11): pass a meta payload carrying auditTarget + rulesJson so
    // the timer's expiry path can push an audit entry and re-arm any
    // downstream temporal rule.
    //
    // A5-5 (§51.12.3.1): chained re-arm rulesJson includes ONLY literal-form
    // rules (computed-form afterExpr cannot serialize through JSON). Computed
    // rules opt out of auto-chain — see emitElidedTransition for rationale.
    const rulesPayload = JSON.stringify(
      temporalRules
        .filter(r => r.afterMs != null)
        .map(r => ({
          from: r.from,
          afterMs: r.afterMs,
          to: r.to,
          label: r.label ?? null,
        }))
    );
    const auditTargetLit = auditTarget ? JSON.stringify(auditTarget) : "null";
    for (const rule of temporalRules) {
      // Wildcard `from` was rejected at parse time; only specific variants
      // reach here. Each temporal rule fires from exactly its declared
      // `from` variant.
      const labelLit = rule.label ? JSON.stringify(rule.label) : "null";
      const durationExpr = emitDurationLiteral(rule);
      lines.push(`  if (__nextVariant === "${rule.from}") {`);
      lines.push(`    _scrml_machine_arm_timer("${encodedVarName}", ${durationExpr}, "${rule.to}", { fromVariant: "${rule.from}", label: ${labelLit}, auditTarget: ${auditTargetLit}, rulesJson: ${JSON.stringify(rulesPayload)} });`);
      lines.push(`  }`);
    }
  }

  lines.push(`})();`);

  return lines;
}
