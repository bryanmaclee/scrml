# scrmlTS — Session 114 (CLOSE)

**Date:** 2026-05-21
**Previous:** `handOffs/hand-off-116.md` (S113 CLOSE — rotated at S114 OPEN)
**Machine:** single-machine (S100 directive holds)
**HEAD at S114 OPEN:** `e613621` (S113 wrap) · **HEAD at S114 CLOSE:** the wrap commit (post `a58b83d`)
**Origin sync at CLOSE:** scrmlTS — wrap+push (v0.4.0 tag) · scrml-support — wrap+push.

---

## S114 net outcome — the native-parser arc CLOSED + v0.4 cut + Approach C ratified

S114 was a milestone session — the native-parser front-end completed end-to-end (JS chain M1-M4 + markup chain MK1-MK4 + the markup↔JS seam at MK4), the K-ledger closed at 12-of-12, the language-design envelope sealed (no async/await — language-wide; ^{} expressiveness — Approach C; quoted-text model — natively implemented), the v0.4 release-cut staged + tagged, and the M5/M6 path took its real shape (M5-LIGHT landed; M5-FULL decomposed into the MD ladder; scope-revision DD queued for next session).

- **Tests S114 OPEN 17,812 → S114 CLOSE 17,842** — net +30 conformance; zero regressions; pre-commit subset 13,358 / 0 fail / 92 skip / 1 todo (matches v0.4 baseline EXACTLY).
- **24 substantive commits on scrmlTS + the wrap;** 4 commits on scrml-support.
- **v0.4.0 release-cut staged (S94 paired op):** pkg.json `0.3.3` → `0.4.0` (11e2ddf); CHANGELOG release entry covering everything since v0.3.0 (S92); tag lands at this wrap.
- **3 background DDs ran during the session:** ^{} expressiveness (verdict Approach C, ratified) + import:host grammar-shape sub-DD (verdict α suffix-form) + Ext 1+3+2 scope-dive (16 sub-steps, 15 CLEAN / 1 ratified-S4-amendment). Plus the #27 M5/M6 scope-revision DD running at wrap, returns for next session.

---

## S114 commit ledger (24 substantive + the wrap)

| # | Commit | What |
|---|---|---|
| 1 | `1714e97` | S114 open — maps refresh `87453fb` → `e613621` + hand-off rotation |
| 2 | `e272c05` | K8 — function → fn refactor (478 decls / 27 files) |
| 3 | `0026ecc` | K9 — markup-layer circular import + delegation-frame leaf |
| 4 | `f0201f7` | M4.2 — K6 destructuring unification + noIn |
| 5 | `603ddc5` | K11+K12 — parse-markup null/undefined → not / is not |
| 6 | `749c957` | **M4.3 — M4 close + async/await retraction (Threads A + B)** |
| 7 | `20604e4` | S114 docs — PRIMER §6.1 + SPEC §19.9.8 + §48.3.5 + §34 +3 |
| 8 | `7604db0` | K10-corrected — `!= not` → `is some` (PA caught K-ledger wrong direction) |
| 9 | `f30101c` | Roadmap §4.4 K-ledger corrections + K8/K10/K11/K12 RESOLVED status |
| 10 | `e429c58` | SPEC §4.18.3 editorial — escape catalog has 3 (option B) |
| 11 | `b61c4cb` | Deref quoted-text-model → scrml-support archive |
| 12 | `30c4e7b` | K3+K4+K5 — M1 lexer maximal-munch closure (14 new TokenKinds) |
| 13 | `714b903` | **MK4 — native-parser front-end COMPLETE (markup↔JS seam)** |
| 14 | `11e2ddf` | **v0.4.0 staged — pkg.json bump + CHANGELOG release entry** |
| 15 | `f61ccd7` | Ext 1 implementation brief (docs/changes/full-body-split/) |
| 16 | `0d9c3f9` | SPEC §21.3.1 + §22.5.1 + §22.12 + §22.13 + §34 +2 (Approach C + import:host) |
| 17 | `cb49798` | README versioning messaging (drop "pre-1.0" framing) |
| 18 | `a58b83d` | **M5-LIGHT — `--parser=scrml-native` observability shadow** |
| 19+ | wrap | hand-off + master-list + tag v0.4.0 |

scrml-support: `9fed637` (user-voice S114) · `5329e6c` (archive deref) · `1688876` (^{} DD + Approach C ratification) · the latest combined commit (Ext 1+3+2 dive + import:host DD + user-voice ratifications) · plus this wrap's user-voice S114 CLOSE entry + the #27 DD doc (lands when DD returns).

