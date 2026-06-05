# scrmlTS — Session 163 (CLOSE)

**Date:** 2026-06-04
**Previous:** `handOffs/hand-off-167.md` (= S162 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-168.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"; default A). Full session-start completed.

---

## 🏁 S163 CLOSE — F1 engine arm-body OPENED: §51.0 engine-substrate SILENT-MISCOMPILE found + FIXED (the dominant native-swap miscompile, CLOSED) + B1 reset-expr + §4.18 ruling · WRAP + PUSH

F1 (the native-parser-swap dominant family) opened via two survey-STOPs that REFRAMED it twice. **(1)** B1 native `reset`→`reset-expr` landed. **(2)** §4.18 ruling banked (native canonical enforcer, live lenient). **(3)** The headline: native silently DROPPED the entire §51.0 engine substrate across ALL engine files (compiles clean, emits engine as a dumb reactive cell) — root-caused to a `machineDecls` **two-instance object-identity defect**, fixed in ~40 lines. All swept engine sub-features (basic/hierarchy/onTimeout/onIdle/history/effects) now emit BYTE-IDENTICAL native==default. **NEXT-SESSION OPENER: flip re-measure (quantify the ~790 drop), then B2 (§51.0.S message-arm) / PowerUp-enum bug / effect= opener.**

### Sync / repo state at CLOSE
- **scrmlTS:** **8 PA commits this session** + the wrap commit. PUSHED this wrap → origin (authorized). Branch-coherence held every commit (0/N, N==PA-authored).
  - `452a212b` session-start (rotate hand-off-167 + fresh) · `c3303adc` maps refresh → 452a212b (S162 native arc + F1 orientation) · `dace3f5b` F1 survey-STOP findings · `6ad8ca13` **B1 reset→reset-expr** · `e6782917` F1 REFRAME finding (engine-substrate drop) · `c9a458f9` engine-substrate root-cause survey + fix brief · `a41df176` **engine-substrate instance-share fix** · `8600c936` within-node rebump (7 benign SPAN-COORD residuals).
- **scrml-support:** S163 user-voice append (§4.18 ruling + session-flow) — committed + pushed this wrap.
- **Tests at close:** full `bun run test` **22,998 pass / 0 fail / 220 skip / 1 todo / 907 files** (23,219 ran; +12 from S162's 22,986 = +7 B1 translate-expr-bridge + +5 native-engine-substrate-instance-share). Within-node parity 1005/0 (NET-IMPROVED: allowlist tolerance −2883 vs S162 net; 1001 keys unchanged). **NB:** the full suite first ran 7-FAIL — all 7 were the within-node parity test (excluded from the pre-commit subset) going SPAN-COORD-over-budget on 7 fixtures from the B1+engine-substrate span shifts; PA residual-preserving rebump `8600c936` (SPAN-COORD allow→raw, benign class) → 0 fail. Pre-push gate confirmed.
- **Worktrees:** main only (B1 `agent-a25fe207...` + engine-substrate `agent-aaf3e8fbe1...` both file-delta-landed + cleaned at wrap). **Inbox:** EMPTY at open + close.
- **Version:** on top of **v0.7.0** (pkg.json unchanged; no tag — parity-closer + bug-fix work).
- **Maps:** STALE again — refreshed to `c3303adc` mid-session (the S162 arc), but HEAD moved to `a41df176` (B1 + engine-substrate landings past the watermark). **The maps' "F1 = arm-body E-UNQUOTED-DISPLAY-TEXT" framing is INACCURATE** (the true dominant cause was the `machineDecls` two-instance identity defect — see SURVEY). Refresh + correct the F1 framing next session.
- **Hooks:** config B. Both fix agents (B1 + engine-substrate) briefly used `--no-verify` on a docs commit, self-reverted, re-committed through the gate — the prohibition HELD both times (recurring agent reflex; brief reinforces it). Pre-push gate ran clean.

### F1 RESOLUTION — what landed + what the surveys found
**The hand-off (S162) framed F1 as "engine arm-body parse, ~168, spurious E-UNQUOTED + DROPS engine." Two survey-STOPs reframed it twice:**

1. **Survey #1 (`dace3f5b`)** said "F1 narrow — 24/35 engine files compile clean → 2 ruling + 2 bugs + 7 mis-attributed." **That was the S139 trap at the survey level** — it measured fatal-error-absence, not output. (See FINDING below.)
2. **B1 (`6ad8ca13`) — native `reset(@cell)` → `reset-expr`.** Native emitted `reset` as a plain CallExpr → spurious E-SCOPE-001 + (latent) broken codegen. Fix: `translate-expr.js` intercepts bare-`reset`-callee → builds the live `reset-expr` node (3 §6.8.2 shapes; 0-arg target is a §42 `not` literal). NOT the allowlist shortcut (S139 trap). R26: native emits `_scrml_reset("coins")` byte-identical to default. +7 tests. (Survey-corrected: `25-triage-board` is `examples/` not `samples/` and has NO `reset`; `cleanup`/`upload` are statement-layer, native handles clean.)
3. **§4.18 ruling (banked, user-voice S163):** native = canonical §4.18.7 enforcer; LIVE stays lenient (unwired; doomed at M6); corpus bare-text→`"..."` migration = deferred swap-prep backlog. F8-precedent continuation.
4. **F1 REFRAME (`e6782917`, `FINDING-engine-substrate-drop.md`):** PA byte-compare during B1 R26 found native **silently drops the entire §51.0 engine substrate** (transition table, `_scrml_engine_direct_set` rule-validation, var-init, mount/body-render) across ALL engine files — emits engine as a dumb `_scrml_reactive_set` cell. The "clean" 24 files silently miscompile. **The ~168 is largely REAL** (the flip-test's runtime assertions catch the silent drop). B1 merely UNMASKED it on mario (S138 sibling-fix-unmask).
5. **Engine-substrate root cause + fix (`a41df176`):** survey #2 (`SURVEY.md`) root-caused it to a **two-instance object-identity defect** — native synthesized TWO `engine-decl` objects (nodes copy via `parse-file.js synthEngineNode`; a SEPARATE machineDecls copy via `collect-hoisted.js synthEngineDecl`). SYM stamps `_record`/`engineMeta` on the nodes copy ONLY; codegen `collectC12EngineDecls` reads `machineDecls`-FIRST → un-stamped → `isC12EngineDecl` false → substrate dropped. Live shares ONE instance (`ast-builder.js:13616 machineDecls.push(node)`). `<match>` was fine (`collectMatchBlocks` walks nodes-only). **Fix (S, ~40L):** native derives `machineDecls` from the mapped `nodes` instances (`collectMachineDeclsFromNodes`); `collect-hoisted.js` no longer synthesizes engines; `bodyChildren` mapped to AST nodes so nested engines are structural + reachable. **PA-independent R26:** engine-modern-001 (7/7 `_scrml_engine_`, 4/4 transitions, 3/3 direct_set) + engine-009 nested (30/30) BYTE-IDENTICAL native==default; all 6 swept files recover. mario's marioState substrate recovers (3 transitions present); its residual is the SEPARATE PowerUp bug.

### Briefs archived (S136): `docs/changes/native-reset-builtin-b1-2026-06-04/` · `native-engine-arm-body-f1-survey-2026-06-04/` (BRIEF + SURVEY + FINDING-engine-substrate-drop) · `native-engine-substrate-bridge-survey-2026-06-04/` (BRIEF + SURVEY) · `native-engine-machinedecls-instance-share-2026-06-04/` (BRIEF + progress).

---

## OPEN QUESTIONS / DESIGN CALLS
1. **Phase-A default-flip is a STANDING USER DECISION** (STOPped+reverted once at `404fc619`). PA dispatches PARITY-CLOSERS feeding the eventual user-authorized flip — never "the flip" itself.
2. **v0.7 → v0.8 placement** — the swap is a v0.8 target. The S163 engine-substrate fix is a big chunk of the ~790; re-measure to re-baseline.
3. **M6.5 emit-logic path-(a) shims vs path-(b)** — needs ratification BEFORE that dispatch. Not on the current critical path.

## CARRY-FORWARD (F1 follow-ups + backlog)
- **NEXT-SESSION OPENER: flip re-measure** — `compiler/src/api.js:630` `parser = null` → `parser = "scrml-native"` in a throwaway `git worktree`, `bun install && bun run pretest && bun test compiler/tests/`. Control = 0 fail. The engine-substrate fix should drop the ~790 STEEPLY (engines were a big chunk). Re-baselines the swap-grind + v0.8 placement.
- **B2 (§51.0.S accepts message-arm parser, L-subset of engines)** — native `synthEngineDecl` has ZERO `accepts=` handling (acceptsType undefined vs live null); `native-walker/engine-statechild-walker.ts:516` hard-codes `messageArms: []`. Separate dispatch (native accepts-attr read + arm recognition). Affects `engine-message-dispatch-s6.scrml`.
- **`effect=` opener (§51.0.H Form 3 openerEffect)** — native `synthEngineDecl` has no openerEffect read. Small separate gap.
- **NEW — mario PowerUp enum-with-constructor-params truncation under native** — native captures only `["Mushroom"]` (drops Flower/Feather), mis-emits `PowerUp.Flower(3)` as `"Flower"(3)`, match-arm positional-bind fails. SEPARATE from engine-substrate (a payload-bearing-enum native gap). The mario residual (133 diff-lines). Triage + scope next session.
- **B1 deferred:** malformed-reset diagnostic surfacing under native (native produces the reset-expr with the E-RESET-NO-ARG diagnostic field but doesn't run the ast-builder surfacer; no parity REGRESSION — native==default behavior).
- **§4.18 corpus migration** (bare display text → `"..."` literals, engine/match arms + `:`-shorthand) — deferred swap-prep backlog per the S163 ruling.
- **Maps:** refresh to HEAD + CORRECT the "F1 = arm-body E-UNQUOTED" framing (true dominant cause = machineDecls two-instance identity; recorded in no map yet — survey flagged).
- **Per-feature engine parity** — the S163 sweep verified basic/hierarchy/onTimeout/onIdle/history/effects recover byte-identical. derived engines + the deeper sub-features still want their own positive flip-tests before claiming full parity.
- **Bug backlog (MED 9):** Bug 1 Tailwind · V-kill READ-side · MCP V0 deferrals · Generator policy · L19 multi-statement-handler · A5 freeze-extension · R28-1d (NOT-REPRODUCED) · C6 · Bug 14 MCP-partial.
- **LOW backlog** (incl. the S162 `.scrml`-mirror feature-staleness, native is-pattern-arm, native if-as-expr; + `is given`/`is not given` predicate-drift 22 occ/6 files).
- **S154 carry:** body-split/CPS debt (Ext 2/3) · per= per-instance engines (DD) · self-tree-shaking compiler build-story DD-candidate · self-demo scrml.dev F1/F2 debate · 6NZ caps stray.

## pa.md directives in force
- Rules R1–R5. `---` delimiter (S152). Profile A/B (S156). `full wrap`/88% floor (S139). Largest-ratified-target / autonomous / park-on-input / surface-on-real-failure-or-design-ruling.
- Dispatch discipline ALL held: S88 isolation (both fixes) · F4 startup-verify · S112 merge-startup · S99/S126 Bash-edit + no-`cd` (S100 hook active) · S136 BRIEF.md (all dispatches) · S138 R26/dual-verify (PA-independent EVERY landing) · S147 branch-leak coherence (every commit, 0/N held). `--no-verify` forbidden (held — agents self-reverted 2× on docs).
- **CWD discipline (S159/S90):** `cd <main>` / `pwd` checks before every worktree dispatch + main-side write; no slips.
- **Survey-STOP gate (S158):** the user's chosen pattern — twice prevented over-commit (reframed F1; shrank the L-arc to S).
- **Methodology bank (S163):** native-parser-swap parity surveys MUST byte-compare native-vs-default EMIT, not check fatal-error-absence (the S139 trap at survey level — survey #1 fell for it).
- Canonical dev-agent `scrml-js-codegen-engineer` (both fixes). Reconnaissance/triage + surveys via `general-purpose` (read-only). project-mapper (non-isolated) for the maps refresh — crashed post-write (work intact, watermarks bumped); PA verified + committed with explicit `.claude/maps/` pathspec.

## Tags
#session-163 #profile-a-full-start #F1-opened #engine-substrate-silent-miscompile-CLOSED #machineDecls-two-instance-identity #B1-reset-expr #4.18-ruling-live-lenient #F1-reframed-twice #survey-stop-gate #s139-trap-at-survey-level #wrap #pushed #high-0
