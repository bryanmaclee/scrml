# scrmlTS — Session 73 (CLOSE — A1c Waves 1+2+3 ALL SHIPPED · 9 commits · +437 tests · 0 regressions · 0 path-discipline leaks)

**Date opened:** 2026-05-08
**Date closed:** 2026-05-08
**Previous:** `handOffs/hand-off-72.md` (S72 close — Position B server-keyword DEPRECATION ratified · A9 phase opened · A9 Ext 4 SHIPPED · cross-machine switch in progress)
**This file:** rotates to `handOffs/hand-off-73.md` at S74 open
**Tests at S73 close:** **10,308 pass / 60 skip / 1 todo / 0 fail / 35,353 expects** (487 files, ~11s)

---

## TL;DR — what S73 did

**Massive implementation session — 9 ships across 3 A1c waves, all parallel-disposition friction-free.**

| # | Step | Commit | Δ | Wave |
|---|---|---|---|---|
| 1 | C3 — render-spec expansion at `<x/>` | `26ce40b` | +23 | 1 |
| 2 | C4 — bind:* dispatch | `bb317ea` | +54 | **1 ✓** |
| 3 | C5 — reset(@cell) + default= | `67b9e96` | +34 | 2 |
| 4 | C6 — validator runtime catalog (14 universal-core) | `50d35b9` | +79 | 2 |
| 5 | C7 — per-cell validator runner (§55.12 short-circuit) | `f935822` | +61 | **2 ✓** |
| 6 | C8 — validity surface synthesis | `cf37440` | +54 | 3 |
| 7 | C9 — cross-field deps precision | `6a311c7` | +35 | 3 |
| 8 | C10 — 4-level error message resolution | (in `ff0a5dd` push) | +61 | 3 |
| 9 | C11 — `<errors of=expr/>` first-class element | `ff0a5dd` | +36 | **3 ✓** |

Plus archive housekeeping: scrml-support `6206192` (S66 SKIPPED zod-amends article landed in `archive/articles-skipped/`).

**Cross-machine pickup at S73 open:** scrml-support pulled 4 commits behind from S72 push. scrmlTS already in sync. No cross-machine drift after that.

**Pattern observations:**
- **Parallel-dispatch maturity:** S72 had 3 F4 path-discipline leaks across parallel dispatches; S73 had ZERO across 11 dispatches (counting C5+C6 + C9+C10+C11 as parallel batches). Brief-encoded sibling-territory awareness held.
- **Depth-of-survey discount (now frequency-9):** every dispatch's survey returned actionable findings before implementation — file-locus corrections (C3 → emit-html.ts, C5 → runtime-template.js path), substantial existing-substrate discoveries (C5: half already shipped via C1; C6: compile-time catalog mirrors 1:1; C8: zero C5 extension needed), scope-shape verdict surfacing (C9: REFINEMENT not silent-bug — runtime probe disproved hypothesis).
- **Spec-Rule-4 enforcement:** C6 explicitly REJECTED SCOPE-doc drift listing `email/url/numeric/integer/custom` as universal-core predicates (those are stdlib library / enum-tag escape hatch, NOT predicates per primer §8 audit). Regression-guard test asserts the exclusion.
- **`scrml-dev-pipeline` agent NOT staged this machine** (carryover from S71 master-PA notice — still pending). All 9+ dispatches went via `general-purpose` substitution per pa.md authorized pattern. Worked fine for T2-shaped extensions.

---

## State as of S73 close

| Field | Value |
|---|---|
| scrmlTS HEAD | (this wrap commit) |
| scrmlTS origin sync | TBD post-wrap-push |
| scrml-support HEAD | `6206192` (post-archive landing earlier this session) |
| scrml-support origin sync | 0/0 ✓ |
| Tests at close | **10,308 / 60 / 1 / 0** ✓ via `bun run test` (~11s) |
| Inbox | empty (`handOffs/incoming/` clean) |
| Outbox-pending | none |
| Active dispatches | none (Wave 3 all landed) |
| Worktree branches retained | 9 from S73 — all forensic per S67 protocol |

**Cumulative tests since S71 baseline:** 9,734 (S71) → **10,308 (S73 close)** = **+574 pass tests across S72 + S73, 0 regressions, 0 net new fails**.

