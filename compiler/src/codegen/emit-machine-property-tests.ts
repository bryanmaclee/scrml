/**
 * §51.13 — Auto-Generated Machine Property Tests
 *
 * Generates a bun:test suite per machine declaration that verifies the
 * compiled transition guard enforces exactly what the machine's transition
 * table declares. Slogan: machine = enforced spec.
 *
 * Phase 1 (S26) — property (a) Exclusivity.
 *   From any reachable variant V and any variant W: declared pair succeeds,
 *   undeclared pair throws E-ENGINE-001-RT.
 *
 * Phase 2 (S26) — property (c) Guard coverage.
 *   Each LABELED `given` guard receives one passing test (guard truthy →
 *   transition succeeds) and one failing test (guard falsy → throws
 *   E-ENGINE-001-RT: Transition guard failed).
 *
 * Phase 2 harness model: tests don't evaluate the real guard expression.
 * Instead, the harness takes a per-rule guardResults map and treats the
 * supplied boolean as the guard's evaluated value. This tests the WIRING
 * of guard enforcement (§51.13.1(c)'s normative statement) without
 * coupling the test to the guard expression's inputs. Real-expression
 * evaluation with automatic input synthesis is a future phase.
 *
 * Phase 3 (S26) — payload-bound rules.
 *   Machines whose rules use §51.3.2 payload bindings are now in-scope.
 *   The harness is binding-transparent — it does not invoke the real
 *   machine IIFE, so the declared destructuring is never executed during
 *   the generated tests.
 *
 * Phase 4 (S26) — wildcard rules (`*` in from or to).
 *   Rules that use `*` as the from-variant ("any") or to-variant ("any")
 *   are in-scope. Reachability expands: a wildcard-from rule fires from
 *   any already-reached variant; a wildcard-to rule marks every variant
 *   in the governed enum as reachable. Pair resolution follows the
 *   four-step fallback chain used by emitTransitionGuard: exact
 *   `From:To`, then `*:To`, then `From:*`, then `*:*`. The inlined
 *   harness tracks the matched table key so guardResults can key on the
 *   matched wildcard rule (not the concrete input pair).
 *
 * Phase 5 (S26) — temporal rules (`.From after Ns => .To`).
 *   Machines whose rules include §51.12 temporal transitions are in-
 *   scope for exclusivity (property a) and guard coverage (property c).
 *   The pair `(.From, .To)` is a declared transition regardless of how
 *   it fires — timer-driven or user write — so the harness-level
 *   properties carry over unchanged. Test titles receive an
 *   `(after Nms)` annotation so the temporal nature of the rule is
 *   visible in the generated suite.
 *
 *   EXPLICITLY OUT OF SCOPE for auto-property-tests: the timer lifecycle
 *   itself (timer arms on variant entry, clears on variant exit, resets
 *   on reentry). Verifying those behaviors requires a live scrml runtime
 *   with fake-timer control — the self-contained harness deliberately
 *   does not invoke runtime code. Timer-lifecycle regression coverage
 *   lives in hand-written integration tests
 *   (e.g. `gauntlet-s25/machine-temporal-transitions.test.js`). The
 *   generated suite notes this in its header comment so users aren't
 *   surprised when timer bugs slip past it.
 *
 * Phase 6 (S26) — derived / projection machines (§51.9).
 *   Derived machines emit a projection function rather than a
 *   transition table; reading `@projected` delegates through
 *   `_scrml_project_<Name>(source)`. The property under test is not
 *   exclusivity (there is no write) but **(d) Projection correctness**:
 *   for every variant V declared on the source enum, the projection
 *   function SHALL return the target variant declared by the first
 *   matching rule. Exhaustiveness is already enforced at compile time
 *   (E-ENGINE-018), so every source variant appears as some rule's
 *   `from` — we enumerate from `rules.map(r => r.from)`. The generated
 *   suite inlines a minimal copy of the projection function (mirroring
 *   emitProjectionFunction) and calls it per variant.
 *
 * Phase 7 (S28) — guarded projection rules.
 *   Extends phase 6 to projections whose rules carry labeled `given`
 *   guards. Mirrors phase 2's parametrization model: the inlined
 *   projection function takes a `guardResults` map keyed on rule label
 *   that decides whether each guarded rule fires. The generated suite
 *   walks each source variant's rules in declaration order and emits
 *   one test per guarded rule (guard truthy → target fires) plus a
 *   terminal test (all guards falsy → unguarded fallback fires, or
 *   `undefined` if no fallback exists).
 *
 *   Same labeled-guards constraint as phase 2: every guarded rule
 *   needs a `[label]` so the parametrization map has a stable key.
 *   Projections with any unlabeled guard are skipped.
 *
 * Skipped machines (phase 7):
 *   - unlabeled `given` guards on transition rules (phase-2 rule)
 *   - unlabeled `given` guards on projection rules (phase-7 rule)
 *
 * Skipped machines are recorded as comments at the top of the generated
 * file so users know why.
 */