---

## THREAD 1 (closed S114) — native-parser front-end COMPLETE

**M-ladder status at S114 CLOSE:**

| Mn | Layer | Status |
|---|---|---|
| M1 — composed-engines lexer | JS | ✅ COMPLETE (S99-S103) |
| M1.5 — expr-literals.js conformance flip | JS | ✅ COMPLETE (S102) |
| M2 — JS expression parser | JS | ✅ COMPLETE (S112-S113) |
| M3 — JS statement parser | JS | ✅ COMPLETE (S113) |
| M4 — full bounded JS subset | JS | ✅ COMPLETE (S113-S114 — M4.1 / M4.2 / M4.3 with async/await retraction) |
| MK1 — `BlockContext` engine | Markup | ✅ COMPLETE (S112) |
| MK2 — `TagFrame` engine | Markup | ✅ COMPLETE (S113) |
| MK3 — `BodyMode` + `DisplayTextLiteral` | Markup | ✅ COMPLETE (S113) |
| MK4 — markup↔JS seam | Markup | ✅ COMPLETE (S114 — `714b903`) |
| **M5 — pipeline swap behind `--parser=scrml-native`** | Both | **🔶 M5-LIGHT LANDED (`a58b83d`); M5-FULL decomposed into MD ladder** |
| M6 — joint retirement (BS + Acorn + BPP + JS-parser-in-^{}-body) | Both | ⬜ blocked on the MD ladder + scope-revision DD outcome |

**K-ledger 12-of-12 RESOLVED:** K1 (forward-ref, S113) · K2 (lex circular import, S113) · K3+K4+K5 (M1 lexer maximal-munch, S114 `30c4e7b`) · K6 (destructuring unification, S114 `f0201f7`) · K7 (lexer prototype-pollution, S113) · K8 (function→fn refactor, S114 `e272c05`) · K9 (markup-layer circular import, S114 `0026ecc`) · K10 (`isExpr` presence-check — `!= not` → `is some`, S114 `7604db0`) · K11+K12 (parse-markup null/undefined refs, S114 `603ddc5`).

---

## THREAD 2 (closed S114) — Approach C for ^{} ratified + SPEC encoded

The S114 ^{} expressiveness deep-dive (`scrml-support/docs/deep-dives/meta-block-runtime-semantics-expressiveness-2026-05-21.md`) answered the load-bearing question: scrml-native fully describes runtime semantics + closes compile-time `^{}` to scrml-native with a bounded self-host carve-out (`import:host`).

**Ratified S114:**
- **`^{}` general-developer surface — scrml-native only.** No embedded-JS-parser inside `^{}` bodies. Compile-time = `emit` / `emit.raw` / `reflect` (3 primitives). Runtime = 8 §22.5.1 `meta.*` members + 4 new timer primitives = 12 closed primitives.
- **Self-host bootstrap carve-out — `import:host` declaration form.** File-top, manifest-gated by §22.13 to `scrml/stdlib/compiler/**`. Suffix-form (`import:host { x as y } from "..."` per the grammar-shape sub-DD verdict α).
- **M6 retirement under Approach C is TOTAL** — BS + Acorn + BPP + JS-parser-in-^{}-body all retire.

**Encoded in SPEC (`0d9c3f9`):**
- NEW §21.3.1 — `import:host` declaration form + 7 normative statements + worked example + pluggability note (future `:wasm` / `:wat` / etc.).
- §22.5.1 amended — +4 timer primitives + lifetime / cleanup interaction.
- NEW §22.12 — Approach C ratification (M6 total-retirement implication + prior art).
- NEW §22.13 — `[capabilities] host-import` manifest entry.
- §34 +2 codes — E-IMPORT-008 (manifest-gate violation) + E-IMPORT-009 (unknown host-tag).

---

## THREAD 3 (closed S114) — no async/await language-wide

**Ratified S114** — user-voice verbatim: *"I have intentionally left async/await out of the language, because I hate leaky abstractions and colored functions."* + clarification *"!{} is officially error context"* (which led to the body-split / `!` / `!{}` naming-discipline correction).

**Encoded in SPEC + PRIMER (`20604e4`):**
- PRIMER §6.1 NEW — parallel-rule to "no try/catch".
- SPEC §19.9.8 NEW — language-wide canonical rule + the body-split / `!` / `!{}` decomposition.
- SPEC §48.3.5 amended — E-FN-005 subordinate to §19.9.8.
- §34 +3 codes — E-ASYNC-NOT-IN-SCRML / E-AWAIT-NOT-IN-SCRML / E-FOR-AWAIT-NOT-IN-SCRML.
- M4.3 parser retraction landed (the M5-FULL composition continues this enforcement).

