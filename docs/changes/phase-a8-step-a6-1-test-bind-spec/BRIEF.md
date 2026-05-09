# Phase A8 (master-list) / A6-1 (roadmap) — `test-bind` SPEC amendment

**Phase:** A8 (master-list naming) / A6 sub-step 1 of 6 (IMPLEMENTATION-ROADMAP §2.6 naming).
**Estimate:** ~30-60 minutes — pure SPEC.md text amendment + cross-refs. No compiler source changes.
**Dispatched:** 2026-05-08 (S74), in PARALLEL with C13 (running concurrently in a separate worktree).
**Authority chain:** Insight 22 (`scrml-support/design-insights.md` line 1409 — "Effect-Test-Mockability: `test-bind` as canonical scrml surface"). IMPLEMENTATION-ROADMAP §2.6 (`docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md:254-298`). SCOPE-SUPPLEMENT-2026-05-07 §2.1 (`docs/changes/v0next-inventory/SCOPE-SUPPLEMENT-2026-05-07.md:58`).

## Goal (one paragraph)

Land the SPEC.md text for the `test-bind` declaration form inside `~{}` test blocks. The verdict is ratified (Insight 22, 2026-05-07); this dispatch turns the verdict into normative spec text so subsequent A8 sub-steps (parser A6-2, typer A6-3, codegen A6-4, tests A6-5, optional API alignment A6-6) can ship against authoritative spec language. Pure spec authoring — no compiler source modified.

## What Insight 22 ratifies (verbatim from design-insights.md:1409-1442)

> **Verdict:** Adopt a `test-bind` declaration inside `~{}` blocks (Position C surface, Position A mechanism). Do not introduce effect-record types at this time. Position B (effect-record schemas + `expects` sequences) is **not adopted at this time**; structurally extensible if a real use case emerges later — the `test-bind` dispatch point is a subset of what Position B would need; B can be added forward-compatibly without breaking the `test-bind` surface. (No flip-condition gating per S67 user-direction methodology rule "Flip conditions are not a feature-adoption gating mechanism.")
>
> **Canonical surface:**
> - `test-bind <serverFnName> = <literal-or-handler>` — scope-local declaration inside `~{}` blocks; multiple declarations allowed per block
> - Keys are §47 encoded names — no new naming scheme introduced
> - Implementation: compile-time conditional at the §47 call site in test mode; production binary unchanged (dead-code-eliminated in release builds)
> - Unbound server functions in test mode with active `test-bind` context: fail-fast (error, not silent passthrough)
> - E-TEST-004 unchanged (no outer-scope ref relaxation needed; `test-bind` is scope-local declaration, not outer-scope reference)
> - E-FN-004 unchanged (denial-via-`fn` for coeffects stands)
> - Insight 21 unchanged (no effect rows on `fn` types)
>
> **Production runtime cost:** 0 bytes. Test-mode dispatch is dead-code-eliminated from release builds.
>
> **Forward-compatibility to Position B:** the `test-bind` dispatch point is structurally a subset of what Position B would need. B extends it by also emitting an effect-record at the dispatch point rather than just silencing the call. B can be added forward-compatibly without breaking the `test-bind` surface; not adopted at this time.

## What's already in place (depth-of-survey signal)

- **Existing `~{}` test-block grammar** lives at SPEC §19.12 ("Interaction with ~{} Tests", line ~11301). The block opener `~{` is registered at SPEC line ~11704 (block-closer disambiguation rule). E-TEST-001 through E-TEST-005 are defined at §34 (lines 14351-14355).
- **Existing test-block infrastructure** in compiler: `compiler/src/test-block-parser.ts` (or similar — survey to find the canonical parser file). Test-mode flag mechanism already exists per the line 22496+ context (`<base>.test.js` user-authored suites).
- **Server-function call site** (§47) — encoded names per §47 are the keys for `test-bind`. Survey: confirm where §47 is in SPEC.md (per SPEC-INDEX line 74: "Output Name Encoding ... 17644-18165").
- **`scrml:test` stdlib module** — exists at `stdlib/test/index.scrml` (per S67 voice entry: 202 lines, ships zero mocking primitives currently). The optional A6-6 sub-step would surface convenience helpers here. NOT in A6-1 scope.

## Scope (in / out)

**IN scope (A6-1):**