import { basename } from "path";

interface RuleBinding { localName: string; fieldName: string; }

interface TransitionRule {
  from: string;
  to: string;
  guard: string | null;
  label: string | null;
  effectBody: string | null;
  fromBindings?: RuleBinding[] | null;
  toBindings?: RuleBinding[] | null;
  afterMs?: number | null;
  // §51.12.3.1 (S67) — computed-delay form (mirrored from emit-machines.ts /
  // type-system.ts). Mutually exclusive with afterMs.
  afterExpr?: string | null;
}

interface MachineLike {
  name: string;
  governedTypeName?: string;
  rules: TransitionRule[];
  isDerived?: boolean;
  auditTarget?: string | null;
  // §51.13 phase 4: the full variant list of the governed enum, used so
  // wildcard-to rules can enumerate every variant in the type even when
  // the rule itself doesn't mention each variant. When omitted, the
  // emitter falls back to the variants named in `rules`.
  governedTypeVariants?: string[];
}

// Phase 5 filter: only unlabeled guards still block the machine entirely.
// Guards (if labeled), payload bindings, wildcards, and temporal rules are
// all in-scope. Temporal rules contribute exclusivity + guard-coverage
// tests just like non-temporal rules; timer lifecycle is explicitly out
// of scope for auto-property-tests (covered by hand-written integration
// tests — see the file header).
function rulesAreInScope(rules: TransitionRule[]): { ok: boolean; reason?: string } {
  for (const r of rules) {
    if (r.guard && !r.label)
      return { ok: false, reason: "contains unlabeled `given` guards (phase 2 requires a `[label]`)" };
  }
  return { ok: true };
}

// Phase 5: if any rule carries a temporal clause, the machine should
// emit a suite-header note about the timer-lifecycle scope limit.
function hasTemporalRule(rules: TransitionRule[]): boolean {
  for (const r of rules) if (r.afterMs != null || r.afterExpr != null) return true;
  return false;
}

// Phase 7: scope check for derived / projection machines. Mirrors phase 2:
// every guarded rule must carry a `[label]` so the parametrization map has
// a stable key. Unguarded projections (phase 6) are still in scope.
function projectionIsInScope(rules: TransitionRule[]): { ok: boolean; reason?: string } {
  for (const r of rules) {
    if (r.guard && !r.label) {
      return {
        ok: false,
        reason: "derived machine has unlabeled `given` guard — phase 7 requires `[label]` on every guarded projection rule",
      };
    }
  }
  return { ok: true };
}

// Phase 6 / phase 7 helper: rules for a given source variant in declaration
// order. Phase 6 used the first one (always unguarded under that phase's
// gate); phase 7 walks the list to model first-match-wins with guards.
function rulesForSource(variant: string, rules: TransitionRule[]): TransitionRule[] {
  return rules.filter(r => r.from === variant);
}

