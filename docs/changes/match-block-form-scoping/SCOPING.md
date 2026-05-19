# `<match>` block-form — SPEC §18.0 implementation arc

**Filed:** 2026-05-19 (S107)
**Surface:** parser (block-splitter / ast-builder), SYM passes, codegen (emit-html / emit-client), type-system bare-variant inference + payload binding, sample fixtures + tests
**Discovered during:** S107 README clarification on `rule=` semantics at Tier 1. User asked PA to make explicit "rule= accepted + compiler-checked but inert at runtime" — investigation surfaced that W-MATCH-RULE-INERT (§18.0.2) is spec'd but unimplemented. Walker-impl attempt then surfaced the deeper finding: the ENTIRE `<match>` block-form (§18.0.1 + §18.0.2 + §18.0.3) is spec'd but the parser captures the whole block as a single `kind: "html-fragment"` AST node — no structural arm-children, no exhaustiveness check, no rule= validation, no payload binding.
**Severity:** **MED-HI.** L7 architectural lock (match attrs — rules-inert + effect/onTransition engine-only) + the Tier 1 promotion path between booleans and engines depends on this surface. README documents the nominal semantics; today's compiler accepts the syntax mechanically (because it doesn't actually parse it) but provides zero of the safety guarantees the spec promises. The whole Tier 0/1/2 ladder's middle rung is unrealized.
**Authority for SPEC normative-statement compliance:** pa.md Rule 4 (SPEC is normative; derived docs are NOT). All citations below are pulled from `compiler/SPEC.md` directly.

**Verified at HEAD `c4d1114` (S107):** reproducer compiles "successfully" but as opaque HTML pass-through. Three observable confirmations:
1. AST inspection — entire `<match>...</>` block lives in `kind: "html-fragment"` with raw text content (NOT structured `match-block` / `match-arm` nodes)
2. Missing-variant case (`<match for=Phase>` with only 2 of 3 arms) — silently compiles; E-MATCH-NOT-EXHAUSTIVE never fires
3. `rule=NextVariant` on arm-children — silently accepted; W-MATCH-RULE-INERT never fires

---

## §1 Reproducer (minimal)

`/tmp/match-rule-repro.scrml`:

```scrml
<program>
type Phase:enum = { Idle, Loading, Done }
<phase>:Phase = Phase.Idle

<match for=Phase on=@phase>
    <Idle rule=Loading> : <p>Idle</p>
    <Loading rule=Done> : <p>Loading</p>
    <Done> : <p>Done</p>
</>
</program>
```

Compile via:

```bash
bun run compiler/src/cli.js compile /tmp/match-rule-repro.scrml
```

---

## §2 Observed output (compiler today)

**AST shape (per `splitBlocks` + `buildAST` inspection):**

The `<match for=Phase on=@phase>...</>` block emerges as a SINGLE `kind: "html-fragment"` node nested inside a synthetic `kind: "logic"` wrapper:

```js
{
  kind: "logic",
  body: [
    {
      id: 4,
      kind: "html-fragment",
      content: "< match for = Phase on = @phase >\n< Idle rule = Loading > : < p > Idle < / p >\n< Loading rule = Done > : < p > Loading < / p >\n< Done > : < p > Done < / p >\n< / >"
    }
  ],
  _synthetic: true
}
```

The arm-children (`<Idle>`, `<Loading>`, `<Done>`) + their `rule=` attributes + the `:`-shorthand body forms + the `<match>` opener attributes (`for=`, `on=`) are ALL inside the raw text. The compiler has no structural handle on any of them.

**Compile output:**

```
info  [W-PROGRAM-SPA-INFERRED]: ...
warn  [E-DG-002]: Reactive variable `@phase` is declared but never consumed
Compiled 1 file in 42ms
```

**Zero match-block-aware diagnostics fire** even when the source clearly demonstrates spec-defined violation conditions:

| Source pattern | Spec says (§) | Today |
|---|---|---|
| `<match for=Phase>` missing arms for one or more variants | E-MATCH-NOT-EXHAUSTIVE (§18.0.1 line 9594) | **silent** |
| `<Idle rule=Loading>` on a match arm-child | W-MATCH-RULE-INERT (§18.0.2 line 9625) | **silent** |
| `<Idle effect=fn>` on a match arm-child | E-MATCH-EFFECT-FORBIDDEN (§18.0.2 line 9626) | **silent** |
| `<onTransition>` element inside a match block | E-MATCH-ONTRANSITION-FORBIDDEN (§18.0.2 line 9627) | **silent** |
| `<Ready(rows)>` payload-binding pattern | §18.0.1 line 9581-9583 normative | **silent** (binding doesn't resolve) |
| Bare-variant inference `<Small>` against `for=MarioState` | §18.0.3 line 9639-9656 | **partially functional via the existing §14.10 path inside the html-fragment text** |

**HTML output:**

The raw text passes through to `dist/<file>.html` as-is. Since `<match>` / `<Idle>` / `<Loading>` / `<Done>` are NOT HTML elements, the browser silently ignores them — the page renders empty in the match region. No runtime dispatch. No reactivity.

**Net result for an adopter:** `<match for=Phase on=@phase>` looks correct syntactically (matches the SPEC's published surface), accepted by the compiler without error, produces ZERO output in the browser, and triggers ZERO of the safety lints that motivate Tier 1 over Tier 0 (if=) in the first place. The Tier 1 rung of the case-analysis ladder is structurally absent.

---

## §3 Spec verification (pa.md Rule 4 — SPEC is normative)

All citations from `compiler/SPEC.md`. PRIMER + README + articles are derivative and do not control.

### §17.0 (Tier 0/1/2 ladder) [line ~8503]

The case-analysis ladder explicitly names `<match for=Type [on=expr]>` as Tier 1 — the structural-exhaustiveness rung between Tier 0 (`if=` chains) and Tier 2 (`<engine>`). The promotion path is wrapper-swap-only: state-children carry forward verbatim from Tier 1 to Tier 2. This requires Tier 1 to actually exist structurally.

### §18.0 Two match shapes [line 9536+]

> scrml has TWO match forms, distinguished by **syntactic context**:
>
> | Shape | Syntax | Used in | Tier |
> |---|---|---|---|
> | **Block-form** | `<match for=Type [on=expr]> ... </>` | Markup-emit context (UI case-analysis on enums) | Tier 1 of §17.0 ladder |
> | **JS-style** | `match expr { .Variant => ... }` | Value-return context (server logic, derivations, computed expressions) | (pre-existing form) |
>
> Both shapes share a single internal AST and the same exhaustiveness-checking pass — only the surface syntax and the output category (markup vs value) differ.

**Key normative claim:** "Both shapes share a single internal AST." Today this is FALSE — JS-style produces a `MatchExpr` AST node (§18.1 line 9679+), block-form produces an `html-fragment`. They share nothing.

### §18.0.1 Block-form syntax [line 9561-9617]

Specifies REQUIRED `for=Type`, optionally REQUIRED `on=expr` (REQUIRED unless an `<engine for=Type>` is in scope, in which case auto-implied to the engine's auto-declared variable). State-children: variant-name tags with optional `(payload)` binding. Body forms: self-closing, bare-body, `:`-shorthand. Exhaustiveness: every variant of `Type` has a matching state-child OR `<_>` wildcard catch-all; otherwise E-MATCH-NOT-EXHAUSTIVE.

### §18.0.2 Match attributes [line 9618-9637]

`rule=` LEGAL but INERT → W-MATCH-RULE-INERT (warning). `effect=` FORBIDDEN → E-MATCH-EFFECT-FORBIDDEN. `<onTransition>` FORBIDDEN → E-MATCH-ONTRANSITION-FORBIDDEN. All three diagnostics catalogued in §34 lines 14807-14809.

### §18.0.3 Bare-variant inference in arm patterns [line 9639-9675]

Block-form arm tags MAY omit the type qualifier when the matched-on type is statically known. Ambiguous case (union with multiple enums sharing a variant name) fires E-VARIANT-AMBIGUOUS (§34). Cross-ref §14.10 for the general bare-variant inference rule.

### §34 catalog rows (verbatim)

| Code | Line | Severity | Description |
|---|---|---|---|
| E-MATCH-NOT-EXHAUSTIVE | 14810 | Error | Block-form match missing variants and no wildcard (§18.0.1) |
| E-MATCH-EFFECT-FORBIDDEN | 14808 | Error | `effect=` attribute used on a state-child inside a `<match>` block (§18.0.2) |
| E-MATCH-ONTRANSITION-FORBIDDEN | (cross-ref §18.0.2) | Error | `<onTransition>` element inside a `<match>` block (§18.0.2) |
| W-MATCH-RULE-INERT | 14807 | Warning | `rule=` declared on a state-child inside a `<match>` block (§18.0.2) |
| E-VARIANT-AMBIGUOUS | (§34) | Error | Bare variant in ambiguous position (§14.10 + §18.0.3) |

All catalog rows exist in §34 today — the codes are reserved + documented. Just unimplemented.

### Spec authority shape

The block-form is spec-canonical (S57 D2.8, 2026-05-04 — over a year before this SCOPING). The implementation is the gap. Per pa.md Rule 4, the SPEC wins; the compiler must catch up.

---

## §4 Root cause analysis

### Site 1 — parser (`block-splitter.js` + `ast-builder.js`)

The block-splitter (BS) layer recognizes `<engine>` and `<schema>` and similar structural elements via dedicated tag-aware parsing (delegates to `engine-statechild-parser.ts` for engine arms). For `<match>`, no equivalent dispatch exists — the tag falls through to the generic markup path, which TAB (ast-builder) eventually treats as `html-fragment` content because the arm-children's PascalCase tags don't match any known structural-element registry entry AND the `:`-shorthand body form combined with the variant-name tag confuses the standard markup parser into giving up + dumping the raw text into an html-fragment node.

Evidence: `compiler/src/engine-statechild-parser.ts` exists; `compiler/src/match-statechild-parser.ts` does NOT. The 4 grep hits for "match block-form" in `compiler/src/ast-builder.js` are all error-message strings inviting the user to use `<match for=Type>...</match>` — not parse rules that recognize it.

### Site 2 — SYM passes (none exist for match)

`compiler/src/symbol-table.ts` has 19 SYM passes (B1-B22, A5-3, A6-3, A4-S105). NONE walk match-block AST shapes — because match-block AST shapes don't exist. The 4 spec'd diagnostics (E-MATCH-NOT-EXHAUSTIVE, W-MATCH-RULE-INERT, E-MATCH-EFFECT-FORBIDDEN, E-MATCH-ONTRANSITION-FORBIDDEN) have no fire sites in the compiler source.

### Site 3 — codegen (no per-arm dispatch)

`compiler/src/codegen/emit-html.ts` + `emit-engine.ts` handle engine state-child runtime dispatch (read the engine variable's current variant, render the matching arm body via the engine's render function table, swap on transitions). For `<match>`, no equivalent emitter exists. The html-fragment node containing the raw match-block text passes through unchanged to dist/ HTML, producing literal `<match>` and `<Idle>` text in the browser DOM (which renders as nothing — those aren't HTML elements).

### Site 4 — type-system (§18.0.3 bare-variant inference)

The general bare-variant inference path at §14.10 / type-system.ts exists for `<Variant>` references in JS-style match arms + other type-statically-known positions. For block-form arm-tags, the type context is "the for=Type of the enclosing `<match>`" — but the type-system never sees those arm-tags as structured nodes (they're text inside html-fragment). So bare-variant inference can't fire there either.

---

## §5 Fix-shape phases

Five-phase impl arc. Each phase is independently testable + ships value; can be sequenced across multiple sessions.

### Phase 1 — Parser (new `match-block` AST node) — ~3-5h

**Goal:** structured AST for `<match for=Type [on=expr]>` blocks; arm-children parsed into a dedicated `match-arm` node kind (or reuse markup with annotation per OQ-MB-2 below).

**Sub-steps:**
1. Add `parseMatchBlock(...)` to `ast-builder.js` (or new `match-statechild-parser.ts` mirroring `engine-statechild-parser.ts`). Recognize `<match` opener, parse `for=` + optional `on=` attributes, then iterate arm-children.
2. Arm-children parser: each child markup-opener whose tag is PascalCase (or `_` for wildcard) becomes a `match-arm` node with: `variantName`, `payloadBindings: PayloadBinding[]`, `attrs: AttrNode[]`, `body: ASTNode[] | ExprNode | null`. Body forms: self-closing → null; `:`-shorthand → single ExprNode; bare-body → ASTNode[].
3. Payload-binding parser: `<Ready(rows)>` → `payloadBindings: [{name: "rows"}]`; `<Ready(rows: r)>` → `[{fieldName: "rows", boundName: "r"}]`. Mirror §51.0.B.1 engine state-child parenthesized form (OQ-MB-3).
4. Wildcard arm: `<_>` parses as `match-arm` with `isWildcard: true`. Body forms identical to variant arms.
5. Stop recognition at first non-arm child (or fire structural error). Match-block must contain only `match-arm` children + optional whitespace.

**Tests:** parser unit tests for each arm shape (self-closing, `:`-shorthand, bare-body), payload-binding forms, wildcard, missing `for=`, missing `on=` when no engine in scope.

**Out-of-scope this phase:** SYM diagnostics + codegen emit. The AST shape just needs to be CORRECT — downstream phases consume it.

### Phase 2 — SYM passes (4 diagnostics + bare-variant resolution) — ~2-3h

**Goal:** fire all 4 §18.0.2 diagnostics + integrate §18.0.3 bare-variant inference.

**Sub-steps:**
1. New SYM PASS 20 (`walkValidateMatchBlocks`): walks the AST, finds `match-block` nodes. For each:
   - Fire E-MATCH-NOT-EXHAUSTIVE if the for=Type's variants are not all covered (and no `<_>` wildcard present)
   - For each `match-arm`, fire W-MATCH-RULE-INERT on any `rule=` attribute
   - For each `match-arm`, fire E-MATCH-EFFECT-FORBIDDEN on any `effect=` attribute
   - Scan arm-bodies for `<onTransition>` markup children, fire E-MATCH-ONTRANSITION-FORBIDDEN
2. Bare-variant resolution: when `match-arm.variantName` is bare (no qualifier), resolve against `match-block.forType`. Type-system extension or symbol-table lookup — depends on existing §14.10 reuse story (OQ-MB-4).
3. Auto-implied `on=`: when omitted, check for an `<engine for=Type>` in scope. If found, synthesize `on=@<engineVar>`. If not found, fire structural error (which §18.0.1 line 9615-9616 promises but doesn't name a code for — probably needs §34 catalog row, OQ-MB-5).
4. Payload-binding resolution: bind `payloadBindings` names into the arm body's scope.

**Tests:** SYM tests per code (one fixture per diagnostic). Negative regression: well-formed match-block produces zero diagnostics.

### Phase 3 — Codegen (per-arm render dispatch) — ~3-5h

**Goal:** emit per-arm render dispatch that reads the matched-on value at runtime + renders the right arm body.

**Sub-steps:**
1. New emitter (`emit-match.ts` or extend `emit-html.ts`): per `match-block` AST node, generate:
   - HTML placeholder span (`<span data-scrml-match="<id>"></span>`)
   - Client JS render function: `function _scrml_match_<id>_render() { const v = <on-expr>; switch (v.tag) { case "<Variant>": innerHTML = ...; ... default: ... } }`
   - Reactive subscription to the on-expr's dependencies
2. Per-arm body emission: each arm body emitted as an innerHTML-producing snippet, with payload bindings as locals in scope
3. Wildcard arm: default branch in the switch
4. Self-closing arm body: empty string

**Tests:** codegen tests asserting HTML placeholder shape + client JS dispatch shape; browser test for runtime arm-swap on reactive cell change.

### Phase 4 — Bare-variant inference + payload-binding edge cases — ~2-3h

**Goal:** Tier 1 surface parity with the SPEC §18.0.3 + §51.0.B.1 surfaces.

**Sub-steps:**
1. §18.0.3 ambiguous-case detection — when matched-on type is a UNION and multiple union members share a variant name → fire E-VARIANT-AMBIGUOUS on the bare arm pattern.
2. Payload-binding type inference — bound names get the variant's field types. Reuse §14.10 + §51.0.B.1 infrastructure if possible.
3. `<_>` wildcard arm interaction with exhaustiveness — `<_>` makes exhaustiveness trivially-satisfied; other arms STILL need to be valid variants.

**Tests:** edge cases for each.

### Phase 5 — Sample fixtures + integration tests + docs — ~2-3h

**Goal:** real-world adopter-facing validation + close out.

**Sub-steps:**
1. Add a sample `samples/compilation-tests/match-block/` directory with 3-5 canonical match-block patterns (Tier-1 RemoteData, simple variant dispatch, payload-binding, wildcard fallback, missing-variant negative case)
2. Add browser test demonstrating runtime arm-swap on reactive transition
3. Update `examples/` if any example currently uses `<match>` block-form (likely it would have failed silently before — confirm + verify post-fix renders correctly)
4. Update PRIMER §7 / §18 framing (PA-internal — match-block now fully implemented; remove "spec'd but not yet wired" qualifiers if any)
5. Update changelog with phase-by-phase landing dates + commit SHAs

### Total estimate: ~12-19h (was the user-surfaced estimate; SCOPING confirms)

---

## §6 PA recommendation

**Sequenced PA-direct phases**, one per session-shaped chunk. The SCOPING ships this session standalone (no impl); Phase 1 dispatches PA-direct next session (or now if budget remains) → Phase 2 → Phase 3 → Phase 4 → Phase 5.

**Why PA-direct over agent-dispatched:** the implementation touches 4+ files in tight integration (parser ↔ AST schema ↔ SYM walker ↔ codegen emitter). Agent dispatch shines on parallel-independent surfaces; this work is serially-dependent. PA-direct with per-phase commits gives clean per-phase test gating + reversibility.

**Per-phase commit shape:** each phase = one commit message starting `feat(match-block): Phase N — <title>`, with tests + cross-refs to this SCOPING. Mirror Bug 5 Phase 1/2 commit pattern.

**README posture:** the existing README clarification (the rule= sentence + table row) stays as-written per S107 user direction — it describes the nominal language, consistent with the designer's note: *"This document describes the nominal language at the time of any version release. It does not describe what the compiler is perfectly capable of doing."* The implementation arc closes the gap between nominal and actual.

---

## §7 Open questions

**Q-MB-1 — AST node kind name. RATIFIED S107 (2026-05-19) — New `match-block` kind.** Dedicated AST node; downstream walkers (SYM, emitters) discriminate structurally without per-node flag checks. Phase 1 introduces the kind; existing markup-walking helpers get a `match-block` branch added (small per-helper change).

**Q-MB-2 — Arm-child node kind.** Same axis as Q-MB-1 but for arm-children. Three options: (a) new `match-arm` kind; (b) reuse `markup` with `_isMatchArm: true`; (c) reuse the engine state-child shape (whatever name that uses). PA leans (c) if the engine state-child node kind is well-shaped — avoids parallel near-duplicate node kinds; cross-Tier promotion (Tier 1 match → Tier 2 engine via wrapper swap per §17.0) becomes a trivial parent-kind change with body verbatim.

**Q-MB-3 — Payload binding shape mirror vs duplicate. RATIFIED S107 (2026-05-19) — Reuse §51.0.B.1 parenthesized-form parser directly.** §18.0.1 line 9586-9588 explicitly restricts `<match>` arm payload to the parenthesized form (`<Ready(rows)>`); bare-attribute and named forms are normatively §51-locus only. The parenthesized-form parser shipped in S98 (engine state-child); Phase 1 invokes it directly for match-arm payload parsing. Zero parallel surfaces.

**Q-MB-4 — Bare-variant inference reuse.** §14.10 (M9, S68) + §18.0.3 — does the existing bare-variant infrastructure (B20 PASS landed S68) generalize to match-block arm-tags as-is, or does it need a new entry point? PA needs to inspect the B20 walker shape during Phase 2 dispatch; surface as a sub-OQ at that time. Provisional: reusable with a "type context = `match-block.forType`" injection.

**Q-MB-5 — Missing-`on=`-when-no-engine-in-scope error code. RATIFIED S107 (2026-05-19) — New §34 row `E-MATCH-ON-REQUIRED`.** Self-documenting, parity with sibling E-MATCH-* naming. Phase 2 adds the §34 catalog row + the corresponding normative bullet in §18.0.1 specifying the diagnostic name. Single fire-site: SYM PASS that resolves auto-implied `on=` and fails the lookup.

**Q-MB-6 — Parser locus.** New `match-statechild-parser.ts` (mirrors `engine-statechild-parser.ts`) vs extend `engine-statechild-parser.ts` to dual-purpose with a `mode: "match" | "engine"` discriminator vs inline parser in `ast-builder.js`. PA leans separate file `match-statechild-parser.ts` to keep the engine parser focused; the parsers diverge on rule= disposition (engine: structural validation; match: lint), attribute legality (engine: rule/effect/onTransition all OK; match: rule warn, effect/onTransition forbidden), runtime-dispatch shape (engine: state-machine register; match: switch-on-current-variant). Three divergent surfaces → separate parsers cleaner than a mode-flagged shared parser.

**Q-MB-7 — Existing `<match>` source backward compat. RATIFIED S107 (2026-05-19) — Ship the impl; let new errors surface.** No feature-flag, no migration window. Rationale: silent-html-pass-through wasn't a valid state to depend on — source files with `<match>` block-form today are either (i) broken-but-silent (the case we're fixing) OR (ii) authored by adopters expecting the spec'd behavior (which never landed). Either way the surface is moving to spec-compliant. Document the change as a v0.4 minor-bump headline ("`<match>` block-form now structurally validated"). Internal codebase: PA grep `<match` across `examples/` + `samples/compilation-tests/` + `docs/website/pages/` BEFORE Phase 1 commit; fix or remove broken instances as part of Phase 5.

**Q-MB-8 — Auto-implied `on=` resolution scope.** §18.0.1 line 9578-9580 says auto-implied "ONLY when an `<engine for=Type>` for the same `Type` is in scope (most-local-semantics-friendly resolution)." Need to define "in scope" precisely. PA leans: same file, same `<program>` body OR same component body that contains both the engine and the match. Cross-file imported engines (§21.8 / B14) should also count once the engine's variable is mountable via `<EngineName/>`. Sub-question to surface during Phase 2.

**Q-MB-9 — Test infrastructure shape.** Match-block tests should mirror the engine state-child test infrastructure (engine-event-handler-writes.test.js, engine-body-render.test.js, etc.). PA inspects + decides at Phase 1 / Phase 5 boundaries.

**Q-MB-10 — Article + PRIMER content.** Several articles + PRIMER sections describe `<match>` block-form (e.g., `docs/articles/tier-ladder-promotion.scrml` references `W-MATCH-TRANSITIONS-ACCRUING` as a planned-not-shipped lint). Post-Phase-5, audit articles/PRIMER for any "spec'd but not yet wired" qualifiers that can be removed.

---

## §8 Files affected (preliminary inventory)

| File | Phase | Change |
|---|---|---|
| `compiler/src/match-statechild-parser.ts` (NEW) | 1 | parseMatchBlock + parseMatchArm + payload-binding parser |
| `compiler/src/ast-builder.js` | 1 | hook `<match` opener to dispatch to new parser; remove the existing error-message stubs at the 4 grep hits |
| `compiler/src/block-splitter.js` | 1 (maybe) | recognize `<match>` as structural so it doesn't fall to html-fragment |
| `compiler/src/symbol-table.ts` | 2 | new PASS for E-MATCH-NOT-EXHAUSTIVE + W-MATCH-RULE-INERT + E-MATCH-EFFECT-FORBIDDEN + E-MATCH-ONTRANSITION-FORBIDDEN |
| `compiler/src/type-system.ts` | 2/4 | match-block bare-variant resolution path; ambiguous-case detection |
| `compiler/src/codegen/emit-match.ts` (NEW) | 3 | per-arm render dispatch emitter |
| `compiler/src/codegen/emit-html.ts` | 3 | dispatch hook on `match-block` node kind |
| `compiler/src/codegen/emit-client.ts` | 3 | runtime chunk detection for match-block |
| `compiler/src/codegen/binding-registry.ts` | 3 (maybe) | new MatchBinding type, registry methods |
| `compiler/src/attribute-registry.js` | 1 | register match-block attribute schema (`for=`, `on=`) + arm-child attribute schema (`rule=` is allowed but linted; `effect=` forbidden) |
| `compiler/SPEC.md` §34 | 2 (maybe) | new E-MATCH-ON-REQUIRED row per OQ-MB-5 |
| `compiler/tests/unit/match-block-parser.test.js` (NEW) | 1 | parser shape tests |
| `compiler/tests/unit/match-block-sym.test.js` (NEW) | 2 | diagnostic tests |
| `compiler/tests/unit/match-block-codegen.test.js` (NEW) | 3 | emitter tests |
| `compiler/tests/browser/match-block-render.test.js` (NEW) | 5 | runtime arm-swap test |
| `samples/compilation-tests/match-block/*.scrml` (NEW) | 5 | canonical fixtures |
| `examples/` (audit) | 5 | check + fix any existing `<match>` references |
| `docs/website/pages/` (audit) | 5 | check + fix any existing `<match>` references |
| `docs/PA-SCRML-PRIMER.md` | 5 | refresh §7 / §18 framing |
| `docs/changelog.md` | each phase | per-phase landing entry |

---

## §9 Cross-references

- SPEC §17.0 (Tier 0/1/2 ladder) — line ~8503
- SPEC §18.0 (Two match shapes) — line 9536+
- SPEC §18.0.1 (Block-form syntax) — line 9561+
- SPEC §18.0.2 (Match attributes) — line 9618+
- SPEC §18.0.3 (Bare-variant inference) — line 9639+
- SPEC §18.1+ (JS-style match — pre-existing) — line 9679+
- SPEC §14.10 (Bare-variant inference general rule, M9, S68) — line 7034+
- SPEC §34 catalog rows: E-MATCH-NOT-EXHAUSTIVE / E-MATCH-EFFECT-FORBIDDEN / E-MATCH-ONTRANSITION-FORBIDDEN / W-MATCH-RULE-INERT / E-VARIANT-AMBIGUOUS
- SPEC §51.0.B.1 (Engine state-child payload-binding — S98) — for mirror reference
- README "A note from the designer" — calibrates adopter expectation (nominal vs implemented)
- README Tier ladder table — describes nominal Tier 1 semantics this arc realizes
- pa.md Rule 4 (SPEC is normative; derived docs are NOT)
- pa.md Rule 2 (full-production fidelity)
- pa.md Rule 3 (right answer beats easy answer) — this arc IS the right answer; the easy answer was the text-based-scan hack
- pa.md Rule 5 (shoot straight) — surfaced honestly that the lint can't ride a hack-walker; needs proper parser
- L7 architectural lock (match attrs — rules-inert + effect/onTransition engine-only)
- L8 architectural lock (two match shapes coexist — block-form for markup, JS-style for value-return)

---

## §10 Tags

#match-block-form #spec-§18.0 #L7 #L8 #tier-1 #parser #SYM #codegen #SCOPING #PA-direct #multi-phase-arc #S107 #spec-vs-impl-gap