1. **Choose home for the `test-bind` spec text** — three candidates per IMPLEMENTATION-ROADMAP §2.6 line 263:
   - **§19.12** (Interaction with `~{}` Tests) — extend with test-bind subsection
   - **§47** (Output Name Encoding / server-function dispatch) — extend with test-bind dispatch hook prose
   - **NEW §54.X** (where `~{}` test-block grammar lives — survey if §54 exists for this)
   
   **Lean:** §19.12 for the surface declaration + §47 cross-ref for the dispatch mechanism. The declaration is structurally part of the test-block grammar; the codegen behavior is at the call site. Two sites, cross-referenced. Survey-confirm.

2. **Spec text content** — author normative spec language covering ALL ratified items from Insight 22:
   - Declaration syntax: `test-bind <serverFnName> = <literal-or-handler>` inside `~{}` blocks. Multiple declarations per block legal.
   - Keys: §47 encoded names. No new naming scheme.
   - Scope: scope-local to the enclosing `~{}` block (NOT outer-scope ref — E-TEST-004 unchanged).
   - Handler shape: literal value (for return-stub) OR function (for behavior). Survey: confirm whether literal vs function discriminates by syntax or by typer.
   - Compile-time conditional dispatch at §47 server-fn call site in test mode.
   - Production binary unchanged (dead-code-eliminated in release builds — explicit normative claim).
   - Fail-fast on unbound server-fn in active test-bind context (NEW error code? OR existing E-TEST-002? Survey decides — Insight 22 says "error, not silent passthrough" without naming a specific code).
   - E-TEST-004, E-FN-004, Insight 21 explicitly unchanged.
   - Position B (effect-record schemas + `expects` sequences) NOT ADOPTED at this time; structurally extensible; no flip-condition gating per S67.

3. **Cross-references in SPEC text:**
   - From §19.12 → §47 (dispatch mechanism)
   - From §47 → §19.12 (surface declaration)
   - From §34 (error codes) → new error code if introduced for fail-fast (or note reuse of existing E-TEST code)
   - From `compiler/SPEC-INDEX.md` (line ~74 §47 row, line ~xx §19 row) → updated row notes mentioning test-bind
   - Insight 22 reference + S67 user-voice entry reference (in spec narrative or footnote per existing convention)

4. **§34 error code addition (CONDITIONAL on survey)** — if a NEW error code is needed for "unbound server fn in active test-bind context fail-fast," add to §34 catalog with normative trigger + message + severity. Candidate: `E-TEST-006` (next free in the series). If existing E-TEST-002 ("unexpected error during execution") is reusable per Insight 22's "fail-fast (error, not silent passthrough)," document the reuse. Survey decides; surface to PA if ambiguous.

5. **OQ open questions (S67) carried forward in spec text as deferral notes:**
   - OQ-8b (`<onTransition>` body effects beyond server-fn calls) — not addressed by `test-bind`; reserved for future debate
   - OQ-test-bind-concurrency (parallel test runner block-local table isolation) — implementation concern; spec can be silent OR document as A6-2/A6-3 implementation question
   - OQ-test-bind-passthrough (verdict: fail-fast; validate against test-runner ergonomics) — codify the fail-fast direction in spec text
   - OQ-audit-log-compose (test-bind interaction with `audit @log` per §51.11) — note as cross-cutting open question; spec can be silent or include a single-sentence "open" footnote

6. **SPEC-INDEX.md** updates per pa.md convention — any section the spec amendment touches gets an updated row note in `compiler/SPEC-INDEX.md` mentioning the test-bind addition with the relevant date stamp.

7. **Worked example** — at least ONE worked example showing the canonical use case from Insight 22:

   ```scrml
   ~{ "engine reaches .Success given synthetic HTTP, no real network"
     test-bind fetchUser = (id) => { id, name: "Alice", email: "a@b.com" }
     test-bind fetchPosts = []
     // ... test body that exercises engine + asserts state transition
   }
   ```

   The example MUST cover: declaration syntax, multiple binds per block, literal vs function handler, scope-local nature, integration with engine-bearing test (the OQ-8 use case).

**OUT of scope (deferred to A6-2 through A6-6):**

- **Parser implementation** — A6-2.
- **Type-system implementation** — A6-3 (scope-local table; key validation against §47 encoded names; handler-typing matches server-fn signature).
- **Codegen implementation** — A6-4.
- **Tests** — A6-5.
- **`scrml:test` API alignment** — A6-6 (optional).
- **Position B (effect-record schemas + `expects` sequences)** — explicitly NOT ADOPTED per Insight 22; just note the deferral with forward-compat-claim text.
- **OQ-8b** (`<onTransition>` body effects) — explicitly out per Insight 22 partial-closure framing.