// Phase 6: every source variant appears as some rule's `from` (§51.9
// exhaustiveness enforced by E-ENGINE-018 at compile time). Enumerate
// from the rules rather than threading a separate source-type handle.
function collectSourceVariants(rules: TransitionRule[]): string[] {
  const s = new Set<string>();
  for (const r of rules) s.add(r.from);
  return [...s].sort();
}

// Phase 5: format an afterMs annotation for test titles so users can see
// which pairs come from temporal rules in the emitted suite.
function temporalSuffix(rule: TransitionRule | null): string {
  if (rule && rule.afterMs != null) return ` (after ${rule.afterMs}ms)`;
  if (rule && rule.afterExpr != null) return ` (after computed delay)`;
  return "";
}

function collectVariants(rules: TransitionRule[], typeVariants?: string[]): string[] {
  const s = new Set<string>();
  if (typeVariants && typeVariants.length > 0) {
    for (const v of typeVariants) s.add(v);
  }
  for (const r of rules) {
    if (r.from !== "*") s.add(r.from);
    if (r.to !== "*") s.add(r.to);
  }
  return [...s].sort();
}

// Phase 4: reachability now honors wildcards.
//   - wildcard `from` (`*`) fires from any already-reachable variant
//   - wildcard `to` (`*`) marks every variant in `allVariants` as reachable
function reachableVariants(rules: TransitionRule[], initial: string, allVariants: string[]): Set<string> {
  const reached = new Set<string>([initial]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rules) {
      const fromMatches = r.from === "*" ? reached.size > 0 : reached.has(r.from);
      if (!fromMatches) continue;
      if (r.to === "*") {
        for (const v of allVariants) {
          if (!reached.has(v)) { reached.add(v); grew = true; }
        }
      } else {
        if (!reached.has(r.to)) { reached.add(r.to); grew = true; }
      }
    }
  }
  return reached;
}

// Phase 4: resolve which rule applies to a concrete (v, w) pair, mirroring
// emitTransitionGuard's fallback chain. Returns { rule, key } when matched
// (key is the matching table entry's from:to, useful for harness guardResults);
// null when no rule applies.
function resolveRule(v: string, w: string, rules: TransitionRule[]): { rule: TransitionRule; key: string } | null {
  const candidates = [`${v}:${w}`, `*:${w}`, `${v}:*`, `*:*`];
  for (const key of candidates) {
    const [from, to] = key.split(":");
    const rule = rules.find(r => r.from === from && r.to === to);
    if (rule) return { rule, key };
  }
  return null;
}

function variantLiteral(variant: string): string {
  return `{ variant: ${JSON.stringify(variant)} }`;
}

