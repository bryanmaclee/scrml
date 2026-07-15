# sPA ss56 — conformance authoring: engine §51 completion (the freeze-gate, flagship pillar #1)

**Launch:** `read spa.md ss56` · **Branch:** `spa/ss56` · **Worktree:** `../scrml-spa-ss56`

**Fill:** the FIRST conformance-authoring list toward the language-1.0 FREEZE bar (ratified S235: 1.0 does not freeze until the conformance suite pins every CLAIMED surface — both halves — pillars to their edges). The engine (§51, ~4077 SPEC lines) is the language centerpiece and the single biggest coverage hole: the built suite has 6 engine cases (`conformance/cases/engine/*`) covering initial / phase-advance / derived / message-dispatch / boot-effect / onLeave — but ~9 documented engine sub-surfaces are UNCOVERED. This list authors them. NEW S235 · **fireable now** (pure conformance-corpus authoring — `conformance/cases/` is data, disjoint from all compiler-source and from ss55's `self-host-v2/`).

## What conformance authoring IS (the method — READ FIRST)
A conformance case = `conformance/cases/engine/<case-id>/{case.scrml, expected.json}`: real scrml source + a JSON contract asserting **(a) which diagnostic CODES fire** and, where a runtime effect exists, **(b) the RUNTIME effect** (`input` drive verbs → `state` + `dom`/`domAnchored`). Author each case by: (1) write representative scrml for the sub-surface; (2) run it through impl#1 (the reference) via the harness to capture ACTUAL codes + runtime; (3) assert those in `expected.json`; (4) **SANITY-CHECK against the SPEC section** — if impl#1's behavior DIVERGES from a normative SPEC statement, that is a CONFORMANCE BUG or a spec-divergence → **STOP and escalate to the PA** (do NOT enshrine impl#1's behavior against the spec; the §19.9.1 server-error-wire divergence is the precedent). Verify each case with `bun conformance/run.ts` (must stay GREEN on impl#1). The runner + schema are documented in `conformance/README.md`.

## Shared ingestion
The conformance harness (`conformance/run.ts` runner · `conformance/adapters/impl1-ts.ts` the impl#1 adapter · `conformance/driver.ts` the 7 selector verbs · `conformance/normalize.ts` DOM canonicalization) + `conformance/README.md` (the `expected.json` schema + OQ1 domAnchored-default). Mirror the 6 EXISTING `conformance/cases/engine/*` cases for the exact shape. **The SPEC is normative** (pa.md Rule 4): read the named §51.0.x subsection IN FULL before authoring each case. **Harness ceiling:** the harness drives selector events + mocks `fetch`; it has **NO virtual clock** (`driver.ts:19-21` — timers deferred to v1.next). So `<onTimeout>`/`<onIdle>` RUNTIME halves are BLOCKED (author their CODES halves now; flag the runtime half as harness-gated on a virtual-clock driver — a PA/infra follow-on).

## Core files
`conformance/README.md` (schema + method) · `conformance/cases/engine/` (6 existing cases to mirror) · `conformance/run.ts` (the runner/oracle) · `conformance/adapters/impl1-ts.ts` + `conformance/driver.ts` (harness ceiling) · `compiler/SPEC.md` §51 (normative — read the named subsection per item)

## Items (least-ingestion-first)

1. **rule= violation diagnostic** (codes) `[status=pending]` — a write that violates a state-child's `rule=` set fires **E-ENGINE-INVALID-TRANSITION** (§51.0.F, compile-time when from-state is static). Author pos (violating write → code) + neg (legal transition → no code). Least ingestion (codes-only).
2. **payload-binding diagnostics** (codes) `[status=pending]` — §51.0.B.1: **E-ENGINE-PAYLOAD-ON-UNIT-VARIANT** (payload on a nullary variant), **E-ENGINE-PAYLOAD-ARITY-MISMATCH**, **E-ENGINE-PAYLOAD-RESERVED-COLLISION**. One case per code (the reject path) + a neg (correct payload binding, no code).
3. **message-dispatch exhaustiveness diagnostics** (codes) `[status=pending]` — §51.0.S `accepts=`: **E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE** · **E-ENGINE-MSG-UNKNOWN** · **E-ENGINE-MSG-WITHOUT-ACCEPTS** · **E-ENGINE-ACCEPTS-NOT-ENUM**. Extends the existing `engine/message-dispatch` case (mirror it) with the reject paths.
4. **self-write idempotence** (codes) `[status=pending]` — §51.0.F.1: a self-targeting write (`@phase = .SameState`) fires **W-ENGINE-SELF-WRITE-DETECTED** (or the current code — verify live). Author pos + the construction-vs-self-write distinction (§51.0.F.1 trichotomy).
5. **`internal:rule=`** (RT+codes) `[status=pending]` — §51.0.O: an internal transition on a composite state-child does NOT exit/re-enter the composite (inner-engine lifecycle preserved; composite `<onTransition>` does NOT fire). Runtime: assert the inner engine's cell survives an internal transition (state snapshot) vs resets on an external one. + **E-INTERNAL-RULE-NOT-COMPOSITE** codes case.
6. **`history` attribute** (RT+codes) `[status=pending]` — §51.0.N: a composite state-child with `history` restores its inner engine's last variant on re-entry (`.Variant.history` target). Runtime: exit composite (inner at X) → re-enter via `.history` → assert inner is X, not `initial=`. + **E-HISTORY-NO-INNER-ENGINE** codes case.
7. **hierarchy / nested engines** (RT) `[status=pending]` — §51.0.Q: an engine declared inside an outer engine's state-child body; inner has full engine semantics; lifecycle coupled to the outer state-child (init on entry, suspend on exit); singleton invariant (outer × 1 = 1 inner). Runtime: drive the outer to the composite variant → inner mounts + transitions; drive outer away → inner suspends. + **E-COMPONENT-ENGINE-SCOPE** neg (engine in a component body).
8. **`<onTimeout>` §51.0.M** (codes now; **RT harness-gated**) `[status=pending]` — CODES: `to=` validated against the state-child's `rule=` set (reject → code); E-STRUCTURAL-ELEMENT-MISPLACED outside an engine state-child. **RUNTIME half BLOCKED** (no virtual clock) — author the codes case, add an `expected.json` note that the timer→variant runtime is harness-gated (virtual-clock driver, PA follow-on), do NOT fake a runtime half.
9. **`<onIdle>` §51.0.R** (codes now; **RT harness-gated**) `[status=pending]` — CODES: engine-root-scope-only (E-IDLE-MISPLACED inside a state-child); `to=` strict-validated against `for=` enum (E-IDLE-INVALID-VARIANT); one-per-engine (E-IDLE-DUPLICATE). Same virtual-clock RUNTIME gate as #8 — codes now, flag runtime.

**Definition of done:** items 1-7 fully covered (codes + runtime where applicable); items 8-9 codes-covered with the runtime half explicitly flagged harness-gated; every new case GREEN on `bun conformance/run.ts`; any impl#1-vs-SPEC divergence ESCALATED (not enshrined). Outcome: the engine pillar moves from DEEP-with-holes to conformance-COMPLETE (modulo the timer runtime, tracked).

## Progress
`spa-lists/ss56.progress.md`. Land per-item on `spa/ss56`; ping the PA inbox (`handOffs/incoming/`) per item with `{item, case-ids, run.ts green?, any impl#1-vs-SPEC divergence}`. Do NOT advance main / push. PA re-integrates via S67 file-delta (`conformance/cases/engine/*` is pure-additive data — clean) + confirms `bun conformance/run.ts` green independently. **ESCALATE (do not decide):** any impl#1-vs-SPEC divergence (a conformance bug OR a spec bug — needs a PA/user ruling, e.g. the §19.9.1 wire precedent); the virtual-clock driver design (the §8/§9 runtime gate). These are NOT on this list.

## Wave-2 — tier-1 code-exhaustive completion (S256 audit)
Items 1-9 above are LANDED — do NOT touch them (they cover the engine SUB-SURFACES: rule/payload/dispatch/
history/hierarchy/onTimeout/onIdle). This section pins the remaining tier-1 **`E-ENGINE-*` diagnostic
codes** the S256 tier split places in tier-1 ("what an engine MEANS" — ~22 codes) + the **replay §51.14**
codes. Same method + core files as above (read the named §51 subsection per code). Grep each code live in
`compiler/src` (`symbol-table.ts` + `type-system.ts` + `codegen/emit-machines.ts`) for the exact trigger.
> **Fuzzy-band:** `E-ENGINE-003` (duplicate machine name) is TIER-SPLIT tier-2 (engine-config) but pulled
> to tier-1 per this brief — marked `[tier-1?]`, reclassifiable. `E-ENGINE-014/019/020/021/-INITIAL-BOTH-
> FORMS/-RULE-LEGACY-SYNTAX/-SERVER-WITH-*` stay tier-2 (engine-config edges) — NOT authored here.

10. **E-ENGINE-001** (RT/codes) `[status=pending]` — illegal transition: an assignment to `@machine` that violates the rule set (`codegen/emit-machines.ts:593`, runtime-emitted). Pos + neg. (May overlap landed item-1's `E-ENGINE-INVALID-TRANSITION` — verify the distinct code fires; TIER-SPLIT lists E-ENGINE-001 discretely.)
11. **E-ENGINE-003** `[tier-1?]` (codes) `[status=pending]` — duplicate machine name (`type-system.ts:5982`). Pos + neg.
12. **E-ENGINE-004** (codes) `[status=pending]` — a transition rule references an unknown variant (`type-system.ts:2170`). Pos + neg.
13. **E-ENGINE-005** (codes) `[status=pending]` — a derived-machine constraint (`type-system.ts:6118`, "Derived machine ..."). Pos + neg.
14. **E-ENGINE-010** (codes) `[status=pending]` — a guard in a type-level transition block (§51; `type-system.ts:2109`). Pos + neg.
15. **E-ENGINE-013** (codes) `[status=pending]` — a machine constraint (`type-system.ts:6947`, "Machine ..."). Grep exact trigger; pos + neg.
16. **E-ENGINE-015** (codes) `[status=pending]` — a machine constraint sibling (`type-system.ts:7015`). Grep exact trigger; pos + neg.
17. **E-ENGINE-016** (codes) `[status=pending]` — a transition side with multiple alternatives (ambiguous; `type-system.ts:6611`). Pos + neg.
18. **E-ENGINE-017** (codes) `[status=pending]` — a write to a projected (derived) variable (`type-system.ts:6201`). Pos + neg.
19. **E-ENGINE-018** (codes) `[status=pending]` — a derived-machine constraint (`type-system.ts:6518`). Pos + neg.
20. **E-ENGINE-INITIAL-INVALID-VARIANT** (codes) `[status=pending]` — `initial=` names a variant not in the enum (`runtime-template.js:4443`). Pos + neg.
21. **E-ENGINE-INITIAL-CELL-TYPE** (codes) `[status=pending]` — an `initial=` cell type mismatch (`symbol-table.ts:7811`). Pos + neg.
22. **E-ENGINE-INITIAL-CELL-UNDECLARED** (codes) `[status=pending]` — `initial=` references a non-existent cell (`symbol-table.ts:7803`). Pos + neg.
23. **E-ENGINE-MOUNT-NOT-ENGINE** (codes) `[status=pending]` — a `mount=` self-closing tag targets a non-engine (`symbol-table.ts:6350`). Pos + neg.
24. **E-ENGINE-VAR-DUPLICATE** (codes) `[status=pending]` — a duplicate engine-variable name (`symbol-table.ts:6215`). Pos + neg.
25. **E-ENGINE-RULE-INVALID-VARIANT** (codes) `[status=pending]` — a `rule=` references an invalid variant (`symbol-table.ts:6403`). Pos + neg.
26. **E-ENGINE-STATE-CHILD-INVALID-VARIANT** (codes) `[status=pending]` — a state-child tag names an invalid variant (`symbol-table.ts:7197`). Pos + neg.
27. **E-ENGINE-STATE-CHILD-MISSING** (codes) `[status=pending]` — a required state-child is missing (`symbol-table.ts:6394`). Pos + neg.
28. **E-ONTRANSITION-NO-TARGET** (codes) `[status=pending]` — `<onTransition>` with no target (`symbol-table.ts:11330`). Pos + neg.
29. **E-REPLAY-001** (codes) `[status=pending]` — §51.14: `@target` is not a machine-bound reactive (`type-system.ts:22959`). Pos + neg.
30. **E-REPLAY-002** (codes) `[status=pending]` — §51.14: `@log` is not a declared reactive variable (`type-system.ts:22960`). Pos + neg.
31. **E-REPLAY-003** (codes) `[status=pending]` — §51.14: cross-machine replay rejected (`type-system.ts:23060`). Pos + neg.

**Wave-2 DoD:** all 22 remaining engine/replay codes pinned (codes-half; reject pos + clean neg per code);
run.ts green; the engine pillar reaches diagnostic-EXHAUSTIVE (modulo tier-2 engine-config edges + the
timer runtime already tracked). Divergences ESCALATED.
