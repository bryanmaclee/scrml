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