// Harness: tryTransition(from, to, guardResults = {}).
//   - Walks the four-step fallback chain from emitTransitionGuard:
//     exact, then *:To, then From:*, then *:*. Tracks __matchKey so
//     guardResults can key on the matched (possibly-wildcard) rule.
//   - If no rule matches: returns Error("E-ENGINE-001-RT: Illegal transition").
//   - If matched rule is a guard rule (table value is `{ guard: true }`):
//     reads guardResults[__matchKey]; if explicitly false → returns
//     Error("E-ENGINE-001-RT: Transition guard failed"). True/omitted → succeeds.
//   - If matched rule is unguarded (table value is `true`): succeeds.
function emitHarnessPrelude(engineName: string, tableName: string): string[] {
  const varName = `__autoTest_${engineName}`;
  return [
    `  // Fresh reactive var per describe — isolated from any user code.`,
    `  const VAR = ${JSON.stringify(varName)};`,
    `  function tryTransition(from, to, guardResults) {`,
    `    guardResults = guardResults || {};`,
    `    globalThis._scrml_reactive_store = globalThis._scrml_reactive_store || {};`,
    `    globalThis._scrml_reactive_store[VAR] = from;`,
    `    try {`,
    `      var __prev = globalThis._scrml_reactive_store[VAR];`,
    `      var __next = to;`,
    `      var __vFrom = (__prev != null && __prev.variant != null ? __prev.variant : "*");`,
    `      var __vTo = (__next != null && __next.variant != null ? __next.variant : "*");`,
    `      var __exact = __vFrom + ":" + __vTo;`,
    `      var __anyFrom = "*:" + __vTo;`,
    `      var __anyTo = __vFrom + ":*";`,
    `      var __anyAny = "*:*";`,
    `      var __matchKey = null, __rule = null;`,
    `      if (${tableName}[__exact] != null)       { __rule = ${tableName}[__exact]; __matchKey = __exact; }`,
    `      else if (${tableName}[__anyFrom] != null) { __rule = ${tableName}[__anyFrom]; __matchKey = __anyFrom; }`,
    `      else if (${tableName}[__anyTo] != null)   { __rule = ${tableName}[__anyTo]; __matchKey = __anyTo; }`,
    `      else if (${tableName}[__anyAny] != null)  { __rule = ${tableName}[__anyAny]; __matchKey = __anyAny; }`,
    `      if (__rule == null) {`,
    `        return new Error("E-ENGINE-001-RT: Illegal transition");`,
    `      }`,
    `      if (typeof __rule === "object" && __rule.guard) {`,
    `        var __guardPass = guardResults.hasOwnProperty(__matchKey) ? guardResults[__matchKey] : true;`,
    `        if (!__guardPass) {`,
    `          return new Error("E-ENGINE-001-RT: Transition guard failed");`,
    `        }`,
    `      }`,
    `      return null;`,
    `    } catch (e) { return e; }`,
    `  }`,
  ];
}

function emitMachineDescribe(m: MachineLike, initial: string | null): string[] {
  const lines: string[] = [];
  const variants = collectVariants(m.rules, m.governedTypeVariants);
  const reachable = initial ? reachableVariants(m.rules, initial, variants) : new Set(variants);

  const tableName = `__scrml_transitions_${m.name}`;

  // Inline the transition table — match the shape emit-machines.ts uses:
  // guarded rules get { guard: true }, unguarded get a bare true. The
  // harness relies on this shape to know when to consult guardResults.
  lines.push(`  const ${tableName} = {`);
  const entries: string[] = [];
  for (const r of m.rules) {
    const v = r.guard ? "{ guard: true }" : "true";
    entries.push(`    ${JSON.stringify(`${r.from}:${r.to}`)}: ${v}`);
  }
  lines.push(entries.join(",\n"));
  lines.push(`  };`);
  lines.push(``);

  for (const l of emitHarnessPrelude(m.name, tableName)) lines.push(l);
  lines.push(``);

  // Property (a) Exclusivity. For every reachable V and every variant W,
  // run resolveRule — it applies the same four-step fallback chain as the
  // harness and the real emitTransitionGuard. Declared pairs succeed
  // (with guardResults forcing any matched guard truthy); undeclared
  // pairs throw E-ENGINE-001-RT.
  for (const v of variants) {
    if (!reachable.has(v)) continue;
    for (const w of variants) {
      const match = resolveRule(v, w, m.rules);
      if (match != null) {
        const wildcardNote = match.key !== `${v}:${w}` ? ` (via wildcard ${match.key})` : "";
        const temporal = temporalSuffix(match.rule);
        const title = match.rule.guard
          ? `declared .${v} => .${w} (guarded${wildcardNote})${temporal} succeeds when guard truthy`
          : `declared .${v} => .${w}${wildcardNote}${temporal} succeeds`;
        lines.push(`  test(${JSON.stringify(title)}, () => {`);
        const guardArg = match.rule.guard
          ? `, { ${JSON.stringify(match.key)}: true }`
          : "";
        lines.push(`    const result = tryTransition(${variantLiteral(v)}, ${variantLiteral(w)}${guardArg});`);
        lines.push(`    expect(result).toBeNull();`);
        lines.push(`  });`);
      } else {
        const title = `undeclared .${v} => .${w} rejected`;
        lines.push(`  test(${JSON.stringify(title)}, () => {`);
        lines.push(`    const result = tryTransition(${variantLiteral(v)}, ${variantLiteral(w)});`);
        lines.push(`    expect(result).toBeInstanceOf(Error);`);
        lines.push(`    expect(result.message).toMatch(/E-ENGINE-001-RT/);`);
        lines.push(`  });`);
      }
    }
  }

  // Property (c) Guard coverage — labeled `given` guards get a failing
  // test (the passing case is covered by the exclusivity loop above).
  // For a wildcard-guarded rule, pick a concrete representative pair
  // that *actually resolves to this rule* (a more-specific non-wildcard
  // rule would pre-empt it otherwise). If no such pair exists among the
  // reachable variants, the labeled guard is unreachable and we skip its
  // failing test with a comment.
  const labeledGuardRules = m.rules.filter(r => r.guard && r.label);
  for (const r of labeledGuardRules) {
    const ruleKey = `${r.from}:${r.to}`;
    // Find (v, w) that resolves to this rule. For the concrete rule
    // itself the answer is trivial; for wildcards we search the reachable
    // grid.
    let repV: string | null = null;
    let repW: string | null = null;
    for (const v of variants) {
      if (!reachable.has(v)) continue;
      for (const w of variants) {
        const m2 = resolveRule(v, w, m.rules);
        if (m2 && m2.key === ruleKey) {
          repV = v; repW = w;
          break;
        }
      }
      if (repV != null) break;
    }
    if (repV == null || repW == null) {
      lines.push(`  // (skip) guard [${r.label}] on .${r.from} => .${r.to}: no reachable pair resolves to this rule.`);
      continue;
    }
    const wildcardNote = ruleKey !== `${repV}:${repW}` ? ` (via wildcard ${ruleKey})` : "";
    const temporal = temporalSuffix(r);
    const failTitle = `guard [${r.label}] on .${r.from} => .${r.to}${wildcardNote}${temporal}: rejected when guard falsy`;
    lines.push(`  test(${JSON.stringify(failTitle)}, () => {`);
    lines.push(`    const result = tryTransition(${variantLiteral(repV)}, ${variantLiteral(repW)}, { ${JSON.stringify(ruleKey)}: false });`);
    lines.push(`    expect(result).toBeInstanceOf(Error);`);
    lines.push(`    expect(result.message).toMatch(/Transition guard failed/);`);
    lines.push(`  });`);
  }

  return lines;
}