## Spec verification (pa.md Rule 4)

Spec sections to read (verbatim) BEFORE authoring new spec text:

- **§19.12** (lines ~11301-11360) — current Interaction with `~{}` Tests prose; the new test-bind subsection extends or follows.
- **§19.13** (lines ~11360+) — Error Codes for §19; cross-ref shape for any new error code in §34.
- **§34** (lines ~14002-14274) — Error Codes catalog; specifically E-TEST-001 through E-TEST-005 rows (lines 14351-14355) to verify the existing E-TEST series shape and choose the next free number.
- **§47** (lines ~17644-18165) — Output Name Encoding / server-function dispatch; specifically the call-site emission section that the codegen hook will live at. The spec text need not name the codegen file but should describe the dispatch contract.
- **`compiler/SPEC-INDEX.md`** — find the existing rows for §19 + §47 to determine where to add the test-bind cross-ref note.

For Insight 22 verbatim-quote sourcing, read `/home/bryan-maclee/scrmlMaster/scrml-support/design-insights.md` lines 1409-1442 (the full Insight 22 entry).

For S67 user-direction methodology rule on flip-conditions, read `/home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrmlTS.md` (search for "flip conditions are null" — the verbatim quote).

**Rule 4 enforcement:** if any derived planning doc (SCOPE-SUPPLEMENT, IMPLEMENTATION-ROADMAP, master-list, prior brief drafts) contradicts the Insight 22 verdict text or the SPEC.md existing prose on `~{}` blocks, the **Insight 22 verbatim text + existing SPEC.md prose WIN.** Quote both before authoring new normative claims.

## Sibling-dispatch awareness (CRITICAL — C13 IS RUNNING IN PARALLEL)