PA memory anchored — `feedback_no_async_await.md` + `feedback_error_model_distinction.md` (both written S114; indexed in MEMORY.md).

---

## THREAD 4 (closed S114) — v0.4.0 release-cut staged + tagged

Per S94 paired-operation rule:
- pkg.json `0.3.3` → `0.4.0` (commit `11e2ddf`).
- CHANGELOG release entry "v0.4.0 — 2026-05-21 (the post-v0.3.0 rollup)" added at top of `docs/changelog.md`.
- v0.4.0 tag created at wrap, points at the wrap commit.

**v0.4 release scope — what shipped (adopter-facing):**
- L22 family flagships (formFor S102-103, schemaFor S104; tableFor DD landed, impl pending v0.4.x).
- Tailwind §26 expansion (S100 / S108-109).
- Bug-fix arc (S107-110).
- SPEC §4.18 quoted-text + §4.18.3 editorial.
- No-async/await language-wide (SPEC §19.9.8 + PRIMER §6.1).
- `import:host` declaration form + Approach C ratification (SPEC §21.3.1 + §22.x).
- `<onTimeout>` + `<onIdle>` (S77-78); `<page>` + §40 v0.3 program-shape; `<auth role>` + per-route artifact splitting.

**v0.4 internal — NOT adopter-facing yet:**
- Native-parser front-end COMPLETE (M1-M4 + MK1-MK4).
- K-ledger 12-of-12 resolved.
- M5-LIGHT observability shadow.
- Ext 1+3+2 scope-dive + Ext 1 impl brief authored (~88-112h impl pending).
- ^{} expressiveness DD + Approach C SPEC encoding.