// Phase 7: emit the projection-test block for a derived machine. Inlines
// a guard-results-parametrized projection function (parallel to
// emitProjectionFunction in emit-machines.ts §51.9), then walks each
// source variant's rules in declaration order to emit:
//   - one test per guarded rule asserting it fires when its label is true
//     and all earlier guards are false
//   - one terminal test asserting the unguarded fallback fires (or
//     `undefined` when no fallback exists) once all guards are false
//
// Phase 6 (unguarded projections) is the strict subset where every rule
// is unguarded — collapses to one test per source variant.
function emitProjectionDescribe(m: MachineLike): string[] {
  const lines: string[] = [];
  const fnName = `__project_${m.name}`;
  const sourceVariants = collectSourceVariants(m.rules);

  // Inline the projection function. Mirrors emitProjectionFunction except
  // a guard rule's predicate is replaced with a lookup into the supplied
  // `guardResults` map (keyed on the rule's label). Unguarded rules behave
  // identically to phase 6.
  lines.push(`  function ${fnName}(src, guardResults) {`);
  lines.push(`    guardResults = guardResults || {};`);
  lines.push(`    var tag = (src != null && typeof src === "object") ? src.variant : src;`);
  for (const rule of m.rules) {
    if (rule.guard) {
      // projectionIsInScope guarantees rule.label is present when guard is.
      const labelLit = JSON.stringify(rule.label);
      lines.push(`    if (tag === ${JSON.stringify(rule.from)} && guardResults[${labelLit}]) return ${JSON.stringify(rule.to)};`);
    } else {
      lines.push(`    if (tag === ${JSON.stringify(rule.from)}) return ${JSON.stringify(rule.to)};`);
    }
  }
  // Defensive fallthrough — canonical absence is `null` per M-7C-D-12
  // (avoids W-CG-UNDEFINED-INTERPOLATION leak in compiled property-test
  // output).
  lines.push(`    return null;`);
  lines.push(`  }`);
  lines.push(``);

  for (const src of sourceVariants) {
    const srcRules = rulesForSource(src, m.rules);
    if (srcRules.length === 0) continue; // shouldn't happen — exhaustiveness

    // Walk rules in declaration order. Build the cumulative `guardResults`
    // map for the test: every earlier guarded rule's label set to `false`,
    // the rule under test set to `true`. The unguarded terminal (if any)
    // gets a separate test with all earlier guards false.
    const earlierFalseLabels: string[] = [];

    for (let i = 0; i < srcRules.length; i++) {
      const r = srcRules[i];
      if (r.guard) {
        const truthyMap = buildGuardResultsMap(earlierFalseLabels, r.label!, true);
        const title = `projects .${src} => .${r.to} when [${r.label}] truthy`;
        lines.push(`  test(${JSON.stringify(title)}, () => {`);
        lines.push(`    expect(${fnName}({ variant: ${JSON.stringify(src)} }, ${truthyMap})).toBe(${JSON.stringify(r.to)});`);
        lines.push(`  });`);
        earlierFalseLabels.push(r.label!);
      } else {
        // Unguarded fallback — emit one test with all earlier guards false.
        // Later rules (if any) are unreachable for this source variant.
        const fallbackMap = buildGuardResultsMap(earlierFalseLabels, null, false);
        const guardClause = earlierFalseLabels.length > 0
          ? ` (after ${earlierFalseLabels.length} guard${earlierFalseLabels.length === 1 ? "" : "s"} falsy)`
          : "";
        const title = `projects .${src} => .${r.to}${guardClause}`;
        lines.push(`  test(${JSON.stringify(title)}, () => {`);
        lines.push(`    expect(${fnName}({ variant: ${JSON.stringify(src)} }, ${fallbackMap})).toBe(${JSON.stringify(r.to)});`);
        lines.push(`  });`);
        break; // unreachable rules after an unguarded match
      }
    }

    // If we exited the loop without hitting an unguarded fallback, emit
    // the all-falsy → undefined terminal test. §51.9 exhaustiveness usually
    // forces an unguarded rule per source, but this safety belt covers any
    // path the spec leaves open.
    const lastWasUnguarded = srcRules.some(r => !r.guard);
    if (!lastWasUnguarded) {
      const allFalseMap = buildGuardResultsMap(earlierFalseLabels, null, false);
      const title = `.${src} → undefined when all guards falsy`;
      lines.push(`  test(${JSON.stringify(title)}, () => {`);
      lines.push(`    expect(${fnName}({ variant: ${JSON.stringify(src)} }, ${allFalseMap})).toBeUndefined();`);
      lines.push(`  });`);
    }
  }

  return lines;
}

