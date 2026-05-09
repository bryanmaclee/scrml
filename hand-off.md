# scrmlTS — Session 74 (CLOSE — A1c Wave 4 CLOSED · B17.x family CLOSED · §51.0.H spec-complete · 8 ships · +245 tests · 0 regressions)

**Date opened:** 2026-05-08
**Date closed:** 2026-05-09 (session crossed midnight)
**Previous:** `handOffs/hand-off-73.md` (S73 close — A1c Waves 1+2+3 ALL CLOSED · 9 ships · +437 tests · 0 regressions · 0 path-discipline leaks)
**This file:** rotates to `handOffs/hand-off-74.md` at S75 open
**Tests at S74 close:** **10,553 pass / 65 skip / 1 todo / 0 fail** (~17s pre-commit; ~17s post-commit)

---

## TL;DR — what S74 did

**Massive implementation session — 8 ships across two sequence-locked tracks (A1c Wave 4 engines + B17.x family), +245 tests, zero regressions.**

| # | Step | Commit | Δ | Track |
|---|---|---|---|---|
| 1 | C12 — engine state-machine substrate | `5c910a3` | +41 | Wave 4 |
| 2 | A6-1 — test-bind SPEC | `bd30009` | 0 | A8 |
| 3 | C13 — `.advance()` + write-hook | `888d0fd` | +40 | Wave 4 |
| 4 | C14 — derived engines | `a945313` | +37 | Wave 4 |
| 5 | B17.2 — `<onTransition>`+`effect=` parser | `fd70150` | +28 | B17.x |
| 6 | C15 — cross-file engine mount | `43c8747` | +32 | **Wave 4 ✓** |
| 7 | B17.3 — typer diagnostics (5 fire-sites) | `40813f4` | +26 | B17.x |
| 8 | B17.4 — codegen hook firing | `3790131` | +41 | **B17.x ✓** |

**Cross-machine pickup at S74 open:** scrmlTS already at `532966f` (S73 wrap). scrml-support already at `6206192`. Both repos clean.

**Pattern observations:**
- **Wave 4 sequential discipline held.** Per SCOPE: C12 → C13 → C14 → C15 strict sequential. Each step's HANDOFF explicitly addressed next-step prerequisites; downstream steps consumed prior helpers without re-deriving. Zero scope-creep.
- **B17.x family pattern.** When C13 hit a parser-blocker (`<onTransition>`/`effect=` not parsed), PA surfaced as Rule-3/Rule-4 question rather than silently re-scoping. Result: full `<onTransition>`+`effect=` surface shipped in same session — B17.2 (parser) + B17.3 (typer, 5 fire-sites) + B17.4 (codegen). §51.0.H spec-complete from compiler perspective.
- **Parallel-dispatch maturity (mostly held).** Multiple parallel pairs ran cleanly: C13 + A6-1 (file-disjoint codegen + spec); C15 + B17.2 (file-disjoint codegen + parser). 2 F4 path-discipline incidents though — A6-1 self-recovered pre-commit via brief discipline block; C15 didn't self-recover but pre-commit P3-FOLLOW migration test caught it. Both contained.
- **Briefs-as-prep paid off.** C15 + B17.2 + B17.3 + B17.4 briefs were drafted in advance; ratifications surfaced ahead of dispatch; dispatches ran with high signal-to-noise.
- **`scrml-dev-pipeline` agent NOT staged this machine** (carryover from S71 master-PA notice — still pending). All 8 dispatches went via `general-purpose` substitution per pa.md authorized pattern. Worked clean; staging is no longer urgent.

---

## State as of S74 close

