# s460-d1-land progress

WIP(s460-d1-land): start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a5007afcb110f4452 (base 01b1933cd = D1 round 7 + main 63423d5fa)

## Merge origin/main (b4b94f3d6: #1364 dpa-070, #1365 ship-strip, #1366 wrap s459)
Conflicts (2, both generated docs):
- `compiler/SPEC-INDEX.md` — totals + row line-ranges. 3-way check with ranges/sizes normalized: base->ours and base->theirs have ZERO non-numeric differences, so no hand content was at stake. Resolution: took ours, then `bun run scripts/regen-spec-index.ts` (33 rows updated; totals 47,290 lines).
- `docs/FACTS.md` — facts-table figures (src lines, test files, SPEC lines, conformance cases). Resolution: took ours, then `bun scripts/facts.ts --write` (facts-table regenerated).
Auto-merged: `compiler/SPEC.md` (D1 §42.3.5 etc. vs main's §47.9.9 ship-strip) — clean.
Checked current (no regen needed): `docs/bootstrap-conformance.md` (`--check` current), known-gaps §0 gap-counts (`state.ts` reports current).
`master-list.md` @generated:recent-sessions (git-log-derived, not CI-gated, cloud-maps regenerates it) left byte-identical to main — no churn.

## Round-8 artifacts
`docs/changes/s459-d1-round8/` on this base = BRIEF.md + progress.md only (docs-only). Header note added (STOPPED and DROPPED — S460 ruling) — commit after the merge.

## Gates on merge head 2bfa69469 (+ docs commit)
- pre-commit core gate (unit+integration+conformance+root *.test.js, --bail): 33407 pass / 58 skip / 12 todo / 0 fail (1508 files, 964 s under heavy cross-session load)
- `bun conformance/run.ts`: 1422/1472 pass + 50 xfail, 0 FAIL
- `bun run types:check`: OK — 184 diagnostics (117 distinct), unchanged (baseline NOT rewritten)
- runtime-size-ratchet.test.js: 8 pass / 0 fail
- regen-spec-index --check OK (72/72 scanned, 0 stale); facts --check PASS; conflict-marker-gate PASS (10690 files); delta-lint PASS; s34-census --check-new --base origin/main PASS (6 rows); lint-no-default-arm 0 violations
- bootstrap-conformance --check: current
- (browser tier, host-global-scan, other CI steps: see below)

## Corpus differential (merge head vs origin/main b4b94f3d6), roots examples,samples,conformance,stdlib
Base captured from `git archive origin/main` (no .git, so the diff tool reports INCOMPARABLE on provenance only — exit 2; content comparison complete).
- enumeration: base 2478 / head 2513; delta = D1's 37 added conformance cases, 2 renamed (declared-prop-* -> undeclared-attr-*).
- compile outcome: 0 newly FAILING; 2 newly PASSING: conformance/cases/components/bind-non-bindable-prop-clean (exit 1->0; E-ATTR-011 -> E-DG-002), stdlib/math/index.scrml (exit 1->0; E-SCOPE-001 gone).
- code changes, outcome unchanged: bind-non-bindable-prop-reject (E-ATTR-011 -> E-DG-002, E-COMPONENT-013 kept).
- text-only: duplicate-prop-decl-reject, examples/23-trucking-dispatch/pages/dispatch/load-detail, stdlib/path, stdlib/time.
- artifacts: 7174 compared, 192 differ = 162 `_scrml_project_root` path-only + 30 real (declared component props no longer emitted as root attributes / setAttribute effects — D1 declared-prop-not-root-attr behaviour; examples/22-multifile, examples/23-trucking-dispatch, component conformance cases, phase4 samples).

## F1 — `show=` is not a presence guard (PA scope addition, S460 differential review of 01b1933cd)
Governing sentence, SPEC §17.2: "`show=` SHALL NOT narrow. Because the element and its children exist and are evaluated while `expr` is false, a binding tested by `show=` keeps its un-narrowed type inside the element (§42.3.5)". §42.3.5: "**`show=` is NOT a narrowing guard.** … a bare `@user.name` there SHALL fire E-TYPE-046."
- Verified reviewer loci: `compiler/src/presence-narrowing.ts` `guardKeys` (:178) and `walkNodeNarrowed` `isGuard` (:211) both admitted "show". Removed from both; module header + option doc + four type-system.ts comments corrected. `if=` / `else-if=` unchanged.
- Reproducers (reviewer's copied, not edited): showfn_attr, b_show, b_show_anc -> E-TYPE-031 each (were clean); my show-narrows (cell) -> E-TYPE-046 (was clean); g_ifattr (if=) -> clean.
- Conformance added: components/callback-prop-show-guard-reject (E-TYPE-031 x3), components/callback-prop-if-guard-twin (executed: clicks -> "hh"; #none guarded elements count 0), reactive/optional-member-access-show-reject (E-TYPE-046 x1), reactive/optional-member-access-if-twin (executed).
- Corpus (newly-rejecting direction), merge head manifest vs F1 tree, examples+samples+conformance+stdlib: 2513 common sources — 0 outcome changes, 0 diagnostic-code changes, 0 text changes, 7334/7334 artifacts byte-identical. S451's prediction (0 new E-TYPE-046/E-TYPE-031) holds.
- gap g-impl1-show-narrows-s451 -> resolved (locus corrected to presence-narrowing.ts); §0 regen (LOW 314 -> 313); FACTS + bootstrap-conformance regenerated (1476 cases).
- F1 commit: 981a873c1 (pre-commit gate 33411 pass / 58 skip / 12 todo / 0 fail).

## Gates on F1 head 981a873c1 (final code head)
- pre-commit core gate: 33411 pass / 0 fail
- conformance/run.ts: 1426/1476 + 50 xfail, 0 FAIL
- browser tier (`bun scripts/browser-baseline.ts --check`, the CI gate step): PASS — 48 asserted, 0 of 2 env-excluded observed. Direct `bun test compiler/tests/browser`: 1433 pass / 48 fail (= baseline). NOTE: the FIRST --check run (with the post-commit suite + 3 sibling suites running) refused with "bun reports 50 failure(s), this script parsed 49" — load flake; re-run clean.
- host-global-scan --check: exit 0 — 2527 units x 6 modes, 6236 compiles, 119 threw (pinned by name, check passes), 9501 artifacts, 0 violations
- types-gate --check: OK — 184 diagnostics (117 distinct), unchanged; baseline NOT rewritten
- runtime-size-ratchet: 8 pass / 0 fail
- e2e-render-map 259/0; self-host-v2 slice-m1 99/0 (+ lowered 99/0), m2 462/0, m3 60/0, m4 1229/0, codec 166/0, v2-lexer 337/0; lint-no-default-arm 0
- todomvc compile + node --check OK; snippet-gate 128/128; corpus-compile-floor PASS
- SPEC-INDEX / FACTS / bootstrap-conformance current; conflict-marker PASS; delta-lint PASS; s34-census --check-new PASS
- state.ts --check: gap-counts PASS; recent-sessions (master-list) stale — same on origin/main (a wrap commit cannot list itself), not CI-gated, left untouched.

## Residual SPEC deltas (NOT fixed, per brief)
(a) show= narrowing — CLOSED by F1 (was: reproducers compiled clean on merge head 2bfa69469).
(b) `match` narrowing covers the whole match body — CONFIRMED on 981a873c1 and on origin/main: presence-narrowing.ts `match-stmt` adds the header receiver for the whole body, including the `not` arm. Repro: `<user>: { name: string } | not = not` + `fn label() -> string { match @user { not :> @user.name  else :> "present" } }` -> exit 0, no E-TYPE-046; emitted `if (_scrml_match_3 === null || ...) return _scrml_cs_reactive_get("user").name;` (TypeError at runtime). Pre-existing on main (type-system's old walker had the same rule); round 7 inherited it.

## Merge #2 — origin/main 879b56893 (#1367 runtime meta.emit gate), landed on main during this run
Conflicts (3, all generated): `compiler/SPEC-INDEX.md` (normalized 3-way: zero non-numeric differences), `docs/FACTS.md`, `docs/bootstrap-conformance.md`. Resolution: took ours, regenerated via regen-spec-index.ts (totals 47,384), facts.ts --write, bootstrap-conformance.ts --write. SPEC.md auto-merged clean.
CORRECTION to merge #1: while reverting a local `state.ts --write` of master-list.md mid-merge I ran `git checkout HEAD -- master-list.md`, which also dropped main's own 2-line master-list change from #1366 (2bfa69469 differed from b4b94f3d6 there). D1 never touches master-list, so this merge takes origin/main's master-list verbatim — restored. Verified: every file differing from origin/main after this merge is one D1/F1 changed, or this dispatch's BRIEF.md.
SEMANTIC conflict (no textual conflict): D1's `conformance/cases/meta/emit-single-quote-inside-attr-clean` used `onclick="go('a')"` in `^{ emit(...) }` output as the vehicle for "a `'` inside a `\"…\"` value is content". #1367's §22.4.1 closed attribute list now refuses event-handler attributes in emit() output (E-META-EVAL-002, a ruled main change), so the case failed the corpus bridge. Resolution: fixture-only — vehicle moved to `title="go('a')"` (and the now-unused `go` fn dropped); property under test unchanged; no compiler change. Reject twin `emit-single-quoted-attr-reject` still passes unchanged. Full core gate without --bail on the resolved tree: 33628 pass / 58 skip / 0 fail. bootstrap-conformance regenerated (the case is now parse-reject rather than twin-unsupported in the bootstrap tally).

## Merge #3 — origin/main 02732712a (#1368 gaps, docs-only), landed during this run
Conflict (1): `docs/known-gaps.md` §0 @generated:gap-counts only. First attempt `--theirs` on the whole file DROPPED the F1 resolution of g-impl1-show-narrows-s451 (caught by grep before commit); redone with `git checkout -m` + hunk-only resolution, then `state.ts --write` (LOW 319 -> 318). Verified: known-gaps differs from origin/main only by the F1 entry + the count. master-list.md = origin/main verbatim.
Note: #1368 filed g-match-optional-cell-narrows-not-arm-s460 (= residual (b) above); its locus names type-system.ts matchHeaderCell — on this branch the rule lives in presence-narrowing.ts `match-stmt` (not edited here).