**Forward cadence (per master-list S114 ratification):**
- v0.4.x patches = Ext 1+3+2 implementation landings + tableFor impl + adopter-friction touch-ups + the M5/M6 scope-revision (pending #27 DD) + the MD ladder if option (b)+(c) hybrid is chosen.
- v0.5 = M5-FULL — pipeline swap default-on or significantly past M5-LIGHT.
- v0.6 = M6 — joint retirement; BS + Acorn + BPP + JS-parser-in-^{}-body all deleted.

---

## THREAD 5 (closed S114) — Ext 1+3+2 ratified + Ext 1 brief authored

User-voice S114 verbatim: *"I want ext 1-3-2 asap and safe to impl."* Overrides the S72-deferral-to-v0.next+1 friction-gating. Ratified S114 with the S4-predicate amendment for Ext 2 M2.3 (the §8.9-transactional-envelope equivalence class for write-in-loop patterns).

**Scope-dive (`scrml-support/docs/deep-dives/ext-1-3-2-full-body-split-scoping-2026-05-21.md`, 1109L) verdict:**
- 16 sub-steps: Ext 1 (M1.1-M1.6, ~40-50h) + Ext 3 (M3.1-M3.4, ~20-25h) + Ext 2 (M2.1-M2.6, ~28-37h).
- 15 CLEAN / 1 NEEDS REFRAMING (Ext 2 M2.3 — ratified) / 0 BLOCKERS.
- Total ~88-112h. Body-DG builder (M1.2) — the load-bearing surprise; existing `dependency-graph.ts` is module-grain not statement-grain.
- Ext 4 + Ext 5 compose freely; ^{} orthogonality confirmed; async/await envelope preserved.

**Ext 1 brief authored** at `docs/changes/full-body-split/EXT-1-IMPL-BRIEF.md` (`f61ccd7`, 293L). Dispatch-ready. **Ext 3 + Ext 2 briefs NOT yet authored** — author them when sub-step dispatches are about to start.

---

## THREAD 6 (PARTIAL S114) — M5-LIGHT landed; M5-FULL via MD ladder via #27 DD

**M5 dispatch returned PARTIAL.** The AST-bridge scoping (`compiler/native-parser/M5-ast-bridge-scoping.md`) found that bridging native-parser output → live FileAST requires approach (c) refactor at ~70-250h+, exceeding the 16-36h M5 budget. Agent landed M5-LIGHT under the brief's safety qualifier.

**M5-LIGHT (`a58b83d`):** `--parser=scrml-native` CLI flag recognized + validated + threaded through `compileScrml` + fires `I-PARSER-NATIVE-SHADOW` info diagnostic. Downstream stages still consume live FileAST. Zero behavioral change when flag unset.

**M5-FULL via MD ladder** (per the divergence ledger at `compiler/native-parser/M5-divergence-ledger.md`):
- MD.1 attrs handling (20-30h)
- MD.2 ESTree expr bridge (25-35h)
- MD.3 hoisted collections (15-20h)
- MD.4 spans + PGO has* flags (10-15h)
- MD.5 state/sql/css/error/meta payloads (20-30h)
- Re-entered M5 (8-16h)
- **Total ~98-180h**

**#27 scope-revision DD ratified S114 (option 3)** — running at wrap. Output: `scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md`. **Next session: PA picks up the DD verdict + decides which MD-ladder steps RETIRE the downstream feature vs bridge it.**

---

## S114 process notes (for the next PA)

**Path-discipline incidents (S99 counter, S114):**
- K11+K12 — agent self-caught + reverted (first incident).
- M5 — agent self-caught + reverted (second incident).
- Total S114: 2 leaks; both self-caught + reverted before commit; net leak zero. **Cumulative S99-onwards counter: 7 incidents.** The platform-level PreToolUse hook flagged in pa.md §S99 addendum is increasingly load-bearing for v0.4+ dispatch quality.

**Rule-4 violation (caught + corrected S114):** K10 K-ledger entry said `!= not` → `is not` (the OPPOSITE direction — `is not` is absence check, not presence check). K10 dispatch agent followed the brief literally, caught the inversion in its anomaly section. PA caught at file-delta review. PA-direct correction landed (`7604db0`): `!= not` → `is some`. Roadmap §4.4 K-ledger updated with the precedent note (Rule-4 reminder: verify K-ledger entries against SPEC before encoding into briefs).

**Grain debate (S112 PARKED for M5 revisit):** M5-LIGHT close IS the M5 revisit. Debate is now actionable. **Queued for next session** alongside the #27 DD verdict review.

**Mandatory dispatch-brief clauses (S114 baseline — 7 clauses):** F4 startup-verification + `git merge main --no-edit` (S112) + predecessor-file check + coupled-code+test = one logical unit (S113) + `isolation: "worktree"` explicit (S88) + path-discipline + S99 incident counter + MAPS — REQUIRED FIRST READ with commit-SHA + date.

---

## Open questions / carry-forwards to surface at S115 OPEN

1. **#27 M5/M6 scope-revision DD verdict** — output at `scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md`. Per-feature retire-or-bridge classification + cross-cutting compound retirements + revised total estimate + ratification pivots. **Next-session-blocking for the MD ladder dispatch path.**

2. **Grain debate (S112 PARKED)** — whole-stage vs nanopass. M5-LIGHT close IS the moment. Queued.

3. **Ext 1+3+2 — ready to dispatch.** Ext 1 brief authored (293L dispatch-ready). Ext 3 + Ext 2 briefs NOT yet authored — author when sub-step dispatches are about to start. M1.1 (type lift, 3-4h) is the first sub-step; dispatch when user authorizes.

4. **Open questions queued from S114 DDs (5 + 5 + 1):**
   - From ^{} expressiveness DD: (a) `import:host` scope (top-level vs manifest-gated — ratified manifest-gated); (b) 4 timer primitives names + lifetime (ratified via §22.5.1 amendment); (c) `friction.md Q2` JSON.stringify status check (small lookup); (d) `bun.eval(...)` disposition (retire vs persist); (e) cross-file metaprogramming interaction with closed primitive set under M6.
   - From import:host grammar-shape sub-DD: (1) strict-v1 host-tag (ratified — only `host` in v1); (2) re-export shape `export:host` defer; (3) manifest default `"disabled"` (ratified); (4) `as` rename optional (ratified); (5) cycle detection scope (ratified — scrml graph only).
   - From Ext 1+3+2 scope-dive: 1 open item — M1.3 machine-crossing detection false-positive precision (surface at dispatch if rate high).

5. **K8 K10 process precedent** — verify K-ledger entries against SPEC §42 before encoding into briefs (Rule-4 reminder).

6. **Pre-existing carry-forwards from earlier hand-offs:** §29 vanilla-interop disposition (S110 — open); generator policy (yield / function* — S114 separate-conversation flag); v0.5 release cadence shape under the revised M5/M6 scope; PRIMER match-block section; Bug 1 ring-offset (DIFFERENT than today's K10 — verify); tableFor v1.next impl (~10-15h pending); the lazy-require pattern in MK4 (parse-expr ↔ parse-markup ESM cycle — future K-class extraction if judged unclean).

---

## Things S115 PA must NOT screw up

- **The #27 DD will return during S115 OPEN.** PA reads it FIRST before deciding M5-FULL / MD-ladder cadence.
- **v0.4.0 tag is LIVE** — pkg.json reflects 0.4.0; tag pushed to origin. Any v0.4.x patch follows the S94 paired-operation rule (bump pkg.json THEN tag).
- **K-ledger is CLOSED (12-of-12).** Any new K-class issue gets K11+ numbering — but K11 + K12 are TAKEN (S114 — parse-markup null/undefined). Next is K13.
- **The native-parser ladder is COMPLETE M1-M4 + MK1-MK4 + the seam at MK4.** M5-LIGHT is the only M5 work landed. M5-FULL via MD ladder pending #27 DD verdict.
- **`^{}` is scrml-native ONLY for general developers** (Approach C ratified). Don't surface `^{}` body extensions as open questions; they're closed by SPEC §22.12.
- **No async/await — language-wide.** Don't surface as an open question; SPEC §19.9.8 ratifies it as a Pillar-shape rule.
- **`!{}` is the ERROR context** — NOT the async surface. Body-split = async; `!`/`!{}` = error model; compose but distinct.
- **Mandatory dispatch-brief clauses (the 7) on every compiler-source `isolation:"worktree"` dispatch.** Path-discipline incident counter is at 7; mention in every brief.

---

## State-as-of-CLOSE

| Item | Status |
|---|---|
| HEAD | wrap commit (post `a58b83d`) |
| Tests | **17,842 pass / 0 fail / 173 skip / 1 todo / 732 files / ~52,800 expect** (pre-commit subset 13,358 / 0 fail / 92 skip / 1 todo) — matches v0.4 baseline EXACTLY |
| `compiler/src/` changes S114 | M5-LIGHT only (cli.js + commands/compile.js + api.js — observability shadow flag) |
| `compiler/native-parser/` changes S114 | LARGE — M4.2 / M4.3 / MK4 / K-ledger fixes / new files (`parse-seam.scrml`/.js, `delegation-frame.scrml`/.js, `M5-ast-bridge-scoping.md`, `M5-divergence-ledger.md`) |
| Worktrees | main only (all S114 worktrees cleaned at landing) |
| scrmlTS origin sync | pushed through this wrap (incl. v0.4.0 tag) |
| scrml-support origin sync | pushed through this wrap |
| Inbox `handOffs/incoming/` | empty (only `read/`) |
| Hook gate | Configuration B (pre-commit + post-commit + pre-push) |
| pkg.json version | **0.4.0** (bumped S114 11e2ddf; matches v0.4.0 tag) |
| `.claude/maps/` | watermark `e613621` (S114 OPEN); ~24 commits behind — refresh S115 |
| `.claude/agents/` | gitignored; standard set retained |
| Background DDs at wrap | #27 scope-revision DD running — output `scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md` |

---

## Session-start checklist for S115 PA

1. Read `pa.md` pointer → `../scrml-support/pa-scrmlTS.md` IN FULL.
2. Read `docs/PA-SCRML-PRIMER.md` IN FULL — note PRIMER §6.1 NEW (no async/await) added S114.
3. Read `compiler/SPEC-INDEX.md` IN FULL — note §21 + §22 rows updated S114 (import:host + Approach C + timer primitives + manifest entry).
4. Read `master-list.md` §0 IN FULL — refreshed S114 close.
5. Read this `hand-off.md` (S114 CLOSE) — rotate to `handOffs/hand-off-<N>.md` at S115 OPEN.
6. Read the most-recent ~10 contentful user-voice entries — S114 has 5 substantive ratifications (no-async/await + Approach C + S4 amendment + v0.4 option (a) + option 3 for M5/M6 scope-revision).
7. Sync hygiene: `git fetch` scrmlTS + scrml-support (both pushed through this wrap).
8. Inbox check; verify worktrees (main only expected — all S114 worktrees cleaned at landing).
9. **Read the #27 M5/M6 scope-revision DD** at `scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md` — load-bearing for S115's first decision.
10. Maps refresh — watermark `e613621`; HEAD will be ~24 commits ahead. Refresh before any S115 dev dispatch.
11. Report: caught up + next priority (= #27 DD verdict review + decision pivots ratification + Ext 1 M1.1 dispatch authorization).

---

## Tags

#session-114 #CLOSE #native-parser #front-end-COMPLETE #v0.4.0
#approach-C #no-async-await #ext-1-3-2 #K-ledger-CLOSED
#M5-LIGHT #MD-ladder #scope-revision-DD-queued
#24-landings #pushed