| Field | Value |
|---|---|
| scrmlTS HEAD | `3790131` (B17.4 SHIP — push pending — 8 commits ahead) |
| scrmlTS origin sync | 0/+8 (push pending at wrap step 7) |
| scrml-support HEAD | `6206192` (S73 archive landing, pushed) |
| scrml-support origin sync | 0/0 ✓ |
| Tests at close | **10,553 / 65 / 1 / 0** ✓ via post-commit hook |
| Inbox | empty (`handOffs/incoming/` clean) |
| Outbox-pending | none |
| Active dispatches | none (all 8 landed) |
| Worktree branches retained | 8 from S74 — all forensic per S67 protocol |

**Cumulative tests since S73 baseline:** 10,308 (S73 close) → **10,553 (S74 close)** = **+245 pass / +5 skip / 0 net new fails**.

**Wave 4 (engines) CLOSED at substrate level.** C12 + C13 + C14 + C15 all shipped. Visual-rendering + body-rendering deferrals carry forward (parser blocker, wide body-parse step territory).

**B17.x family CLOSED.** B17 (E-COMPONENT-ENGINE-SCOPE pre-A1c) + B17.2 (parser) + B17.3 (typer 5 fire-sites) + B17.4 (codegen). §51.0.H spec-complete from compiler perspective.

---

## Open questions to surface immediately at S75 open

1. **Cross-machine pickup IF S75 opens on the other machine.** MANDATORY: `git fetch origin && git pull --rebase origin main` on BOTH repos. Verify scrmlTS at this wrap commit + scrml-support at `6206192`. Re-run `bun run test`; expect 10,553 / 65 / 1 / 0.

2. **A1c Wave 5 (cross-cutting C16-C22) — ~25-35h, MOSTLY PARALLELIZABLE — next big window.** 7 steps with file-disjoint planning opportunities. Highest parallel-dispatch density of A1c. Per SCOPE row 235:
   - C16 — Refinement-type runtime emission (§53), ~5-7h
   - C17 — Schema additive shared-core lowering (§39), ~4-6h
   - C18 — Channel WebSocket emission + broadcast/disconnect runtime injection (§38), ~4-6h
   - C19 — `<program>` documentary attributes (§40.7), ~1-2h
   - C20 — `pinned` import hoisting, ~3-4h
   - C21 — Tier 3 predefined-shape compound (positional sugar lowering), ~2-3h
   - C22 — Bare-variant inference codegen (M9), ~2-3h
   - **Note: C17 spec-edit ordering blocks A9 Ext 5** per S72 integration constraint.

3. **A1c Wave 6 (C23 PIPELINE prose pass)** — ~5-8h, INDEPENDENT, can run alongside Wave 5.

4. **A8 (test-bind) sub-steps A6-2 through A6-6** — A6-1 SPEC shipped this session. Remaining: A6-2 parser (~1-2h), A6-3 typer (~1-2h), A6-4 codegen (~2-3h), A6-5 tests (~1.5-2.5h), A6-6 optional `scrml:test` API alignment (~30-60min). File-disjoint with most A1c work; could parallelize.

5. **A9 Ext 5 (S5 replay safety / idempotency-key storage)** — STILL gated on A1c C17 spec-edit ordering (per S72 integration constraint). Becomes dispatchable after C17 lands.

6. **C15-surfaced bugs filed for separate dispatches:**
   - **TS state-child rule= recognition** — `parseMachineRules` only knows legacy arrow-rule form; new `<engine ... initial=...> <Variant rule=...>` state-child form fires false-positive E-ENGINE-005. Blocks all end-to-end engine compileScrml testing. ~3-5h survey-first.
   - **B14 PASS 10.B path-shape mismatch** — `exportRegistry.get(binding.sourcePath)` uses literal relative source while production keys are absolute. Silently no-ops. ~1h fix (resolve to absolute via `resolveModulePath` before lookup).