// Build a JS object literal mapping each label in `falseLabels` to false,
// optionally setting `trueLabel` to true. Empty map renders as `{}`.
function buildGuardResultsMap(
  falseLabels: string[],
  trueLabel: string | null,
  _trueLabelValue: boolean,
): string {
  const entries: string[] = [];
  for (const l of falseLabels) entries.push(`${JSON.stringify(l)}: false`);
  if (trueLabel != null) entries.push(`${JSON.stringify(trueLabel)}: true`);
  return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
}

/**
 * §51.13 port (S307) — project a MODERN `<engine>`'s state-children into the
 * `TransitionRule[]` shape this generator's machinery already consumes.
 *
 * The gap (`g-machine-tests-modern-engine-vacuous`) read as "NOT a trivial
 * re-wire, the whole collectVariants/reachableVariants/resolveRule machinery
 * keys off the `m.rules` shape". That is true and it is the reason NOT to
 * re-point the machinery: the cheaper and far less risky move is to FEED it.
 * A state-child `rule=` graph and an arrow-rules body express the same
 * `(from, to)` relation, so the port is a projection, not a rewrite — the
 * machinery is untouched and every existing legacy path keeps its behaviour.
 *
 * Rule forms map per §51.0.F (openers written without their closing slash here,
 * because a literal `rule=*` followed by a slash would end this comment):
 *   `rule=.B`         → one rule  A→B
 *   `rule=(.B | .C)`  → two rules A→B, A→C
 *   `rule=*`          → A→`*` (the machinery already treats `*` as the wildcard
 *                       sentinel — the same encoding the legacy `* => *`
 *                       struct-guard form produces)
 *   no `rule=` at all → no outgoing rules; A is terminal, which is exactly what
 *                       `reachableVariants` needs to see.
 * `legacy-arrow` / `parse-error` forms are SKIPPED — they already carry their
 * own diagnostic (E-ENGINE-RULE-LEGACY-SYNTAX / B15), and inventing transitions
 * from an unparseable rule would generate assertions about a graph the author
 * never wrote.
 */