**S73 alone:** 9,872 (S73 open via this machine's `bun run test` chain) → 10,308 = **+436 / +437 arithmetic** (±1 floating drift) across 9 ships.

---

## Open questions to surface immediately at S74 open

1. **Cross-machine pickup IF S74 opens on the other machine.** MANDATORY: `git fetch origin && git pull --rebase origin main` on BOTH repos. Verify scrmlTS at this wrap commit + scrml-support at `6206192`. Re-run `bun run test`; expect 10,308 / 60 / 1 / 0 (or self-host-parity-inclusive count if running with self-host scope).

2. **A1c Wave 4 (engines, ~18-25h, SEQUENTIAL) — next priority.** C12 (engine state-machine runtime, 5-7h) is foundational; C13 (.advance + onTransition hook firing, 4-5h), C14 (derived engines, 4-6h), C15 (cross-file engine mount + auto-declared engine variable, 5-7h) follow sequentially. Per SCOPE: "C12 → C13 → C14 → C15 sequential."

3. **A1c Wave 5 (cross-cutting C16-C22, ~25-35h, MOSTLY PARALLELIZABLE)** — biggest parallel-dispatch window. After Wave 4 lands, can fan out C16/C17/C18/C19/C20/C21/C22 with file-disjoint planning.

4. **A1c Wave 6 (C23 PIPELINE prose pass, ~5-8h, INDEPENDENT)** — can run in parallel with any other wave.

5. **A8 (test-bind, Insight 22, ~6-12h) — UNBLOCKED since S72 (A9 Ext 4 shipped).** Parallel track candidate.

6. **A9 Ext 5 (S5 replay safety / idempotency-key storage)** — STILL gated on A1c C17 spec-edit ordering (per S72 integration constraint). Becomes dispatchable after C17 lands.

7. **`scrml-dev-pipeline` agent staging gap** — STILL not staged on this machine since S71 master-PA notice. Pipeline-substitution to general-purpose has worked clean across 9 dispatches; staging is no longer urgent. Filed.

8. **F4 PreToolUse hook mitigation** — S72 had 3 leaks; S73 had 0. The brief-encoded path-discipline block + sibling-territory-awareness blocks have been effective without the hook. May be deprioritizable; surface to user for re-tier decision.

---

## Things S74 PA must NOT screw up (S70+S71+S72+S73 cumulative)

S72-close standing list (items 113-150) carries forward verbatim. **S73 NEW additions:**

151. **A1c Waves 1+2+3 fully shipped.** C0-C11 all on main + pushed. The codegen surface for state-decl emission, validators, and the validity surface is functionally complete. Don't dispatch sub-step regressions; if a runtime-behavior bug is found, it's a Wave 4+ regression or an integration gap, not a Wave 1/2/3 do-over.

152. **`<errors of=expr/>` is now a first-class structural element.** Don't propose adding it again or re-debating the design. The element is registered at `attribute-registry.js` + `html-elements.js` (rendersToDom: false) + emitted via `emit-html.ts` dispatch arm. Body-override via arrow-function-shaped logic-node body is the canonical custom-render path per §55.8.

153. **`messageFor` runtime helper is `_scrml_message_for(error, fieldName, cellName?)`.** Globally available in any `.client.js` whose source triggers the `messages` chunk (chunk #17). C11 emits a `typeof`-guarded fallback for backward-compat; the real helper resolves automatically when present. Pass `cellName` as the qualified storage key (e.g., `"signup.email"`) to enable Level-1 inline-override lookup.

154. **`runtime-validators.js` is the C6 runtime catalog (14 fire functions + dispatch helpers + frozen catalog).** It is NOT a stdlib module shim; it lives at `compiler/src/runtime-validators.js` (sibling of `runtime-template.js`). The `validators` chunk (chunk #16) loads it via `fs.readFileSync` at module-load time — keeps `runtime-validators.js` as single source of truth (no duplication into runtime-template.js).

155. **C9 verdict was REFINEMENT, not silent-bug fix.** Pre-C9 cross-field reactivity already worked via transitive dirty propagation through the compound parent. C9 added PRECISION (qualified-path subscriptions + direct qualified-path reads). The hypothesis-disproof-via-runtime-probe pattern is reusable: when a refinement step's brief assumes "fix a bug," the survey's runtime probe may reveal "no bug, just imprecision." That's a refinement verdict, not a no-op.

156. **`<errors>` placeholder anchor span persists in DOM with empty innerHTML when errors are empty.** Pragmatic interpretation of §55.8 line 25193-25195 ("literally nothing rendered") — the anchor is required for re-render hookup. A future C-step could refine to true zero-DOM via `<template>` + marker comment (mirrors Phase 2c clean-if pattern). Documented in C11 SURVEY as deferred refinement.

157. **§55.12 short-circuit rule is C7's responsibility, NOT C6's.** C6 fire functions are pure pass/fail; they don't know about siblings. C7's runner walks `validators[]` in declaration order, calls `fire`, accumulates, and BREAKS the loop when `req` or `is some` returns non-null. §C7.14 demonstrates this with the canonical `<name req length(>=2) pattern(...)>` example on `""`.

158. **Compound-level synth-surface predictability rule (§55.5):** even compounds with NO validators get the four synth properties with trivial defaults (`isValid` true, `errors` `{}`, `touched` `{}`, `submitted` false). C8 emits unconditionally per compound parent. Don't propose conditional emission — predictability over namespace savings is the spec's load-bearing position.

159. **Top-level (non-compound) cells with validators DO NOT get synth surface** per §55.5 L11 Edge A. C7 emits no runner for them. Their validator failures are tracked via the type-system (refinement type) when that path lands. Single-cell forms should use a one-field compound (`<form><name req/></>`) per spec convention.

160. **Form-detection for `submitted` is document-level submit listener** (one `addEventListener` per compound with `submitted` synth, idempotency-guarded). Multi-form discrimination NOT implemented — predictability over selectivity per §55.7. If multiple forms become a real adopter friction, refine; documented in C8.

161. **A1c Wave 4 sequencing is HARD per SCOPE:** C12 → C13 → C14 → C15. C12 emits the engine state-machine runtime (current variant cell + transition table + initial state); C13/C14/C15 build on top. Don't dispatch in parallel — C13 depends on C12's transition-table shape, C14 depends on C12's variant-cell shape, C15 depends on C12's auto-declared variable.

162. **C9's qualified-path walker (`forEachQualifiedCellRef*` in `validator-arg-parser.ts`)** is the new sibling to `forEachIdentInExprNode`. Future B-steps or codegen needing to walk MemberExpr chains rooted at `@` should use the qualified-path family — the base-ident walker will under-collect.

163. **9 worktree branches retained in `.claude/worktrees/`** for forensic per S67. NOT cleanup priority — branches are crash-recovery anchors and forensic-review anchors.

---

## File modification inventory (S73)

**scrmlTS commits (9 ship + 1 archive + 1 wrap = 11 total):**

| Commit | Files | Topic |
|---|---|---|
| `26ce40b` | binding-registry.ts, emit-html.ts, c3 test, c3 docs (BRIEF/SURVEY/progress) | C3 render-spec expansion |
| `bb317ea` | emit-bindings.ts, c4 test, c4 docs | C4 bind:* dispatch |
| `67b9e96` | runtime-template.js, runtime-chunks.ts, emit-client.ts, emit-logic.ts, emit-expr.ts, emit-functions.ts, emit-control-flow.ts, scheduling.ts, c5 test, runtime-tree-shaking test, browser-todomvc test, c5 docs | C5 reset + default |
| `50d35b9` | runtime-validators.js (NEW), c6 test, c6 docs | C6 validator runtime catalog |
| `f935822` | emit-validators.ts (NEW), runtime-template.js, runtime-chunks.ts, emit-client.ts, emit-logic.ts, runtime-tree-shaking test, c7 test, c7 docs | C7 per-cell runner |
| `cf37440` | emit-synth-surface.ts (NEW), emit-bindings.ts, emit-client.ts, emit-logic.ts, c7 test (1 stale assertion tightened), c8 test, c8 docs | C8 synth surface |
| `6a311c7` | emit-validators.ts, validator-arg-parser.ts (forEachQualifiedCellRef* NEW), c9 test, c9 docs | C9 cross-field precision |
| `(in ff0a5dd push)` (`bb64238` worktree) | runtime-template.js, runtime-chunks.ts (16→17), emit-client.ts, emit-logic.ts, emit-messages.ts (NEW), runtime-tree-shaking test, c7 test (1 stale assertion narrowed), c10 test, stdlib/data/{index.scrml, messages.scrml NEW}, c10 docs | C10 4-level message resolution |
| `ff0a5dd` | attribute-registry.js, binding-registry.ts, emit-event-wiring.ts, emit-html.ts, html-elements.js, html-elements.test.js, type-system.test.js, c11 test, c11 docs | C11 `<errors of=>` element |
| `(this wrap)` | hand-off.md, master-list.md, docs/changelog.md, handOffs/hand-off-72.md (rotated from S72-close) | S73 wrap |

**scrml-support commits (1 — early-session):**
- `6206192` (S66 SKIPPED zod-amends article landed in `archive/articles-skipped/scrml-debate-amends-zod-claim-devto-2026-05-06.md`).

---

## Wave-by-wave summary

### Wave 1 (foundational state-decl emission) — CLOSED

| Step | Topic | Δ tests |
|---|---|---|
| C0 (S70) | usage-analyzer pass | +67 |
| C1 (S72) | shape-aware cell emitter | +25 |
| C2 (S72) | derived-cell reactive computation | +31 |
| C3 (S73) | render-spec expansion at `<x/>` | +23 |
| C4 (S73) | bind:* dispatch | +54 |

After C4: state-decl shape emission complete. Render-by-tag use sites expand to bound input elements; bind: dispatch by render-spec type wires reactive flow.

### Wave 2 (reset + validators) — CLOSED

| Step | Topic | Δ tests |
|---|---|---|
| C5 (S73) | reset(@cell) runtime + default= | +34 |
| C6 (S73) | validator runtime catalog (14 universal-core) | +79 |
| C7 (S73) | per-cell validator runner (§55.12 short-circuit) | +61 |

After C7: reset semantics fire correctly across compound + multi-level compound nav; validators run + fire `ValidationError` enum tags into per-field synth cells.

### Wave 3 (validity surface) — CLOSED

| Step | Topic | Δ tests |
|---|---|---|
| C8 (S73) | validity surface synthesis (compound rollup + touched + submitted) | +54 |
| C9 (S73) | cross-field deps precision (qualified-path subscriptions) | +35 |
| C10 (S73) | 4-level error message resolution | +61 |
| C11 (S73) | `<errors of=expr/>` first-class element | +36 |

After C11: end-to-end validity surface works. Validators fire → errors populate per-field cells → compound rollup aggregates → `<errors of=>` renders user-facing messages with 4-level resolution.

### Wave 4 (engines) — NOT YET DISPATCHED

| Step | Topic | Est |
|---|---|---|
| C12 | engine state-machine runtime | 5-7h |
| C13 | .advance(.event) + `<onTransition>` hook firing | 4-5h |
| C14 | derived=expr engine emission (L20) | 4-6h |
| C15 | cross-file engine mount + auto-declared variable (M16, M18) | 5-7h |

**Sequential per SCOPE.** ~18-25h total.

### Wave 5 (cross-cutting C16-C22) — NOT YET DISPATCHED

7 steps, ~25-35h, mostly file-disjoint and parallelizable. **Note: C17 spec-edit ordering blocks A9 Ext 5 (per S72 integration constraint).**

### Wave 6 (C23 PIPELINE prose pass) — INDEPENDENT

~5-8h, can run in parallel with any other wave. Documents v0.next pipeline state.

---

## Master inbox state at close

`/home/bryan/scrmlMaster/handOffs/incoming/`:
- `2026-04-22-scrmlTS-to-master-insight-25-multi-meta.md` — UNREAD legacy from S30s era
- `2026-05-08-S72-scrmlTS-to-master-needs-push-SUPERSEDED.md` — RENAMED at master-push-protocol-retirement (S72)
- `2026-05-08-S71-scrmlTS-to-master-stage-scrml-dev-pipeline.md` — UNREAD (master-PA agent staging request from S71; still not addressed; pipeline-substitution to general-purpose has been working clean so deprioritized but filed)

No active pending master notices from S73.

---

## Push state

scrmlTS: 9 commits pushed throughout session (C3/C4 batched, C5/C6 batched, C7 alone, C8 alone, C9/C10/C11 batched). Plus this wrap commit pending push. **Wrap-push pending.**

scrml-support: 1 commit pushed at session open (`6206192` archive landing). 0/0 since.

---

## Tags

#session-73 #a1c-waves-1-2-3-CLOSED #9-ships #+437-tests #zero-regressions #zero-path-discipline-leaks #parallel-dispatch-mature #depth-of-survey-frequency-9 #spec-rule-4-enforced-at-c6 #cross-machine-pickup-clean #wave-4-engines-next
