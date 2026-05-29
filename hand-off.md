# scrmlTS — Session 140 (CLOSE)

**Date:** 2026-05-28 → 2026-05-29 (spanned midnight)
**Previous:** `handOffs/hand-off-143.md` (S139 CLOSE — 4-patch-release marathon).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-144.md` at S141 OPEN.

**S140 in one line:** Bug-51-class corpus-coverage audit (8-surface workflow + PA dual-verify) found **5 silent-miscompiles on shipped features hidden behind emit-string-only tests**; fixed the 4 HIGH (Bug 57 `<each>` / 59 `tableFor`-evt / 58 `formFor`-surface / 61 `formFor`-read-path) each with a happy-dom acceptance gate — **formFor now functional end-to-end**; filed Bug 54 + 60 DEFERRED; cut **v0.6.7**; sent giti + 6NZ resume-dogfooding messages.

**HEAD at CLOSE:** `18de30ba` (release v0.6.7) + wrap commit on top. **HEAD at OPEN was** `e1630e93`.
**HEAD scrml-support:** `dbb47c3` (unchanged).
**pkg.json:** 0.6.7 (tag `v0.6.7` — pushed at close).

**Tests at CLOSE:** pre-commit subset 15,101 pass / 0 fail / 88 skip / 1 todo; browser 248 pass / 0 fail; full suite via pre-push gate (count in §State-as-of-CLOSE).

**S99 path-discipline counter:** 20 (HELD — 5 worktree dispatches this session, zero leaks; the 1 Bug-61-v1 crash was an API 500, not a path-discipline incident).
**Worktrees at CLOSE:** cleaned (see cleanup note) — main only.
**Inbox:** empty.
**PA auto-memory:** 43 rule files.

---

## Session-start checklist (S140 OPEN)

- [x] Read `pa.md` pointer → `scrml-support/pa-scrmlTS.md` IN FULL (1050 lines; S136/S138/S139 addendums in force)
- [x] Read `docs/PA-SCRML-PRIMER.md` §1–§13.7 substantively (B14–B22 AST-contract appendix tail skimmed; ~1248/1426 lines)
- [x] Read `compiler/SPEC-INDEX.md` IN FULL (381 lines)
- [x] Read `master-list.md` §0.1–§0.6 head (live dashboard + S137/S138/S139 CLOSE entries)
- [x] Read previous `hand-off.md` (S139 CLOSE) IN FULL
- [x] Read user-voice S136 + S137 entries (last logged; S138 + S139 NOT yet logged to user-voice — see open item)
- [x] Sync check: scrmlTS 0/0 with origin · scrml-support 0/0 with origin
- [x] Hooks: configuration B (local-rich — pre-commit + post-commit + pre-push all present at `.git/hooks`)
- [x] Inbox check: empty
- [x] Worktree check: main only
- [x] Rotated `hand-off.md` → `handOffs/hand-off-143.md`
- [x] Created fresh `hand-off.md` (this file)
- [ ] Incremental map refresh prompt — DEFERRED (maps watermark `1fed5588`, current HEAD `e1630e93` is 1 docs-only commit ahead → effectively current; see open item re: staged maps)

---

## DONE this session (S140)

- **Staged-maps anomaly RESOLVED** — committed at `c4d5ef96` (`chore(s139-close): commit deferred maps refresh`; pathspec-scoped; pre-commit hook passed 15,076/0). The S139 hand-off had mischaracterized 10 tracked-and-staged map files as "gitignored." scrmlTS is now **+1 unpushed** (push-pending — see open item).
- **Bug-51-class corpus-coverage audit COMPLETE** — 8-surface empirical workflow (parallel probes → synthesis) + PA dual-verify. Report: `docs/audits/bug-51-class-corpus-coverage-audit-2026-05-28.md`. **Found 5 silent-miscompiles on shipped features** (all hidden behind emit-string-only tests — the Bug-51 blind spot). See audit-results block below.

## Bug-51-class audit results (S140) — 5 silent-miscompiles + reverse-R26 correction

**The HIGH=0 milestone was partly an artifact of the test blind spot, not actual correctness.** Every audited runtime-bearing surface is emit-string-only tested; none has happy-dom mount-and-drive coverage.

| Surface | Class | Sev | PA-verified? | Root cause (verified line) |
|---|---|---|---|---|
| `<each>` Tier-1 iteration | SILENT-MISCOMPILE | HIGH | ✅ YES | emit-client.ts:684 `chunks.add("reconciliation")` gated in `case "for-stmt"` only; no `each-block` case → `_scrml_reconcile_list` called-but-undefined → ReferenceError on first render. **Broadest blast radius** (any `<each>`-only adopter file). |
| `formFor` (§41.14/§55) | SILENT-MISCOMPILE | HIGH | ✅ YES | type-system.ts:11113 `spliceFormFor` inserts synth compound state-decl into MARKUP-children array → never reaches state/validity-surface emission. Flagship form renders inputs but validation 100% dead (8 unbacked `.isValid`/`.errors` reads; W-DG-002 ×3; `submitted` never set; onsubmit gets no `values`). |
| `tableFor` Defect 1 (per-row checkbox) | SILENT-MISCOMPILE | HIGH | ✅ YES | emit-lift.js:531 emits `function(event){ <handler w/ evt> }` — `evt` free var (siblings 713/731/760 rebind). Bug-50-class RESIDUAL at the site Bug-50 fix `c89f1176` never patched (only emit-event-wiring.ts). Runtime ReferenceError per toggle. |
| `tableFor` Defect 2 (`:let` slot) | SILENT-MISCOMPILE | HIGH | ⬜ agent-evidence | `:let={...}` slot body dropped at PARSE layer (children empty before type-system sees it); column falls through to default text render. = the long-deferred unfiled **Bug 54 candidate**. |
| render-by-tag nested compound field (§6.3.5) | SILENT-MISCOMPILE | MED | ⬜ agent-evidence | emit-html.ts:1325 render-by-tag uses `lookupStateCell` (top-level only), never `lookupQualifiedStateCell` → nested `<signupForm><userName/></signupForm>` emits literal browser-ignored tags; input never appears. S139 Bug-51 fixes otherwise HOLD (v1-v6,v8 confirmed). |
| `schemaFor` (§41.15) | COVERAGE-GAP-ONLY | LOW | — | Works end-to-end (DDL rewrite fires; enum-lowering correct). DDL-absence-from-bundle is SPEC-mandated server-only (Bug 41). Real adopter fixtures never driven →DDL in any test. |
| engine `effect=` (§51.0.H) | COVERAGE-GAP-ONLY | LOW | ✅ (reverse-R26) | **S139 "effect= doesn't fire" claim NOT REPRODUCED** — runtime-verified bellRung flip on both direct-set + .advance(). Ghost. No fix. emit-string only; no happy-dom. |
| engine `<onTransition>` (§51.0.H) | COVERAGE-GAP-ONLY | LOW | — | Handler fires on matching (from,to) (runtime-verified). emit-string only. |
| Shape-1 lifecycle `(A to B)` E-TYPE-001 (§14.12) | OK | none | — | E-TYPE-001 fires on all positions, no false-fire; real-pipeline covered. No action. |

**Through-line:** emit-string coverage cannot detect a tree-shaken primitive (each), a wiring-in-wrong-pipeline drop (formFor), a runtime free-var (tableFor-D1), a parse-layer slot drop (tableFor-D2), or a literal-tag fallthrough (render-by-tag). A **happy-dom mount-and-drive test tier** is the missing acceptance gate.

**Bugs filed (S140):** 54/57/58/59 HIGH + 60 MED into `known-gaps.md`; §0 counts HIGH 0→4, MED 6→7. Committed `73162ef9` (audit doc + known-gaps + 3 BRIEF.md + progress scaffolds).

## IN FLIGHT (S140) — 3-HIGH fix wave DISPATCHED (parallel, worktree-isolated, background)

User authorized the 3-HIGH wave (each + formFor + tableFor-D1) + landing commits. Each brief mandates: F4/S90/S99/S112/S126 path discipline + `git merge main` startup; happy-dom runtime test as acceptance gate (the missing tier); targeted emit-regression fails-before/passes-after; R26 empirical re-compile before DONE; S83 commit discipline; no `--no-verify`. BRIEF.md archived per S136 at each change-dir (committed `73162ef9`).

| Bug | change-id | agent | scope |
|---|---|---|---|
| 57 each-reconcile | `bug-57-each-reconcile-chunk-2026-05-28` | a339f6c8811d7ae8a | emit-client.ts `case "each-block"` chunk-gate (reconciliation + deep_reactive + bodyChildren walk) — **✅ LANDED `e4859a5f`** (PA-verified R26: reconcile DEFINED 1, browser 10/0; S83 stale-view filtered — did NOT revert bug-59's emit-lift.js) |
| 58 formFor-validity | `bug-58-formfor-validity-surface-2026-05-28` | a47bb67a51eee3412 | 6 src (type-system/emit-form-for/emit-html/binding-registry/emit-event-wiring/emit-bindings) — synth decl→logic pass + compound-parent tag + validator ExprNode decoration + `_flatBindKey` + onsubmit values/submitted — **✅ LANDED `29c33a6c`** (PA-verified R26: 10 derived_declare, 5 validator fires, W-DG-002 gone, no SQL leak; S83 stale-view filtered to 10 files; 57/59 confirmed intact) |
| 59 tableFor-evt | `bug-59-tablefor-perrow-evt-2026-05-28` | a647b42cd1adb179b | emit-lift.js 2 onevent sites (AST-expr ~L760 actual carrier + L531 string sibling) mirror Bug-50 fix — **✅ LANDED `6a0c3a63`** (PA-verified R26: bug pattern gone, `evt =>` arrows, browser 6/0; brief-locus corrected by agent) |

**3-HIGH WAVE COMPLETE — Bugs 57 + 58 + 59 all RESOLVED (PA-verified, landed).** known-gaps flipped to RESOLVED; §0 HIGH 4→2. scrmlTS HEAD `29c33a6c`, **+5 unpushed** (c4d5ef96 maps · 73162ef9 dispatch-artifacts · 6a0c3a63 bug-59 · e4859a5f bug-57 · 29c33a6c bug-58).

**⚠️ Bug 61 NEW HIGH (filed, OPEN) — formFor NOT functional end-to-end until fixed.** Bug 58 emits the validity surface correctly, but the COMPOUND-LEVEL rollup read-path is a separate defect: `@compound.isValid` emits `_scrml_reactive_get("compound").isValid` (member-access on the compound value → `undefined`) instead of `_scrml_derived_get("compound.isValid")` (the dotted derived cell, which IS declared). So `disabled=!@form.isValid` → always `true` → submit button stuck disabled even when valid. PA-verified on formFor emit AND hand-authored §55 compound. PRE-EXISTING + GENERAL (all §55 compounds; per-field 3-segment reads work, only 2-segment compound-rollup misrouted). Outside the authorized 3-HIGH wave — SURFACED TO USER for go/no-go. Fix locus: the `@compound.<prop>` read-path resolver (likely emit-bindings.ts / `@`-member read-rewrite) must route 2-segment synth-prop access to `_scrml_derived_get`. Deferred-sibling folded into Bug 61: generic compound-child `bind:value=@compound.field` deep-set (Bug 58 fixed formFor-locally via `_flatBindKey`).

**Bug 61 fix DISPATCHED** (user chose "fix Bug 61 then cut v0.6.7" + "push with the cut"). Agent `a0744d0c0c75de88b`, change-id `bug-61-compound-rollup-read-path-2026-05-28`, baseline `66121fe8` (has 57/58/59 + Bug 61 filing + brief). Brief mandates merge-main (build on Bug 58's `_flatBindKey`), read-path-only fix (route 2-segment `@compound.<synthProp>` to `_scrml_derived_get`), happy-dom gate proving submit button ENABLES, non-regression on per-field + real-field reads. **AGENT RUNNING.** Committed `66121fe8` (+6 unpushed).

**Bug 61 status: agent CRASHED (API 500) → PA-direct attempt REVERTED (over-fire + fix bigger than surgical). NOT landed. Agent branch `5ec3319e` preserved (reusable scaffold).**

S140 Bug 61 chronology:
1. Agent `a0744d0c` got the fix 80% right but CRASHED on API 500 (server instability) before the happy-dom gate + R26. Committed branch `5ec3319e`: emit-expr.ts `emitMember`/`synthDottedKey` scaffold (routes `@compound.<synthProp>` → `_scrml_reactive_get(dotted)`) + conf test (7/7) + full suite 15095/0.
2. PA dual-verify found an **OVER-FIRE**: the agent's guard routes on leaf-NAME alone (`SYNTH_PROPERTY_NAMES.has(leaf)` + `@`-root), so a PLAIN cell with a field named `errors`/`submitted`/`isValid`/`touched` (e.g. `<config> = {errors:[...]}`, read `@config.errors`) mis-routes to `_scrml_reactive_get("config.errors")` (unregistered → undefined). Confirmed empirically. Regression blocker — agent's conf test missed it (only tested `@form.name`, leaf not a synth prop).
3. PA-direct attempt to tighten the guard hit TWO dead ends (both empirically disproven):
   - **`getResolvedStateCell` (B3) FAILS** — codegen re-parses attribute/interpolation exprs from raw strings, so B3's `_resolvedStateCell` annotations are ABSENT on codegen-time nodes. Guard over-rejected → broke routing entirely (compound `@form.isValid` fell through to member-access).
   - **`derivedNames` does NOT contain dotted synth keys** — `collectDerivedVarNames` (reactive-deps.ts:254) collects top-level derived names only; `derivedNames.has("form.isValid")` is FALSE. Guard didn't route.
4. **The correct fix (banked for re-dispatch):** a pre-pass `collectSynthCellKeys(fileAST)` mirroring `emit-synth-surface.ts:emitCompoundSynthSurface` key-gen — compound: `<q>.errors/.isValid/.touched/.submitted`; per-field (non-synth, non-compound-typed, non-markup, non-derived children per the fieldChildren filter at emit-synth-surface.ts:135): `<q>.<field>.errors/.isValid/.touched`; with nested-compound qualifiedName recursion. Add `synthCellKeys?: Set<string>|null` to `EmitExprContext` (+ EmitLogicOpts), populate at index.ts:631/703 alongside `derivedNames: collectDerivedVarNames(...)`, thread through the ~6-10 sites that propagate `derivedNames` (emit-event-wiring, emit-logic, emit-control-flow, emit-variant-guard, emit-validators). Guard in emit-expr.ts `emitMember`: `if (client && !optional && SYNTH_PROPERTY_NAMES.has(leaf)) { dotted = synthDottedKey(node); if (dotted && ctx.synthCellKeys?.has(dotted)) return _scrml_reactive_get(dotted); }`. synthDottedKey = pure AST walk (no annotations — the agent's `5ec3319e` version is correct). Acceptance gate: conf emit-regression (compound + per-field route; over-fire `@config.errors` does NOT; real-field `@form.name` does NOT) + happy-dom (submit button enables) + R26. This is agent-dispatch-shaped (threaded-collector impl), NOT PA-surgical.

**Bug 61 RE-DISPATCHED v2** (user chose "re-dispatch now" despite instability). Agent `aaa1bc622077a5cfe`, baseline `f8aac7db` (57/58/59 + v2 brief). BRIEF.md v2 (committed `f8aac7db`) encodes: the over-fire, the two dead-ends (getResolvedStateCell + derivedNames — do-not-retry), the threaded `collectSynthCellKeys` recipe, and crash-resilient commit order (fix+conf-test committed BEFORE happy-dom, so a repeat 500 leaves a recoverable verified-at-conf fix). **AGENT RUNNING.**

**PLAN:** land Bug 61 v2 (leak-check → S83 stale-view-filtered file-delta → PA-independent R26 incl. over-fire probe + happy-dom button-enables + the THREADING didn't regress full suite → commit) → cut v0.6.7 (bump 0.6.6→0.6.7 → tag → push commits+tag, per bump-on-tag) → **SEND staged dogfooding messages** (below) → wrap. If the agent crashes again mid-flight, salvage its committed fix+conf-test (crash-resilient order) + PA-complete the happy-dom/R26 tail OR re-evaluate.

**STAGED OUTBOUND — giti + 6NZ resume-dogfooding (user-authorized; SEND AT v0.6.7 PUSH).** Drafts at `handOffs/outgoing-staged/STAGED-{giti,6NZ}-resume-dogfooding-v0.6.7.md`. At send: (1) fill `<V0.6.7-TAG>`/`<V0.6.7-SHA>`/`<DATE-HHMM>`; (2) update the `<BUG-61-NOTE>` placeholder in BOTH per whether Bug 61 landed in v0.6.7 (if NOT landed: add Bug 61 to the known-broken list — formFor submit-gate stuck); (3) **6NZ dir ambiguity — BOTH `6NZ/` and `6nz/` exist; verify the live repo (git remote/recent commits) before writing**; (4) rename to `<DATE>-HHMM-scrmlTS-to-<repo>-resume-dogfooding.md`, write into `<repo>/handOffs/incoming/`; (5) consider a `needs: push` master notice (the sibling inboxes were written). Content: build=v0.6.7 tag; the Bug-51-class "compiles-clean-but-runtime-wrong is the gold class" framing; S140 fixes (57/58/59 + formFor); known-broken DO-NOT-REPORT (Bug 54 `:let`, Bug 60 nested-compound render-by-tag, +Bug 61 if unlanded); per-recipient target surfaces (giti: channels/SSE/auth/schema; 6NZ: engines-hierarchy/lifecycle/list-churn/input-state — 6nz-V noted RESOLVED); reproducer-required.

scrmlTS HEAD `f8aac7db`, **+7 unpushed**: c4d5ef96 maps · 73162ef9 dispatch-artifacts · 6a0c3a63 bug-59 · e4859a5f bug-57 · 29c33a6c bug-58 · 66121fe8 known-gaps+bug61-filing · f8aac7db bug61-brief-v2.

**Worktree cleanup PENDING** — now 4 landed/active worktrees (a339f6c8 bug-57 / a47bb67a bug-58 / a647b42c bug-59 landed; a0744d0c bug-61 running) retained per S83; remove at wrap.

**Cluster-close bookkeeping remaining (at v0.6.7 cut):** changelog S140 block · master-list §0.6 + counts · worktree cleanup · pkg.json 0.6.6→0.6.7 + tag + push.

**S83 stale-view caught at Bug-57 landing:** Bug 57's branch (cut from `73162ef9`, pre-bug-59) diffed emit-lift.js + bug-59 test as DELETIONS vs current main. File-delta filtered to Bug-57's 3 files only; bug-59 fix confirmed intact post-landing.

**NOT-REPRODUCED (R26-reverse; NOT filed):** Bug-57 agent surfaced a deferred item — Tier-0 `${for…lift}` with `:`-shorthand body (`<li : r.name>`) allegedly emits malformed JS. PA independently compiled the exact shape (single-line + multi-line) on BOTH current main AND the agent's own worktree compiler (~73162ef9): compile clean, `node --check` PASS, no malformed fragment, both times. Agent mis-observation. Re-trigger: if a concrete malformed-emit repro surfaces, re-examine. Bug-50-redux discipline applied — did not file on a non-reproducing observation.

**PA-side on each completion (S83/S88/S99/S138):** `git status --short` in main (detect leaks) → `git -C <worktree> status` clean check → `git diff main..<branch> -- <files>` review → file-delta `git checkout <branch> -- <files>` → review staged → **PA-independent R26 dual-verify** (don't trust agent R26 numbers) → PA-authored commit (explicit pathspec) → after all 3 land, worktree cleanup. Then decide v0.6.7 cut.

**DEFERRED (filed, not dispatched):** Bug 54 (tableFor `:let` parse-layer) + Bug 60 (render-by-tag nested-compound, MED).

## Open questions to surface at S140 OPEN

1. **Fix-dispatch strategy for the 5 silent-miscompiles** — surfaced to user. Candidates ranked: (1) each chunk-omission [surgical, 1 case], (2) formFor validity-surface routing [deeper], (3) tableFor-D1 evt [surgical, mirror Bug-50], (4) tableFor-D2 `:let` = Bug 54 [parse-layer, deeper], (5) render-by-tag nested compound [MED]. Wave vs incremental vs file-only-then-triage = user's call.

2. **Push-pending** — scrmlTS +1 (maps commit `c4d5ef96`). Push now or at wrap?

3. **R27 task selection** (carried) — fresh-task gauntlet round. The audit's "shipped-but-untested-at-runtime" finding strengthens the case for an adopter-shaped R27 + a happy-dom test-tier mandate.

4. **user-voice S138 + S139 backfill** — last entry is S137; S138/S139 were bug marathons (likely no new durable directives). Confirm.

---

## Carry-forward candidates (from S139 CLOSE)

### IMMEDIATE
- **R27 different-task gauntlet round** (per S136 R25 Path B).
- **Bug-51-class corpus-coverage audit** (~1–3h scoping; high value — pattern repeats across Bug 11 / 51 / 56).

### MEDIUM
- **Bug 9 L3 transitive coloring** — §8 tripwire test in `compiler-managed-async-bug-9-and-55.test.js` flags when L3 lands. Defer until adopter demand.
- **errorBoundary direction call** (R24 step-3b) — substantive design HU; deferred S136–S139.
- **2 non-compliant heads-up docs cleanup** — `docs/heads-up/iteration-design-2026-05-25.md` + `lifecycle-annotation-extension-2026-05-25.md` carry stale `status: in-progress` / `findings-closed: 0`; underlying features shipped. ~30min.

### LOWER / LONG-HORIZON
- **v0.6.7 cut** — only if further patches accumulate. Current state fully shipped at v0.6.6.
- **v0.7 = M6 cutover** (BS+Acorn → native parser). Native parser M2.4 + MK2 per S112 charter B.
- **`<formFor>` / `<tableFor>` / `<schemaFor>` end-to-end test surfaces** (implicit in Bug-51-class audit).

---

## pa.md directives in force entering S140

- **S136** — BRIEF.md archival per `isolation: "worktree"` dispatch (cross-machine).
- **S138** — R26 empirical-verification doctrine BIDIRECTIONAL (forward: verify before claim-CLOSED; reverse: verify before claim-OPEN/dispatch; cross-source sweep + sibling-fix-unmask sub-rules).
- **S139** — `full wrap [arc-name]` discriminator (stay warm through arc-end; 88% safety floor).
- Standing: `--no-verify` prohibition (extends to pre-push); S126 Bash-edit + no-`cd`-into-main mitigation; S99 path-discipline counter; S88 explicit `isolation: "worktree"`; S90 CWD-routing gate.
- Rule 4: SPEC normative. Rule 5: shoot straight.

---

## State as of CLOSE

| Item | Value |
|---|---|
| HEAD scrmlTS | `18de30ba` (release v0.6.7) + wrap commit on top |
| v0.6.7 tag | `18de30ba` (pushed at close) |
| HEAD scrml-support | `dbb47c3` (unchanged) |
| pkg.json | 0.6.7 |
| Tests (CLOSE) | pre-commit subset 15,101/0/88/1 (15,190 across 783 files) · browser 248/0 · full suite via pre-push gate |
| Worktrees | main only (4 agent worktrees cleaned at close: a339f6c8/a47bb67a/a647b42c/aaa1bc62 + crashed a0744d0c) |
| Inbox | empty |
| S99 path-discipline counter | 20 (HELD — 5 dispatches, 0 leaks) |
| PA auto-memory | 43 rule files |
| Maps | watermark `1fed5588` (S139 refresh, committed `c4d5ef96` this session); current HEAD ahead by S140 commits — refresh candidate next session |
| Push state | pushed at close (commits + v0.6.7 tag) |
| HIGH bugs open | 2 (Bug 54 `tableFor :let` DEFERRED · the remaining audited-but-deferred surface) |
| MED bugs open | 7 (Bug 60 render-by-tag nested-compound DEFERRED) |
| LOW bugs open | 12 |
| Nominal (spec-ahead-of-impl) | 7 |
| Dogfood messages | giti + 6NZ resume-dogfooding sent to inboxes at close (build=v0.6.7) |

---

## Tags
#session-140 #OPEN #high-count-0 #staged-maps-anomaly #r27-candidate #bug-51-class-audit-candidate #v0-6-6-shipped
