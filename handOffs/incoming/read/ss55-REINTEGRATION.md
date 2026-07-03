# sPA ss55 → PA · RE-INTEGRATION (self-host-v2 lexer COMPLETE, standing down)

**List:** `spa-lists/ss55-self-host-v2-lexer-completion.md` (self-host-v2 LEXER completion — Road-B impl#2)
**Branch:** `spa/ss55` @ **`4c452e29`** (worktree `../scrml-spa-ss55`) · linear chain on base `1c7526f6`, 4 ahead / 5 behind origin/main (disjoint self-host-v2/ — file-delta re-integration is clean).
**Outcome:** the impl#2 lexer is **TOKEN-CLASS + REFINEMENT COMPLETE** — **337/337 token-diff green vs impl#1** across 7 oracle files.

## Items landed (per-item SHA)
| # | item | SHA | oracle | dogfood |
|---|------|-----|--------|---------|
| 1 | slice-4a precise cooked-decode | `41aef81d` | 49/49 | ZERO NEW; host-support flag RESOLVED (parseInt/fromCodePoint/isNaN) |
| 2 | slice-4b typed BracketStack threading | `fe53bf78` | 53/53 | ZERO NEW |
| 3 | slice-4c ErrorRecovery threading | **PARKED** | — | **PA design ruling needed** (see below) |
| 4 | slice-5a BareVariant `.foo` token | `e700b0d1` | 51/51 | ZERO NEW |
| 5 | slice-5b value-keyword-then-regex | `4c452e29` | 65/65 | **NEW F10** |

Each landing was independently re-verified in the spa/ss55 worktree (not just the agent's report). BRIEFs archived under `docs/changes/self-host-v2-lexer-slice{4a,4b,5a,5b}/BRIEF.md`. Every dev-agent self-provisioned its worktree from the correct spa/ss55 tip (the harness did NOT auto-provision isolation:worktree — the explicit self-provision startup step worked every time; no main leakage on any of the 4).

## Item 3 PARKED — the one open ruling (`handOffs/incoming/ss55-item3-ESCALATION-error-recovery.md`)
impl#1's lexer silently SKIPS stray chars + truncates unterminated scanners at EOF (NO error token), and impl#2's `deferAdvance` already matches that → they're already token-diff green. Item 3's "honest ErrorToken emission" would DIVERGE from impl#1 → the oracle goes red unless its contract changes. Fork: **A** parity (silent-skip, near-no-op) vs **B** fail-closed divergence (impl#2 does it BETTER per the from-scratch-rewrite philosophy + §4 invariant, requiring an oracle-contract amendment). Both a language-posture AND an oracle-contract decision — yours. Items 1/2/4/5 do not depend on it; it re-fires cleanly against tip `4c452e29` once you rule.

## NEW compiler bug — F10 (from item 5; captured in progress.md)
`if (last is .Keyword(kw)) { …kw… }` — a payload-binding `is` pattern in an `if`/boolean CONDITION does NOT compile (`E-SCOPE-001 Undeclared identifier kw` + `E-VARIANT-AMBIGUOUS`). The same binder works as a `match`-ARM pattern but is silently dropped in an `if`-condition. Workaround used: single-arm `match` extraction helper. Cleanly workaroundable — worth a typer/parser follow-up so flow-narrowing `is` tests can bind payloads inline. (Adds to the F1-F9 catalog the wave has been building.)

## Re-integration
File-delta from `spa/ss55` @ `4c452e29`: `compiler/self-host-v2/lex.scrml` · `compiler/self-host-v2/progress.md` · `compiler/tests/integration/self-host-v2-lexer-slice{4a,4b,5a,5b}.test.js` · `docs/changes/self-host-v2-lexer-slice*/`. All disjoint from main — clean. Then confirm 337/337 (`bun test compiler/tests/integration/self-host-v2-lexer-slice*.test.js`) independently.

**Next wave (NOT this list):** the PARSER wave (ss56+) needs your decomposition pass + the F1/emit-library unblock. The lexer stays on the `<program>`-wrap workaround (no F1 needed). Standing ss55 down.
