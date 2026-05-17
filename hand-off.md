# scrmlTS — Session 98 (CLOSE)

**Date:** 2026-05-17
**Previous:** `handOffs/hand-off-99.md` (S98 OPEN snapshot rotated as S99 OPEN-pickup; this file is S98 CLOSE)

---

## TL;DR for S99 PA pickup

S98 was a **multi-track marathon** that opened with a comprehensive future-scrml inventory + parallel-machine split, executed the Acorn-replacement Phase 0 deep-dive + first implementation milestone (M1.1 lexer skeleton with composed engines), shipped two parallel SPEC amendments (§48.6.4 fn mutual-recursion + §51.0.B.1 payload-binding on engine state-children), landed the DG super-linear perf fix (closes "stable slope" half of comp-time story per S94 perf characterization), fixed two compiler bugs surfaced BY the M1.1 work (Anomaly 1 block tokenizer + Anomaly 3 SURVEY's spec amendment), and orchestrated with Machine B who closed 5 of 6 of their parallel queue items including the scrml.dev architecture deep-dive + 12 articles surface scaffolding.

**16 commits scrmlTS + 5 commits scrml-support pushed end-to-end.** Velocity-mode active for second half of session per user use-it-or-lose-it directive.

---

## Final state at S98 close (this commit)

- **scrmlTS HEAD:** `7ba0268` (§51.0.B.1 SPEC amendment); this CLOSE-wrap commit lands on top
- **scrml-support HEAD:** `592044b` (A3 SURVEY landing) — see scrml-support handOffs for its session state
- **scrmlTS ahead/behind origin:** 0/0 pre-wrap; 1/0 post-wrap
- **Working tree:** `M docs/articles/teej_baiting_tweet.md` (S98 pre-session WIP per user "leave as-is" directive)
- **Worktrees retained (9):**
  - `agent-a17929499b2a3ad56` (M1.1 native lexer)
  - `agent-a020eb49167259169` (DG super-linear fix)
  - `agent-ab5d1e70eb3dac830` (A3 SURVEY)
  - `agent-ac612b544305232a4` (A1 fix block-tokenizer)
  - `agent-a25354e1febdc3df0` (§51.0.B.1 SPEC amendment)
  - `agent-a81c57ad2f4731425` (S98 P2 §48 amendment)
  - `agent-a5305c03f000d78fe` (S98 conformance harness)
  - `agent-a6c8edba1148c34f4` (A2 fix — in flight at wrap)
  - `agent-afccf9a7ac1b3d0cd` (combined lint additions — in flight at wrap)
- **Inbox (scrmlTS):** 1 unread — `2026-05-17-0811-machine-B-to-machine-A-S98B-P1-wrap-and-coordination.md` ALREADY PROCESSED (reply landed `0efe39f`; moved to read/ in `6281ec3+cfd4786`). PLUS `2026-05-17-0700-machine-A-to-machine-B-S98-parallel-work-split.md` + `2026-05-17-1100-machine-A-to-machine-B-S98A-queue-shift.md` (outgoing to Machine B; Machine B will move to read/ on their pickup).

**Tests at HEAD `7abb72f` (post-lint-land):** 15107 pass / 1 fail (pre-existing Bug 18 browser-runtime smoke; orthogonal) / 133+ skip / 1 todo / 670 files. M1.1 added +69 tests; A1 fix added +10 tests; §51.0.B.1 SPEC-only +0 tests; lint additions added +22 tests; Machine B P2 articles +0 tests (pure docs).

---

## S98 commit ledger (16 scrmlTS + 5 scrml-support)

scrmlTS chronological:
```
f12926f  docs(s98-open): rotation + Machine-B inbox message for parallel-work split
5122da6  docs(s98): primer §2 Pillar 5b "Reach discipline" — companion to Pillar 5
80c148f  feat(spec): §48.6.4 fn mutual-recursion-via-hoisting (S98 P2 — Acorn-replacement DD §D4 P2)
912a9af  test(parser-conformance): pre-M1 harness — driver + 4-tier diff + 1000-file corpus + 12 bench fixtures
4469bdf  feat(native-parser): M1.1 lexer skeleton — composed engines + LexMode + InCode body
0efe39f  docs(s98): page-helper §1.3 S86 fix + reply to S98B Machine-B coordination
6281ec3  docs(handoff): move Machine-B S98B inbox message to read/ after action
cfd4786  docs(handoff): remove S98B msg from incoming/ (already copied to read/)
b179842  perf(dg): O(1) edge dedup + reverse fn-name index — close DG super-linear scaling
3f27a6c  fix(engine-statechild-parser): skip ${...} inside comments + strings — Anomaly 1
85bd8e4  docs(handoff): S98A → Machine-B queue shift — velocity-mode orchestrator-worker
7ba0268  feat(spec): §51.0.B.1 payload-binding on engine state-children (A3 SURVEY track 1)
```
Plus this S98 CLOSE wrap commit landing master-list + changelog + hand-off.

scrml-support chronological:
```
f14bb42  docs(user-voice): merge S85 machine-B additions in chronological slot
124204e  docs(s98): Acorn-replacement Phase 0 DD + typestate-meta-shape design-horizon stub + user-voice S98
4eba0ed  docs(deep-dive): scrml.dev MDN-style architecture Phase 0 (P1 Deliverable A)  [Machine B]
59cc1f8  docs(pa): switch canonical dev-dispatch kickstarter v1 → v2  [Machine B]
be2c864  docs(deep-dive): meta-system capability boundary SPEC prose draft (P5)  [Machine B]
f1da6c1  docs(handoff): process Machine-A S98A coordination reply — move to read/  [Machine B]
c411b99  docs(voice): 3 quote-anchored essay scaffolds (P6)  [Machine B]
592044b  docs(deep-dive): Anomaly 3 SURVEY — payload-bearing engine state-child variants
```

Machine B's chronological in scrmlTS:
```
3b2dd1c  docs(articles): v0 stub redirect now points at v2 (kickstarter supersession)
f838790  feat(website): scrml.dev Phase 0 skeleton + 3 flagship feature pages (P1 Deliverable B)
01e0bc2  docs(handoff): S98B Machine-B → Machine-A — P1+P3 wrap + 3 coordination items
c1a6e09  docs(articles): kickstarter v1+v2 idiomatic-examples S86 sweep (P4)
702abc7  feat(website): articles surface — index + 1 flagship full-conversion + 11 skeletons (P2 partial)
```

---

## IN-FLIGHT at wrap (S99 FIRST ACTION: land these via S83 protocol)

### Task #19 — A2 fix (function-body-stripping in SPA-shape .scrml files) — DONE BUT NOT LANDED

**Worktree:** `agent-a6c8edba1148c34f4`  
**Status at S98 close:** DONE; 3 commits in worktree (`f4ad8a7` first attempt source-slice superseded → `3a98cab` regression tests → `4512eb2` final fix token-slice approach). +10 regression tests pass; root cause located + fixed.

**S99 first action — REQUIRES CAREFUL 3-WAY MERGE:**

A2's `compiler/src/ast-builder.js` change + lint dispatch `7abb72f`'s `ast-builder.js` change BOTH apply to same file but A2's branch base (`4469bdf`) predates lint commit. Cannot do simple `git checkout` — would overwrite lint's `isNonEntryPageFile` suppression.

**Recommended resolution path:**
```bash
# Inspect A2's diff against its branch base
git diff 4469bdf worktree-agent-a6c8edba1148c34f4 -- compiler/src/ast-builder.js > /tmp/a2-ast-builder.patch

# Apply on top of current main (which has lint's changes)
git apply /tmp/a2-ast-builder.patch

# If apply fails: manual 3-way — A2 adds body+params population at line ~6457-6495 export synth path; lint adds isNonEntryPageFile predicate elsewhere; both should coexist cleanly.
```

Plus checkout the other A2 files (regression tests are NEW files; no conflict):
```bash
git checkout worktree-agent-a6c8edba1148c34f4 -- \
  compiler/tests/unit/ast-builder-grammar-fixes.test.js \
  compiler/tests/integration/anomaly-2-export-fn-body-stripping.test.js
```

**9 NEW failures surfaced by A2 fix (Rule 3 right-answer disposition):** the fix correctly aligns AST semantics with SPEC; surfaced bugs are PRE-EXISTING source-file bugs that body-stripping defect was silently hiding. Per A2 DONE Option (a) RECOMMENDED: **land + file follow-ups; don't roll back.**

The 9 surfaced failures + follow-up dispatch candidates:
1. `compiler/self-host/module-resolver.scrml` uses bare `null` — self-host source-file cleanup
2. `compiler/self-host/meta-checker.scrml` uses `switch` + `!= null` — self-host source-file cleanup
3. `compiler/self-host/tab.scrml` default-parameter syntax — **parseParamList default-value handling bug** at `ast-builder.js parseParamList()` line 5942-5997 (separate dispatch candidate)
4. `examples/23-trucking-dispatch/seeds.scrml runSeeds()` — RI doesn't promote `export function foo() { server { ... } }` to server-bound (separate RI dispatch candidate)
5-9: bug-18 browser-runtime smoke isolation flake (pre-existing, orthogonal)

**Shadow retirement status post-A2 (partial):**

| File | Retire-able? | Reason if not |
|---|---|---|
| `compiler/native-parser/span.scrml` → `span.js` | YES | bodies populate correctly |
| `bracket-stack.scrml` / `cursor.scrml` / `error-recovery.scrml` / `lex-mode.scrml` | YES | same |
| `token.scrml` → `token.js` | **NO** | source has `if (kw == undefined)` line 296 (E-SYNTAX-042; per SPEC §42 use `is not`). Source needs rewrite first. |
| `lex-in-code.scrml` / `lex.scrml` | **NO** | cross-file imports not resolved (E-SCOPE-001) when compiled in isolation. Needs gather-pass support OR explicit import decls. M1.2-side coordination. |

Mangled-name caveat for ALL retire-able: M1.1 lexer-conformance tests import from `.js` shadow files. Pointing them at compiled `.client.js` requires resolving mangled-name issue (compiled exports use `_scrml_NAME_N` not `NAME`). M1.2-side coordination per A2 DONE report.

**Sequence for S99:**
1. Land A2 via 3-way merge (above)
2. Triage 9 surfaced failures — file as separate dispatch candidates per A2 recommendation Option (a)
3. M1.2 dispatch — partial shadow retirement (span / bracket-stack / cursor / error-recovery / lex-mode shadows can go; token + lex-in-code + lex stay until their source-side issues resolved)

### Task #25 — Combined lint additions — ✓ LANDED `7abb72f`

W-PROGRAM-001 fire-condition tightening + W-LINT-024 Svelte $store. 22 new tests; 17→0 docs/website W-PROGRAM-001; stress-harness generic-error 1→0. **Anomaly surfaced:** §34 W-LINT-016..024 catalog backfill needed (task #26).

---

## Carry-forward priorities (sequenced for S99)

### Immediate (S99 OPEN actions)

1. **Land any in-flight dispatch landings** (#19 A2, #25 lint) via S83 protocol.
2. **Process A2 SHADOW_RETIREMENT_STATUS** — if shadows retire-able, restore M1.1 lex-mode.scrml state-child bodies (lift A1 workaround note; restore prose using `//` line comments per A1 DONE).

### Track 2 of A3 SURVEY (next dispatch candidate)

3. **§51.0.B.1 compiler-feature wiring** — track 2 of A3 SURVEY. SPEC amendment landed `7ba0268`; compiler now needs:
   - `compiler/src/engine-statechild-parser.ts` — extract `payloadBindings` from state-child attribute list per the 3 forms (bare/named/parenthesized)
   - `compiler/src/symbol-table.ts` PASS 11 — validate per §51.0.B.1 normative: arity match (E-ENGINE-PAYLOAD-ARITY-MISMATCH); unit-variant rejection (E-ENGINE-PAYLOAD-ON-UNIT-VARIANT); reserved-name precedence (E-ENGINE-PAYLOAD-RESERVED-COLLISION)
   - `compiler/src/codegen/emit-variant-guard.ts` — wire-function payload-scope injection (sub-anomaly #3 from SURVEY)
   - Tests for each
   - Estimate: ~4-6h per SURVEY §5
   - Fire as scrml-dev-pipeline isolation:worktree

### M1 parser arc (sequential post-A2)

4. **M1.2 lexer** — InSingleString + InDoubleString state-bodies. Dispatch shape depends on A2 outcome (if shadows retire, pure scrml-native; if not, continue shadow pattern). Lex-mode.scrml state-child bodies can be restored to non-bare form per A1 fix verified workaround-lift status.
5. **M1.3 lexer** — InTemplateBody + nested LexMode engine per §51.0.Q.1 (the architecturally load-bearing piece). Sequences after M1.2.
6. **M1.4 lexer** — InLineComment + InBlockComment + InRegexBody + FULL M1 conformance gate pass. Sequences after M1.3.

### Held pending user disposition

7. **lin redesign Phase 1** (#4) — user explicitly paused S98: "I'll think about the lin situation before committing to work."
8. **Typestate-primitive meta-shape** (#12) — design horizon stub filed at scrml-support `124204e`; default hold.

### v0.3.x / v0.5+ backlog

9. **CG hotspot deep characterization** (#18) — v0.5+ horizon per S94 doc.
10. **BS-level /* */ bug** (#23) — sub-anomaly from A1 fix; v0.3.x backlog.
11. **Two-machine wrap reconsolidation** (#22) — meta-process; defer to a session where user wants to tackle it.

---

## Three M1.1 anomalies status

| # | Anomaly | Status | Disposition |
|---|---------|--------|-------------|
| **A1** | Block tokenizer `${}` inside `//` comments in engine state-child bodies | ✓ FIXED `3f27a6c` | 8 sites fixed; M1.1 workaround can be lifted in M1.2 |
| **A2** | Function-body-stripping in SPA-shape .scrml files | IN FLIGHT (#19) | shadow workaround through M1.4 per user; fix in parallel |
| **A3** | Payload-bearing engine variants on state-children | track 1 ✓ FIXED `7ba0268`; track 2 queued (#3) | SPEC amendment landed; compiler-feature wiring next session |

PLUS **4 sub-anomalies surfaced by A3 SURVEY** (in `scrml-support/docs/deep-dives/payload-bearing-engine-state-child-variants-SURVEY-2026-05-17.md` §3):
- §51.0.M `Done(rows: int)` vs `<Done count>` name-divergence → resolved as positional binding; editorial example update landed
- Undocumented compiler heuristic too-permissive → addressed by §51.0.B.1 normative + new error codes
- Wire-function payload-scope runtime gap → track 2 dispatch will fix
- Parenthesized form `<Done(rows)>` parser mystery → track 2 dispatch will fix

PLUS **1 sub-anomaly from A1 fix** (#23):
- Pre-existing BS-level `/* */` bug in markup contexts → v0.3.x backlog

---

## Comp-time performance — user-surfaced thread S98

User asked to surface + investigate the "comp-times back down or stable" speculation. Found:

- **S94 perf-characterization landed at `docs/changes/perf-characterization/CLOSURE-ANALYSIS-COST.md`** (420 lines) — closure-analysis surface is NOT bottleneck (~3% of pipeline); CG = 78%; DG = only stage with super-linear scaling (per-file Δms 0.064 → 0.546 across 28→108 file sweep = 8.5× growth).
- **DG super-linear root cause LOCATED + FIXED S98** at `dependency-graph.ts:1738-1830` (transitive-reactive-read fixpoint). 3 `edges.some()` + 1 `edges.filter()` + 1 missing reverse-index converted. ~52ms savings at current 108-file scale; prevents DG from becoming dominant at projected 500+ files. **Delivers "stable slope" half of comp-time story.**
- **CG profiling remains v0.5+ horizon per S94 doc** for "back down" half. Task #18 holds.
- **Cold-vs-warm 18% gap + stdlib auto-gather 72-file expansion** = additional levers documented in S98 initial investigation (not yet acted on).

---

## Things S99 PA must NOT screw up

### Permanently load-bearing (from prior sessions)
- pa.md Rules 1-5 (no marketing without prompt; full-production fidelity; right beats easy; SPEC normative; shoot straight)
- All S96/S97/S98 PA-memory rules in `~/.claude/projects/-home-bryan-scrmlMaster-scrmlTS/memory/`
- Cross-machine sync hygiene — fetch/pull both repos at session start; reconcile-before-work
- S83 commit discipline two-sided rule (agent + PA)
- S88 isolation:worktree mandatory on every dev-agent Agent() call
- S91 CWD-routing rule (Bash `cd` to sibling repo + Agent dispatch = wrong-repo worktree allocation)

### S98 NEW (this session)
- **Pillar 5b "Reach discipline"** — PRIMER §2 amendment landed `5122da6`. State-shape first; logic when calculation. Applies to all future design + code review.
- **Velocity-mode protocol** (S98A second half): primary orchestrator + parallel queue worker shape. Documented in `2026-05-17-1100-machine-A-to-machine-B-S98A-queue-shift.md`.
- **A3 SURVEY pattern** — when M1.x surfaces a "spec/compiler iteration needed" gap, fire a SURVEY-ONLY (general-purpose, research-only) dispatch first; then split into SPEC track + compiler-feature track. Worked end-to-end S98.

---

## Open questions to surface immediately (S99 PA pickup)

1. **Machine B's queue progress** — Inbox message `2026-05-17-1100-machine-A-to-machine-B-S98A-queue-shift.md` shipped them P2 remaining 10 articles + BACKLOG refresh + master-list §I commitments. Status unknown at S98 close; check `scrml-support/handOffs/incoming/` + Machine B's git log for activity since `c411b99`.

2. **A2 fix outcome** — if shadows retired, M1.2 fires as pure scrml-native; if shadows continue, M1.2 follows M1.1 pattern.

3. **Track 2 §51.0.B.1 compiler-feature wiring** — fire after A2 + lint lands, OR fire immediately if file-disjoint from in-flight work.

4. **lin Phase 1** — user thinking; check if user has direction.

5. **Two-machine wrap reconsolidation (#22)** — user flagged S98 as defer-til-pressure; track for forcing-function surfacing.

---

## Tags

#session-98 #CLOSE #16-commits-scrmlts #5-commits-scrml-support #M1.1-lexer-shipped #DG-perf-fix #pillar-5b-ratified #spec-§48.6.4-fn-hoisting #spec-§51.0.B.1-payload-binding #A1-fixed #A3-survey-landed #A2-in-flight #lint-additions-in-flight #velocity-mode-second-half #cross-machine-coordination-active #machine-B-5-of-6-priorities-closed
