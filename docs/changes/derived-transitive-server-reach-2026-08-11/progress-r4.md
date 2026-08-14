# derived-transitive fix round 4 — progress (append-only)

Branch `dtr-r4`, cut from round-3 tip `896fc7f0`. Worktree:
`/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a1355790b79bc4af0`.

Work order: 14 confirmed findings (7 blockers), scratchpad `dtr-r4/WORK-ORDER.json`.

## 2026-08-14 ~08:35 — startup + full work-order read

- Startup verification passed (pwd == toplevel, clean tree, bun install, pretest).
- All 14 findings + 5 lens notes read in full (split to per-finding files in scratchpad).
- Ruling stamp verified against user-voice-scrml.md: **S345** ("c, your rec" — descriptive,
  not a ratification; lexical scoping queued as conformance-restoration).
- S345 Q2 also QUARANTINES the "over-fire masks the miscompile" sequencing claim as
  falsified — the notes-spectext draft annotation's sequencing-bound sentence is DROPPED.

## Plan (constraint-mapped)

Semantics decision (constraint 2, fail-closed): TRANSITIVE machinery only —
- hop-caller shadow set (route-inference.ts:4038): drop the scope-blind
  `collectLocalNames(body)` subtraction; KEEP the caller's own params (a function's
  params provably scope over its whole body — the one cheap provably-scope-correct case).
- limb (b) derived-RHS scan (5784): NO shadow subtraction at all (`shadow: "none"`).
- limb (a) direct/confidentiality limb: UNCHANGED (finding-03 pre-existing leak is
  REPORT-ONLY per constraint 5; and for limb (a), codegen honours the local shadow in
  emitted JS, so RI-suppress + codegen agree there — the per-limb coherence story).
- lambda-param body-style unification (finding-07, constraint 4): scrml-node walk counts
  lambda/function-decl PARAM names as references, gated to the diagnostic call sites
  (both limbs + hop-edge scan); Trigger-3 per-function site keeps default (placement
  must not move).
- codegen/RI agreement (constraint 3): for the transitive limb both are now scope-blind
  in the FIRING direction (codegen renames every reference; RI fires on every
  reference), so every shape codegen would miscompile is refused at compile time.
  Executed-artifact assertions added to conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js.

Fix list:
- F0/F1 (blockers): shadow-set changes above + pins (p4 if-sibling, while-shadow,
  p12 match-arm sibling, tilde variant).