A separate worktree dispatch is currently in flight: **C13 (`.advance()` + direct-write rule= validation hook)** at `docs/changes/phase-a1c-step-c13-advance-write-hook/`. C13 touches:
- `compiler/src/codegen/emit-engine.ts` (extend)
- `compiler/src/codegen/emit-reactive-wiring.ts` (extend or fork sibling)
- `compiler/src/codegen/emit-logic.ts` (write-hook wiring)
- `compiler/src/codegen/emit-expr.ts` OR `compiler/src/codegen/emit-functions.ts` (.advance dispatch — survey decides which)
- `compiler/src/runtime-template.js` (engine helpers)
- `compiler/src/codegen/runtime-chunks.ts` (NEW chunk #18 `engine`)
- `compiler/src/codegen/emit-client.ts` (chunk detection wiring)
- `compiler/tests/unit/c13-advance-write-hook.test.js` (NEW)
- `compiler/tests/runtime-tree-shaking.test.js` (likely)

**A6-1 IS SPEC.md ONLY.** Your touched-files list is:
- `compiler/SPEC.md` (extend §19.12 + possibly §47 + possibly §34)
- `compiler/SPEC-INDEX.md` (update relevant row notes)
- `docs/changes/phase-a8-step-a6-1-test-bind-spec/{progress,SURVEY}.md` (REQUIRED)

**DO NOT TOUCH any file under `compiler/src/`.** That's C13's territory entirely. If A6-1's spec authoring surfaces an inconsistency requiring compiler-source verification, READ-ONLY inspection is fine; do NOT edit.

If you find yourself about to edit a file under `compiler/src/` for any reason, STOP. Either (a) restate the spec text so the source-edit isn't needed, or (b) document the inconsistency in SURVEY for PA + leave the source unchanged.

## Anti-patterns reading

`scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` — even though this is spec authoring (not code), the worked-example scrml MUST follow current scrml shape, NOT React-Test-Renderer / Jest-mock / Sinon-stub training-data bias. Mocking patterns like `jest.fn().mockReturnValue(x)` or `sinon.stub(api, 'fetch')` are NOT scrml. The scrml shape is the literal `test-bind <fn> = <handler>` declaration syntax — terse, declarative, scope-local.

`docs/articles/llm-kickstarter-v1-2026-04-25.md` — kickstarter context for `~{}` test-block patterns and the canonical scrml test surface.

## File-modification inventory expected

| File | Reason |
|---|---|
| `compiler/SPEC.md` | NEW test-bind spec text in §19.12 + cross-ref additions in §47 + (CONDITIONAL) new error code in §34 |
| `compiler/SPEC-INDEX.md` | Update row notes for §19, §47, §34 mentioning test-bind |
| `docs/changes/phase-a8-step-a6-1-test-bind-spec/SURVEY.md` (NEW) | Phase-0 survey: where the spec text lives, error code decision, OQ deferral notes shape |
| `docs/changes/phase-a8-step-a6-1-test-bind-spec/progress.md` (NEW) | Crash-recovery |

**Negative inventory (MUST NOT touch):**
- ANY file under `compiler/src/` (that's C13's territory)
- ANY file under `compiler/tests/` (no test changes; this is spec-only)
- ANY file in scrml-support (read-only for source-of-truth Insight 22 quotes)
- `pa.md`, `master-list.md`, `hand-off.md` (PA owns those — surface deltas in SURVEY for PA to land)

## Definition of Done

- All §scope IN items shipped: test-bind spec text added in chosen home(s); cross-refs in place; SPEC-INDEX updated; worked example included.
- Spec re-verified: every claim in the new spec text traces back to Insight 22 verbatim OR existing SPEC §19/§47 prose. NO inventions.
- Insight 21, E-TEST-004, E-FN-004 explicit-unchanged claims included in the new spec text.
- Position B explicit-not-adopted note included with forward-compat-claim language (no flip-condition gating).
- OQ-8b, OQ-test-bind-concurrency, OQ-test-bind-passthrough, OQ-audit-log-compose noted as deferred (per S67) where applicable.
- 0 compiler source files modified.
- Tests: full suite still 10,349 / 60 / 1 / 0 (since no source changed; verify with `bun run test` baseline at end).
- Final report names what A6-2 (parser) consumes from this spec text — exact section anchors, exact grammar, exact error code if any.
- SURVEY.md documents:
  - Home decision (§19.12 vs §47 vs new §54.X) with reasoning.
  - Handler shape decision (literal vs function discriminated by syntax or by typer).
  - Error code decision (new E-TEST-006 vs reuse E-TEST-002).
  - OQ deferral notes shape (in spec body vs footnote vs silent).
  - Verdict shape: SHIP / REFINEMENT / SCOPE-CHANGE / BLOCKER.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is: **<ABSOLUTE-WORKTREE-PATH-PROVIDED-BY-HARNESS>**

## Startup verification (do this BEFORE any other tool call)

1. Run `pwd` via Bash. Output MUST equal the worktree path above. Save the output as your WORKTREE_ROOT.
2. Run `git rev-parse --show-toplevel` via Bash. Output MUST equal WORKTREE_ROOT.
3. Run `git status --short` via Bash. Confirm tree is clean.
4. Run `bun install` via Bash. Worktrees do NOT inherit `node_modules`.
5. Run `bun run pretest` via Bash.
6. Run `bun run test` (chained) via Bash. Confirm 10,349 / 60 / 1 / 0 baseline.

If ANY check fails: DO NOT proceed. Report the mismatch and exit.

## Path discipline (enforce on EVERY Read/Write/Edit call)

- For Read: paths under WORKTREE_ROOT are safe.
- For Write/Edit: **ALWAYS use ABSOLUTE paths under WORKTREE_ROOT.** NEVER touch files under `compiler/src/` or `compiler/tests/` — that's C13's territory.

If you find yourself about to write to a path starting with the main repo root OR under `compiler/src/`, STOP.

## Crash-recovery protocol

Commit after each meaningful change. Update `$WORKTREE_ROOT/docs/changes/phase-a8-step-a6-1-test-bind-spec/progress.md` after each step.

## Final report format

- WORKTREE_PATH (absolute)
- FINAL_SHA (your branch tip)
- FILES_TOUCHED (list — must be ONLY `compiler/SPEC.md`, `compiler/SPEC-INDEX.md`, and the dispatch-dir docs)
- VERDICT (SHIP / REFINEMENT / SCOPE-CHANGE / BLOCKER)
- TESTS at end: pass / skip / todo / fail counts (must match 10,349 / 60 / 1 / 0 baseline since no source changed)
- DEFERRED-ITEMS: anything punted to A6-2 / A6-3 / A6-4 / A6-5 / A6-6 / PA-decision
- SURVEY summary (one paragraph) — four decisions documented
- A6-2 HANDOFF: exact section anchors, grammar form, error code (if added), and what the parser must recognize/produce