export function projectStateChildRules(
  stateChildren: { tag: string; rule: { kind: string; target?: string; targets?: string[] } }[] | null | undefined,
): TransitionRule[] {
  if (!Array.isArray(stateChildren)) return [];
  const rules: TransitionRule[] = [];
  for (const sc of stateChildren) {
    if (!sc || typeof sc.tag !== "string" || !sc.rule) continue;
    const r = sc.rule;
    if (r.kind === "single" && typeof r.target === "string") {
      rules.push({ from: sc.tag, to: r.target } as TransitionRule);
    } else if (r.kind === "multi" && Array.isArray(r.targets)) {
      for (const t of r.targets) rules.push({ from: sc.tag, to: t } as TransitionRule);
    } else if (r.kind === "wildcard") {
      rules.push({ from: sc.tag, to: "*" } as TransitionRule);
    }
    // "absent" → terminal; "legacy-arrow"/"parse-error" → diagnosed elsewhere.
  }
  return rules;
}

/**
 * Generate the machine property-test JS for a file.
 *
 * `stateChildRules` (S307) maps a machine NAME to the projection above. A
 * machine whose own `rules` are empty — the modern `<engine>` state-child form —
 * is generated from its projection instead, so the canonical engine surface
 * stops emitting a vacuous artifact. Optional: omitted, behaviour is unchanged.
 */
