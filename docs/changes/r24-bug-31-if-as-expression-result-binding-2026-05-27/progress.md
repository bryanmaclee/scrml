# Progress — R24-Bug-31 (R24-BUG-5)

Started: 2026-05-28T08:11:44-06:00
Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a5fdeccd60645fcc1

## $(date -Iseconds) — DONE

ROOT CAUSE — JS ASI not respected for `return` keyword. `collectExpr`'s
BUG-ASI-NEWLINE guard is gated on `parts.length > 0`; the first
expression token after `return` is consumed unconditionally even when
it sits on a later source line.

FIX — ast-builder.js: span-line ASI check added at BOTH `return`
handlers (parseOneStatement L5491 + parseLogicBody main loop L9255).
When `next.span.line > startTok.span.line`, emit bare return — mirrors
ECMA-262 §12.9 restricted-production behavior.

TOKEN-SHAPE NOTE — discovered during debug that tokens here use
`.span.line` (not flat `.line`). Pre-existing `break label`/`continue
label` checks at L5455/L5474/L9221/L9239 use `.line` directly — likely
dormant but out of scope (no test exercises labeled-loop syntax).

TEST FILE — `compiler/tests/unit/r24-bug-31-if-as-expression-result-
binding.test.js` (12 tests covering minimal repro, const/let bindings,
collapsed arms, multi-stmt before failable, multi early-returns,
braced early-returns, same-line return regression-guard, ternary
negative control, empirical R24 dev-1-react shape).

EMPIRICAL R26 — dev-1-react: `_result = if` count 1 → 0; node --check
on Bug 31 site PASSES (separate pre-existing line-438 `${@.status}`
bug remains, unrelated).

FULL SUITE — 15054 (baseline) → 15066 (+12 new) / 0 fail / 88 skip /
1 todo.

COMMIT — `af989ede` (coupled code + test per S113).

