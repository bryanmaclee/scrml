# scrmlTS — Session 117 (CLOSE)

**Date:** 2026-05-21
**Previous:** `handOffs/hand-off-119.md` (S116 carryover — rotated at S117 OPEN)
**Machine:** single-machine (S100 directive holds)
**HEAD at S117 OPEN:** `67a17dc5` · **HEAD at S117 CLOSE:** this wrap commit
**Wrap:** full 8-step "wrap and push" (user-authorized).

---

## S117 net outcome

A long, branchy, productive session. The build-story design thread closed (Approach B ratified + per-`<program>` build-id deep-dived); the M5-swap got an honest re-decomposition after DD #27's compression failed verification; two M5 units landed; the README went live on GitHub.

- **scrmlTS:** 9 commits + this wrap commit. **scrml-support:** 4 commits + this wrap commit.
- **Tests:** 18,102 → **18,173 pass / 0 fail / 169 skip / 1 todo / 739 files / 55,582 expect** (+71, R1's statement-bridge tests; zero regressions).
- **No release tag.** v0.4.0 stands (S114).

---

## What landed S117

1. **Build-story artifact → Approach B ratified.** The S116 debate left A-vs-B open; S117 PA/user ratification → **B (content-addressed Merkle closure)**. Conditions: mandatory `build-story.lock` sidecar; normatively-specified canonical encoding. Recorded: `~/.claude/design-insights.md` (build-story entry), `scrml-support/docs/debates/debate-build-story-artifact-2026-05-21.md` (§"Open decision — RESOLVED"), `compiler-story-living-compiler-2026-05-21.md` (Q1).

2. **Per-`<program>` build identifier — deep-dived.** `scrml-support/docs/deep-dives/per-program-build-identifier-2026-05-21.md`. Verdict: idea holds + strengthened; nested `<program>` (§43) is a sound separate-compilation-unit boundary (normative SHALL); declaration shape = a *reference* into `scrml.toml` (deep-dive recommends `build-story=` as the attribute name, NOT `compiler=`); resolves compiler-story DD Q6; **no debate fork — routes to SPEC authoring.**

3. **M5-swap re-decomposed.** Phase-0 STOP gate caught DD #27's "swap = 6-12h" → re-survey found 46-78h → R1/R2 verification falsified three DD #27 compression claims (F2-RETIRE expression catalog, F3 hoist, the unpriced statement catalog) + surfaced the native parser has NO production for core scrml (`?`/`!{}`/`~`/`lin`/`fn`/`server`/`type`). Honest re-decomposition: `scrml-support/docs/deep-dives/m5-swap-redecomposition-2026-05-21.md` — **corrected total 96-160h; the pipeline swap deferred to v0.7**; v0.6 ships the non-routing units. DD #27 → `partially-superseded`; `compiler/native-parser/M5-SWAP-residual-decomposition.md` → `superseded`.

4. **M5 unit R1 — statement-catalog bridge LANDED** (`ab1afe3c`). `compiler/native-parser/translate-stmt.{js,scrml}` — `translateStmtList` exit-shaping module; 20/20 native `Stmt` kinds → live lowercase `LogicStatement` union; 71 tests.

5. **M5 unit R4 — SPEC §34.1 LANDED** (`01fc0c7d`). New "Native-Parser Parse Diagnostics" sub-section: 66 codes (30 `E-EXPR-*` + 35 `E-STMT-*` + 1 `E-MARKUP-VALUE-UNCLOSED`) in 3 grouped sub-tables; zero renames.

6. **README — `### The Build Story` + layered-imports.** New Features subsection (Merkle-closure model + per-`<program>` `compiler=` line + Nominal banner); "no npm" Tooling bullet rewritten as "One source file type, layered imports" with the no-npm-≠-no-user-code note. **Pushed — live at github.com/bryanmaclee/scrmlTS.**

7. **`.claude/maps/` refreshed** — full cold-start, watermark `092fa90a` → `67a17dc5`.

8. **Telemetry idea raised + rejected** — a "serialize every build for telemetry" proposal; PA pushed back (re-introduces the retracted compiler-observes-usage mechanism; breaks determinism); user accepted. Durable boundary recorded in user-voice S117.

---

## Open threads / carry-forwards — surface at S118 OPEN

1. **Build-story SPEC authoring** — the `§N Build Story` section (defines the Merkle-closure artifact, Approach B) + `<program build-story=>` attribute (§4.12.2) + `[build-story]` manifest table (§22.13) + §47.5 amendment + the ABI-invariance rule. ONE coordinated SPEC amendment (the attribute references the artifact; §N must exist first). The user said "straight to spec auth." Deep-dive's 5 OQs (OQ-3 inheritance, OQ-4 top-level legality, etc.) are drafting decisions for the spec author. Attribute name: deep-dive recommends `build-story=` over the README's `compiler=` — settle at authoring. **Serializes on SPEC.md** with any other SPEC dispatch.

2. **M5 v0.6 units — dispatch off the re-decomposition DAG.** v0.6 = the non-routing units: the **expression-catalog bridge** (the F2-RETIRE miss — a `translate-expr` sibling to R1's `translate-stmt`) + the **hoist fix** (R2's declaration-shape synthesis). R4 §34 already landed. The 13-unit DAG + per-unit estimates + the `token.js` file-contention hazard for the B-units are in `m5-swap-redecomposition-2026-05-21.md`. The native-parser Tier-B feature gaps + the swap itself are **v0.7**.

3. **dev.to online article updates.** S115 fixed the article *content in the repo* (`docs/articles/*-devto-*.md`, 11 of 12); the *published dev.to posts are unchanged*. PA offered to dispatch an agent to assemble a paste-ready update package (per-article corrected text + the retraction); the user did not answer (pulled into M5). Platform posting is the user's action. Carry forward.

4. **Living Compiler retraction** — draft at `docs/articles/living-compiler-retraction-devto-2026-05-21.md`; pending Bryan's stamp + publish (user action).

5. **"Second note from the developer"** — the user floated a designer's note unifying no-npm-≠-no-user-code with the per-`<program>` build-id idea. PA supplied a scaffold (NOT ghostwritten — it's the user's voice); the user has not yet written it.

6. **scrml.dev article canonicalization** — port surviving dev.to articles to canonical `.scrml` pages. Not started.

7. **SPEC-INDEX Quick-Lookup mini-index stale** — R4 surfaced: the `~lines 182-201` Quick-Lookup block has hardcoded section ranges grossly stale (§34 cited ~1,200 lines off). `regen-spec-index.ts` deliberately doesn't touch it. A separate Quick-Lookup-block refresh is warranted.

8. **X1 — `class`/`try`/`throw` admission** — the native parser parses these as ESTree statements with no parse-layer "not in scrml" rejection (unlike `async`/`await`). Whether they earn a hard `E-*-NOT-IN-SCRML` is native-parser-completion scope (Tier B / v0.7); additive to §34, does not retro-invalidate R4's rows.

9. **§29 vanilla-interop** — debate panel still undefined (pre-S117 carry-forward); spec↔impl divergence open.

10. **Pre-existing (S114):** generator (`yield`/`function*`) policy; tableFor v1.next impl; PRIMER match-block section; MK4 lazy-require ESM cycle.

## Push state — PUSHED (wrap step 7, user-authorized)

- **scrmlTS** + **scrml-support** both pushed to origin at S117 close. Verify `git rev-list --left-right --count origin/main...HEAD` = `0 0` on both at S118 open.

## State-as-of-close

| Item | Status |
|---|---|
| HEAD | this S117 wrap commit |
| Tests | 18,173 pass / 0 fail / 169 skip / 1 todo / 739 files / 55,582 expect |
| Worktrees | main only (5 agent worktrees cleaned at wrap §6b) |
| scrmlTS origin sync | pushed — should be `0 0` |
| scrml-support origin sync | pushed — should be `0 0` |
| Inbox `handOffs/incoming/` | empty |
| Hook gate | Configuration B (pre-commit + post-commit + pre-push) |
| pkg.json version | 0.4.0 (v0.4.0 tag stands — S114) |
| `.claude/maps/` | watermark `67a17dc5` (refreshed S117) — HEAD will be ahead by the S117 commits; refresh before any S118 dev dispatch if those commits touched relevant files |
| Background agents | none |

## Session-start checklist for S118 PA

1. Read `pa.md` pointer → `../scrml-support/pa-scrmlTS.md` IN FULL.
2. Read `docs/PA-SCRML-PRIMER.md` IN FULL.
3. Read `compiler/SPEC-INDEX.md` IN FULL.
4. Read `master-list.md` §0 IN FULL (the S117 §0.6 entry is the live delta).
5. Read this `hand-off.md` (S117 CLOSE) — rotate to `handOffs/hand-off-120.md` at S118 OPEN.
6. Read recent contentful user-voice — the S117 entry has 4 durable subsections (build-story B; per-`<program>` build-id; telemetry rejection; no-npm-≠-no-user-code).
7. Sync hygiene: `git fetch` scrmlTS + scrml-support — both should be `0 0` (pushed S117).
8. Maps refresh if S118 dispatches touch files changed since `67a17dc5`.
9. Report: caught up + next priority (= build-story SPEC authoring + the M5 v0.6 units off the re-decomposition DAG).

---

## Tags
#session-117 #CLOSE #build-story-B-ratified #per-program-build-id-deepdived
#m5-swap-redecomposed #swap-deferred-v0.7 #R1-R4-landed #readme-live #pushed
