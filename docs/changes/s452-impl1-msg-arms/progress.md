# progress — s452-impl1-msg-arms (append-only)

## 1. Startup
- WT=/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2aa63c96bb28d7ad, base 892d68735 == origin/main. Branch fix/s452-impl1-msg-arms.
- bun install + pretest OK.

## 2. Governing SPEC sentences (read in full: §19.4.5, §51.0.S)
- §51.0.S.2.3: "A message arm IS a §18.2 `match-arm` — the same production a `match` and a `!{}` handler use (§19.4.5), with no leading `|`"
- §51.0.S.2.3: "The message arms are the leading items of the state-child body (before any render content), one per line; at that position a line whose first token is an arm pattern is an arm head (§7.2.2 "arm heads" — by position, not by a `:>` lookahead)."
- §51.0.S.2.3: "The pre-S452 `|`-led spelling (`| .Variant(binding) :> body`) is SOFT-DEPRECATED under §19.4.5's rule — it parses identically and surfaces `W-ARM-PIPE-LEGACY`"
- §51.0.S.2.3: E-ENGINE-MSG-ARM-POSITION — "(Nominal / not yet emitted.)" — OUT OF SCOPE per brief.
- §19.4.5: "During the window, a `!{}` arm or a message arm led by `|` SHALL be the same arm as the arm without the `|` — the same AST, emitted code and run-time behaviour"
- §19.4.5: "The paren-free binder is part of the legacy `!{}` arm only ... It was never a message-arm form and is not one now."
- §19.4.5: "On one line, a `|` that begins a legacy arm also ends the arm before it."

## 3. Map
- primary.map.md: load-bearing — `parseMessageArms`' `skipTrivia` is the documented out-of-class site; stays on bare `skipCommentOrString` ("do not fix it for symmetry"). Honored.

## 4. Reproduction (base 892d68735)
- examples/25 with the five `|`s deleted: exit 0, same warnings; client.js loses `_dragPhase_msg_arms`, state render fns return the arm source as literal text, dispatch_message -> engine_advance. Confirmed.

## 5. Locus
- `compiler/src/engine-statechild-parser.ts` `parseMessageArms` (:2102) — `if (bodyRaw[pos] !== "|") return no arms`. Confirmed load-bearing. Same function feeds the live state-child parser (:2696), the native walker (`native-walker/engine-statechild-walker.ts:544`, path in brief was missing `native-walker/`), and emit-engine's render-body strip (`codegen/emit-engine.ts:2475`).

## 6. Design note — tension
- SPEC says arm heads are recognized "by position, not by a `:>` lookahead". Brief requires the strict head + IMMEDIATE arrow. Following the brief (no diagnostic is in scope; without the arrow a line is not an arm and stays render content — today's behaviour). The position-only reading needs E-ENGINE-MSG-ARM-POSITION/malformed-arm diagnostics to be safe; deferred with them.

## 7. Second locus found by test (not in brief)
- A pipe-less `::V(x) :>` as the FIRST line of a state-child body was eaten by the state-child legacy after-`>` `:`-shorthand regex (`engine-statechild-parser.ts` `/^\s*:\s*/`), firing W-COLON-SHORTHAND-LEGACY-PLACEMENT and emitting `_scrml_render_value(el, :Start(id) :> …)` (broken JS). Fixed with `(?!:)`, mirroring the block splitter's existing `::` guard (`tryConsumeAfterCloseColonShorthand`). The onTransition copy of the regex (:1003) left alone (not an arm locus).

## 8. Results
- Code+tests commit 878a0287c (pre-commit gate: 30123 pass / 58 skip / 12 todo / 0 fail).
- examples/25 pipe-less vs piped, same path: artifacts byte-identical, logs identical except timing line.
- Corpus differential (scripts/corpus-emit-differential.ts, roots examples,samples,conformance,stdlib,benchmarks): 2327 sources / 11353 artifacts; 0 artifact diffs, 0 compile-failure delta, 0 diag-code changes; the 1418 "text-only" diag changes are the work-dir path in the CLI stdout (base vs head dir) — normalised, 2327/2327 identical.
- Tests: unit (31), integration (6, byte-identical client/server/html/css + diagnostics), browser (2, real click on compiled `.advance` call sites).
- known-gaps: g-impl1-engine-message-arm-pipeless-as-text-s452 status=resolved; gap-counts regenerated (HIGH 241→240); master-list.md regen reverted (PA-owned).

## 9. Deferred / not in scope
- `| ::V :>` and `| else :>` (piped) still do not parse as arms (legacy path kept byte-for-byte); pipe-less accepts them. §19.4.5 "parses identically" says they should match.
- Alternation `.A | .B :>` and a pipe-less arm after a block body on the same line remain render text silently — E-ENGINE-MSG-ARM-POSITION / malformed-arm diagnostics (Nominal) are the closure.
- W-ARM-PIPE-LEGACY not emitted (Nominal).
- types:check baseline is stale on main (29 NEW / 9 gone, none in engine-statechild-parser.ts) — pre-existing.