7. **SPEC.md conflict markers cleanup** — pre-existing from older `bde823e WIP(uvb-w1)` commit at lines 13698-13702 + 13754-13758. Sat undetected (markdown spec text, tests don't validate). ~5min PA edit (resolve merge — pick a side or merge both).

8. **F4 PreToolUse hook elevation candidate.** 2 incidents this session (A6-1 self-recovered, C15 stashed/reconciled). Per pa.md F4 mitigation §2, the platform-level PreToolUse hook would close the leak entirely. Filed; needs context-aware "is this PA or a subagent?" signal.

9. **CWD drift pattern in PA shell sessions** — 2 recoveries this session (B17.2 landing, C15 landing). Bash CWD persists; some chained operations land shell in worktree directory. Pattern worth filing for next-session pickup.

10. **`scrml-dev-pipeline` agent staging gap** — STILL not staged on this machine since S71 master-PA notice. Pipeline-substitution to general-purpose has been clean across 17+ dispatches in S73+S74 combined. No longer urgent. Filed.

---

## Things S75 PA must NOT screw up (S70+S71+S72+S73+S74 cumulative)

S73-close standing list (items 113-163) carries forward verbatim. **S74 NEW additions:**

164. **A1c Wave 4 fully shipped at substrate level.** C12-C15 all on main + push pending. The codegen surface for engine state-machine runtime, .advance + direct-write hook, derived engines, cross-file mount — all functionally complete. Don't dispatch sub-step regressions; if a runtime-behavior bug is found, it's a Wave 5+ regression or integration gap, not a Wave 4 do-over.

165. **B17.x family fully shipped.** §51.0.H surface (effect= Form 1 + <onTransition> Form 2 + co-existence + default semantics + derived-engine integration) is spec-complete from compiler perspective. Don't propose adding it again or re-debating.

166. **Engine variable detection set is `engineVarNames: Set<string>`** plumbed through `EmitExprContext` (added by C13). Any future `.advance` / `.method` interception on engine variables uses this set. Don't bypass.

167. **C13 `_scrml_engine_*` runtime helpers in chunk #18 `engine`:**
- `_scrml_engine_check_transition(currentVariant, target, tableConst)` — internal predicate
- `_scrml_engine_advance(varName, target, tableConst)` — `.advance()` surface (asserted-advance-failed framing)
- `_scrml_engine_direct_set(varName, target, tableConst)` — direct-write (plain E-ENGINE-INVALID-TRANSITION)

C14 reuses for derived engines (gated). C15 cross-file mounts reference via the same shared module-scope `_scrml_state` (no per-importer instance). B17.4 wraps these helpers with hook-firing call.

168. **C14 derived-engine emission gates on `legacyMachineKeyword !== true`.** Both predicate AND chunk-detection. This was a mid-implementation critical fix — legacy `<machine derived=@x>` ALSO populates `engineMeta.derivedExpr`. Don't unify without preserving the gate.

169. **C15 worked around B14 PASS 10.B path-shape bug** in its OWN walker (`lookupSourceMap` try-relative-then-absolute). The B14 bug remains in main; file fix as separate dispatch. C15's workaround keeps cross-file mount working in production.

170. **B17.2 added 3 defensive parser bug fixes** (findOpenerEnd `${...}` skip, findStateChildCloser + findEngineCloser onTransition skip, mixed bare-vs-valued attribute walker). All pre-existing footguns surfaced by B17.2's needs. None affect prior behaviour. Don't revert.

171. **B17.3 NEW E-ONTRANSITION-NO-TARGET error code** at §34, placed adjacent to E-ENGINE-EFFECT-AMBIGUOUS (line 14454). Preserves §51.0.H code family contiguity. Don't reorder.

172. **B17.4 hook-firing dispatch shape = compile-time-baked switch** (Q1 ratified). Per-engine `__scrml_engine_<varName>_fire_hooks(from, to)` function with hard-coded if-arms per declared hook. NOT a runtime registry. Don't refactor to runtime registry.

173. **B17.4 firing timing is SPLIT** (Q2 ratified). `if=expr` evaluates BEFORE cell write (consistent old-state context for gating); body fires AFTER cell write completes (observers see new value, aligns with §51.0.H "when LEAVING"). Don't unify.

174. **B17.4 `once` lifecycle = compile-time-generated runtime boolean** (Q3 ratified). Per `<onTransition once>` emit module-scope `let __scrml_engine_<varName>_once_<idx> = false;`. NOT a runtime fired-set Map. Tree-shakeable per once-attribute presence.

175. **B17.4 hooks do NOT fire on engine init** (Decision 5). Transitions only per §51.0.H "when LEAVING". Entering initial state isn't a transition.

176. **B17.4 derived-engine integration via `wrapDerivedEngineClosureBodyWithHooks`** (Decision 6). Reads `_scrml_derived_cache[name]` for old-vs-new comparison inside `_scrml_derived_declare` closure. Don't restructure — uses C14's substrate.

177. **A6-1 SPEC text lives in §19.12.6/.7/.8** (PRIMARY home) + §47.5 cross-ref (dispatch mechanism cross-ref). Plus §19.13 + §34 E-TEST-006 row. A6-2 parser must consume from these anchors. Q4 OQ deferral notes shape = §51.0.K-style blockquote footnote at end of §19.12.7 (per §6.6.8/§6.6.10/§51.0.K convention precedent).

178. **A6-1 handler-shape discrimination = by typer at compile time** (RHS is normal expression; if function-typed and signature-assignable → invoke; else → return-stub). Aligns with `default=expr` precedent. Don't propose syntactic discrimination.

179. **8 worktree branches retained in `.claude/worktrees/`** for forensic per S67. NOT cleanup priority — branches are crash-recovery + forensic-review anchors.

180. **2 F4 incidents this session** — A6-1 self-recovered pre-commit; C15 stashed + reconciled at landing. Don't ignore future incidents; the brief discipline block + pre-commit P3-FOLLOW test are the current containment layers.

---

## File modification inventory (S74)

**scrmlTS commits (8 ships + 1 wrap = 9 total):**

| Commit | Files | Topic |
|---|---|---|
| `5c910a3` | emit-engine.ts (NEW), emit-client.ts, c12 test (NEW), c12 docs (BRIEF/SURVEY/progress) | C12 engine substrate |
| `bd30009` | SPEC.md, SPEC-INDEX.md, a6-1 docs | A6-1 test-bind SPEC |
| `888d0fd` | runtime-template.js, runtime-chunks.ts, emit-engine.ts (extend), emit-expr.ts, emit-logic.ts, emit-reactive-wiring.ts, emit-functions.ts, scheduling.ts, emit-client.ts, c10-error-message-resolution.test.js (chunk-count update), c13 test (NEW), runtime-tree-shaking.test.js (chunk-count update), c13 docs | C13 .advance + write-hook |
| `a945313` | emit-engine.ts (extend with C14), emit-client.ts (extend chunk arm), c14 test (NEW), c14 docs | C14 derived engines |
| `fd70150` | engine-statechild-parser.ts, symbol-table.ts, b17-2 test (NEW), b17-2 docs | B17.2 parser-extension |
| `43c8747` | api.js, codegen/context.ts, codegen/index.ts, codegen/emit-client.ts, codegen/emit-engine.ts (extend), gauntlet-phase1-checks.js, c15 test (NEW), p3-follow-no-isComponent-routing.test.js (allowlist), c15 docs | C15 cross-file mount |
| `40813f4` | symbol-table.ts (NEW PASS 17), SPEC.md (NEW E-ONTRANSITION-NO-TARGET row), SPEC-INDEX.md, b17-3 test (NEW), b17-3 docs | B17.3 typer diagnostics |
| `3790131` | emit-engine.ts (NEW B17.4 section), emit-client.ts, emit-expr.ts, emit-logic.ts, emit-functions.ts, emit-reactive-wiring.ts, scheduling.ts, b17-4 test (NEW), b17-4 docs | B17.4 codegen hook firing |
| `(this wrap)` | hand-off.md, master-list.md, docs/changelog.md, handOffs/hand-off-73.md (rotated from S73-close) | S74 wrap |

**scrml-support commits (0 — no changes this session).**

---

## Track-by-track summary

### A1c Wave 4 (engines) — CLOSED at substrate level

| Step | Topic | Δ tests |
|---|---|---|
| C12 (S74) | engine state-machine substrate | +41 |
| C13 (S74) | .advance() + direct-write rule= validation hook | +40 |
| C14 (S74) | derived engines (`derived=expr`, L20) | +37 |
| C15 (S74) | cross-file engine mount + auto-declared engine variable | +32 (+5 skip) |

After C15: substrate is functionally complete. Body rendering deferred (wide body-parse step territory). `<onTransition>` + `effect=` codegen firing was deferred from C13/C14 — landed via B17.x family below.

### B17.x family (`<onTransition>` + `effect=`) — CLOSED · §51.0.H spec-complete

| Step | Topic | Δ tests |
|---|---|---|
| B17 (pre-A1c) | core E-COMPONENT-ENGINE-SCOPE | (in main pre-S74) |
| B17.2 (S74) | parser-extension (body-scan + opener-attr) | +28 |
| B17.3 (S74) | typer diagnostics (5 fire-sites incl. NEW E-ONTRANSITION-NO-TARGET) | +26 |
| B17.4 (S74) | codegen hook firing (compile-time-baked switch + split timing + once + derived-engine integration) | +41 |

After B17.4: §51.0.H surface spec-complete from compiler perspective. Form 1 (`effect=`) + Form 2 (`<onTransition>`) + co-existence + default semantics + skipped lifecycle + derived-engine integration + cross-ref §18.0.2 (parser handles forbidden-inside-`<match>`) all landed.

### Phase A8 (test-bind) — A6-1 SHIPPED

| Step | Topic | Δ tests |
|---|---|---|
| A6-1 (S74) | SPEC amendment (§19.12.6/.7/.8 + §47.5 cross-ref + §19.13/§34 E-TEST-006 row) | 0 (spec only) |

A6-2 through A6-6 (parser/typer/codegen/tests/optional API) pending. File-disjoint with most A1c remaining work.

### A1c Wave 5 (cross-cutting C16-C22) — NOT YET DISPATCHED

7 steps, ~25-35h, mostly file-disjoint and parallelizable. **Note: C17 spec-edit ordering blocks A9 Ext 5** (per S72 integration constraint).

### A1c Wave 6 (C23 PIPELINE prose) — INDEPENDENT

~5-8h, can run in parallel with any other wave. Documents v0.next pipeline state.

---

## Master inbox state at close

`/home/bryan/scrmlMaster/handOffs/incoming/`:
- `2026-04-22-scrmlTS-to-master-insight-25-multi-meta.md` — UNREAD legacy from S30s era
- `2026-05-08-S72-scrmlTS-to-master-needs-push-SUPERSEDED.md` — RENAMED at master-push-protocol-retirement (S72)
- `2026-05-08-S71-scrmlTS-to-master-stage-scrml-dev-pipeline.md` — UNREAD (master-PA agent staging request from S71; still not addressed; pipeline-substitution clean across 17+ dispatches now so deprioritized)

No active pending master notices from S74.

---

## Push state

scrmlTS: 8 commits ahead at wrap-trigger. **Wrap-push pending (will execute as wrap step 7).**

scrml-support: 0/0 sync ✓ (no changes this session).

---

## Tags

#session-74 #a1c-wave-4-CLOSED #b17-x-family-CLOSED #spec-§51.0.H-spec-complete #8-ships #+245-tests #zero-regressions #2-f4-incidents-contained #cwd-drift-recovered-twice #briefs-as-prep-paid-off #parallel-dispatch-mature #spec-md-conflict-markers-filed-for-cleanup