- F2 (blocker): correct false "already refused via 5b" comment (route-inference.ts
  3999-4010); alias forms p9/p10/p11 pinned as DOCUMENTED RESIDUAL + SPEC residual
  entry. Closing the alias/function-valued-binding hop class = deferred (new hop-node
  mechanism, own direction-of-change; work order's own "minimum fix scope").
- F4/F8: SPEC 3726/3737 carve-outs (raw-text limb asymmetry; unparseable-RHS decline
  residual recorded with TRUE end-to-end behavior — netted by emit gate at exit 1 with
  generic E-CODEGEN-INVALID-LOGIC).
- F5: SPEC 3791 "calls" -> "reaches".
- F6 (blocker, HIGH): closed by limb-(b) no-suppression (RHS-local shadow now refused
  => codegen's scope-blind rename can no longer bind a stub into a derived recompute
  at exit 0). Pins + artifact assertions.
- F7: closed by param unification (fires in both body styles).
- F9 (Q1 c): S345 provenance annotation under 3725 + wording softens at 3725/19564.
- F10: §12.2:7393 language-wide SHALL restored to ruled scope.
- F11: 3739/3740 merged into one bullet.
- F12: weak-witness population figures re-measured at head and restated (both sites).
- F13: describeReachTerminus wording + §11c pin update (coupled).
- F3: REPORT-ONLY (restated in final report; not fixed; known-gaps.md untouched).

Then: full-corpus direction-of-change differential (r3-tip vs r4-head, arc's own
unfiltered method), counts + file lists reported, SPEC direction-of-change figures
updated last. Gates: 94+new pins green, unit+integration+conformance 0 fail.

## 2026-08-14 ~09:00 — code + pins + artifact assertions landed

- d18efc23: route-inference round-4 semantics + coupled pin updates (106 pass in-file).
- 070bfff4: FACTS/SPEC-INDEX regen (pre-push currency gate); branch pushed to origin.
- 7cce22ec: conf-artifacts §6 executed-artifact assertions (19 pass in-file).
- All shadow shapes refuse end-to-end; the purely-client control emits a sync
  recompute and passes `node --check`.

## 2026-08-14 ~09:35 — direction-of-change differential (constraint 2), MEASURED

Method: the arc's own unfiltered instrument — ALL 2362 git-tracked `.scrml`
sources, each compiled by BOTH compilers (r3 tip 896fc7f0 via `git archive`
extract; r4 = this worktree), per-file exit code + E-DERIVED-SERVER-ONLY-REACH
emission collected, then diffed. Runner + raw JSON in scratchpad
`dtr-r4/{differential.ts,full-out.json}`.

```
total 2362 / measured 2362
emit set r3 == emit set r4 (IDENTICAL, 5 files — all this rule's own):
  conformance/cases/derived/e-derived-server-only-reach-lambda-hop/case.scrml
  conformance/cases/derived/e-derived-server-only-reach-nested-loop/case.scrml
  conformance/cases/derived/e-derived-server-only-reach-pos/case.scrml
  conformance/cases/derived/e-derived-server-only-reach-transitive/case.scrml
  docs/changes/s331-derived-rhs-server-only-escalation/reproducer.scrml
newlyRejecting: 0        newlyAccepting: 0
exitChanged: 1 — stdlib/mcp/index.scrml (HARNESS ARTIFACT, reproduced +
  root-caused: STDLIB_ROOT is compiler-location-derived
  (module-resolver.js:712), so the ARCHIVED r3 compiler does not classify the
  worktree's stdlib file under its §13.1 async carve-out and fires
  E-ASYNC-NOT-IN-SCRML ×2; the in-tree r4 compiler exempts it. Not a round-4
  compiler delta — the r4 compiler run from an archive would show the mirror
  behaviour.)
```

Positive control (instrument liveness for the round-4 DELTA specifically): the
p4 if-sibling blocker reproducer compiles at exit 0 / 0 emissions on the r3
compiler and 1 emission on the r4 compiler through the same harness.

VERDICT: round-4 newly-rejecting migration = ZERO files; nothing to migrate,
nothing self-ratified past. Weak-witness caveat re-measured at head
(78/41/25 of 2362; 3 of each are the rule's own cases) and restated in SPEC.

## 2026-08-14 ~09:45 — SPEC repairs (constraint 4 + Q1(c) annotation)

- 3700/3702: direction-of-change + weak-witness figures re-measured, population
  self-consistency fixed (finding-12).
- 3724: shadow bullet scoped to the DIRECT limb (+ codegen-agreement rationale).
- 3725: lambda-param bullet softened (descriptive framing, body-style
  unification noted, "ruled S345: queued") + S345 provenance annotation
  inserted beneath (Q1(c)); the draft's "over-fire masks the miscompile"
  sequencing sentence DROPPED — S345 Q2 quarantined that claim as falsified.
- string-literal SHALL: direct-limb raw-text carve-out recorded (finding-04).
- 3737 "same rules" SHALL replaced with the one-reference-predicate +
  two-limb-scoped-axes statement (raw text; shadowing) (findings-04/-01/-06).
- F4 CONSEQUENCE bullet updated to the ruled-queued stance.
- 3739/3740 merged; residual list now FOUR entries incl. unparseable-RHS
  decline w/ TRUE end-to-end behaviour (finding-08/-11) and function-valued
  bindings (finding-02).
- Worked example 3791 "calls" -> "reaches" (finding-05).
- §12.2 Trigger-3 note: language-wide SHALL restored to guidance register,
  ruled scope named, dangling self-reference fixed (finding-10).
- §34 row + §6.6 summary row mirrored.
- route-inference.ts describeReachTerminus wording + §11c pin (finding-13).