export function generateMachineTestJs(
  filePath: string,
  machineRegistry: Map<string, MachineLike> | null | undefined,
  initialVariants: Map<string, string>,
  stateChildRules?: Map<string, TransitionRule[]> | null,
): string | null {
  if (!machineRegistry || machineRegistry.size === 0) return null;

  const fileName = basename(filePath);
  const lines: string[] = [];
  const skipNotes: string[] = [];
  const emittedBlocks: string[][] = [];

  for (const [name, machineRaw] of machineRegistry) {
    // S307 — a machine with no rules of its own may be a MODERN `<engine>`,
    // whose transitions live in state-children. Substitute the projection so
    // the rest of this function is identical for both surfaces.
    let machine = machineRaw;
    if ((!machine.rules || machine.rules.length === 0) && stateChildRules) {
      const projected = stateChildRules.get(name);
      if (projected && projected.length > 0) {
        machine = { ...machineRaw, rules: projected } as MachineLike;
      }
    }
    if (!machine.rules || machine.rules.length === 0) {
      skipNotes.push(`// Skipped ${name}: empty rule set.`);
      continue;
    }

    // Phase 6: derived / projection machines take a distinct path.
    if (machine.isDerived) {
      const projCheck = projectionIsInScope(machine.rules);
      if (!projCheck.ok) {
        skipNotes.push(`// Skipped ${name}: ${projCheck.reason}.`);
        continue;
      }
      const block: string[] = [];
      const label = `[generated] projection machine ${name}`;
      block.push(`describe(${JSON.stringify(label)}, () => {`);
      for (const l of emitProjectionDescribe(machine)) block.push(l);
      block.push(`});`);
      emittedBlocks.push(block);
      continue;
    }

    const scopeCheck = rulesAreInScope(machine.rules);
    if (!scopeCheck.ok) {
      skipNotes.push(`// Skipped ${name}: ${scopeCheck.reason} — see §51.13 phased implementation.`);
      continue;
    }

    // Phase 4: pull the governed enum's full variant list out of the
    // resolved type if the registry carried it through, so wildcard-to
    // rules can enumerate every variant in the type.
    const govType = (machine as any).governedType;
    const govVariants: string[] | undefined = govType && Array.isArray(govType.variants)
      ? govType.variants.map((v: any) => v.name).filter((n: any) => typeof n === "string")
      : machine.governedTypeVariants;
    const enriched: MachineLike = { ...machine, governedTypeVariants: govVariants };

    const block: string[] = [];
    const label = `[generated] machine ${name}`;
    block.push(`describe(${JSON.stringify(label)}, () => {`);
    for (const l of emitMachineDescribe(enriched, initialVariants.get(name) ?? null)) {
      block.push(l);
    }
    block.push(`});`);
    emittedBlocks.push(block);
  }

  if (emittedBlocks.length === 0 && skipNotes.length === 0) return null;

  // Phase 5 scope note: if any emitted machine uses temporal rules, call
  // out that timer-lifecycle behavior is deliberately outside this
  // suite's remit. The hand-written temporal tests cover it.
  const anyTemporal = [...machineRegistry.values()].some(
    m => !m.isDerived && Array.isArray(m.rules) && hasTemporalRule(m.rules),
  );

  lines.push(`// §51.13 auto-generated machine property tests — do not edit.`);
  lines.push(`// Source: ${fileName}`);
  if (anyTemporal) {
    lines.push(`// Note: temporal rules (.From after Ns => .To) contribute exclusivity`);
    lines.push(`// and guard-coverage tests only. Timer lifecycle (arm on entry, clear`);
    lines.push(`// on exit, reset on reentry) is outside this suite's scope — cover it`);
    lines.push(`// with hand-written integration tests against the real runtime.`);
  }
  lines.push(`import { test, expect, describe } from "bun:test";`);
  lines.push(``);
  if (skipNotes.length > 0) {
    for (const n of skipNotes) lines.push(n);
    lines.push(``);
  }
  if (emittedBlocks.length === 0) {
    // S307 — this used to emit `test("no qualifying machines", () => {
    // expect(true).toBe(true); })`: a PASSING assertion that verifies nothing.
    // It is the pa-base §8 hollow-gate shape, and it is worse here than usual
    // because the artifact is AUTO-GENERATED and lands in an adopter's suite as
    // a green tick. It reports green for the canonical modern `<engine>` state-
    // child `rule=` form (`g-machine-tests-modern-engine-vacuous`), so the
    // shape most likely to hit it is the one we tell people to write.
    //
    // A SKIP is honest — it reports as skipped, not passed — and it names why.
    // The real fix (re-pointing the generator at the state-child rule graph) is
    // that gap, not this: this only stops the false green.
    const why = skipNotes.length > 0
      ? skipNotes.map((n) => n.replace(/^\/\/\s*/, "")).join(" | ")
      : "no machine in this file had a rule set the generator can read";
    lines.push(`describe(${JSON.stringify(`[generated] ${fileName}`)}, () => {`);
    lines.push(`  // Deliberately SKIPPED, not passed: there is nothing to assert here.`);
    lines.push(`  test.skip(${JSON.stringify(`no qualifying engines — ${why}`)}, () => {});`);
    lines.push(`});`);
    lines.push(``);
    return lines.join("\n");
  }

  for (const block of emittedBlocks) {
    for (const l of block) lines.push(l);
    lines.push(``);
  }

  return lines.join("\n");
}
