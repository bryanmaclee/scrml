# R24-Bug-35 — `rewriteIsPredicates` in `preprocessForAcorn` fails on BS-tokenizer space-padded dots

You are dispatched to fix known-gaps Bug 35 (R24-BUG-1 triage finding; MED severity; AST-path completeness gap).

Change-id: `r24-bug-35-rewrite-is-space-padded-dot-2026-05-27`

PA archives this brief to `docs/changes/r24-bug-35-rewrite-is-space-padded-dot-2026-05-27/BRIEF.md` per pa.md S136 addendum.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

## Startup verification (before ANY other tool call)

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any other repo, STOP (S90 CWD-routing).
2. `git rev-parse --show-toplevel` — must equal WORKTREE_ROOT.
3. `git status --short` — clean.
4. `bun install`.
5. `bun run pretest`.

STOP on any failure.

## Startup-merge of main (S112)

```
git -C "$WORKTREE_ROOT" merge main
```

Current main HEAD: `2775170e` (post Bug 42 known-gaps refresh). Includes all R25 HIGH cluster fixes + Bug 42 + SPEC §19.4.1 amendment + pa.md S138 addendum.

## Echo-pwd-in-first-commit (S99 — counter is 20)

First commit message: `WIP(r24-bug-35): start at $(pwd)`.

## Path discipline

**S126: all compiler-source edits via BASH** (perl/python/sed/heredoc), NOT Edit/Write. Echo target path before each write; verify via `git diff`. **NEVER `cd` into the main repo.** Use `git -C "$WORKTREE_ROOT"` + worktree-absolute paths exclusively.

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` in full. This is a **single-file regex tweak** in `compiler/src/expression-parser.ts`. Map routing should point at expression-parser as a Codegen Module.

Map watermark `27e14c66` (S135); main `2775170e` (~38 commits ahead). Post-map landings affecting this dispatch: NONE directly relevant to `rewriteIsPredicates` — the function predates S136. The string-rewrite-fallback pattern at `compiler/src/codegen/rewrite.ts:561-562` is the sibling reference; recently visible in Bug 28's `89008e97` (S136) which extended rewrite.ts but did NOT touch rewriteIsPredicates.

Feedback in final report: "Maps consulted: [list]; load-bearing finding: <one sentence>".

# REQUIRED FIRST READS (canon)

1. `.claude/maps/primary.map.md`
2. **`compiler/src/expression-parser.ts` `rewriteIsPredicates`** — the fix locus. The regex needs `\s*` tolerance between `.` and variant identifier.
3. **`compiler/src/codegen/rewrite.ts:561-562`** — the sibling string-rewrite pass `rewriteIsOperator` which ALREADY tolerates space-padded dot correctly. Mirror its tolerance pattern in `rewriteIsPredicates`.
4. `docs/known-gaps.md` Bug 35 entry (full context).

# THE BUG

## Symptom (direct AST probe)

When the BS tokenizer space-pads dot tokens (e.g., `@x is . All` after tokenization), `rewriteIsPredicates` in `compiler/src/expression-parser.ts:preprocessForAcorn` FAILS to recognize the `is`-predicate. The AST-path silently drops the predicate; codegen falls back to the string-rewrite pass (which works correctly).

**Direct AST probe (the reproducer):**
- `parseExprToNode("@x is . All", "test.scrml", 0)` returns `{kind: "ident"}` (only `@x` parsed; `is . All` lost)
- `parseExprToNode("@x is .All", "test.scrml", 0)` returns `{kind: "binary", op: "is"}` (correctly parsed)

The space-padded form is what BS produces after tokenization; the no-space form is the canonical source form. Both should yield the same AST.

## Why this matters (adopter impact: NONE; compiler completeness only)

Correct emitted JS still appears via the string-rewrite fallback (`rewriteIsOperator` at `rewrite.ts:561-562` handles `\s*` between `.` and variant). The only cost is:
- Compiler-internal performance — extra path switch
- AST-path completeness gap — predicate is lost AST-side, so AST-walking passes (validators, lints, future analyses) can't see it

So this is a compiler-internal completeness fix, not an adopter-facing bug. The R24-BUG-1 dispatch agent surfaced this gap as a deferred item.

## Locus hypothesis (high confidence)

PA HYPOTHESIS: `rewriteIsPredicates` regex in `compiler/src/expression-parser.ts:preprocessForAcorn` needs `\s*` tolerance between `.` and the variant identifier. Mirror the sibling tolerance pattern from `rewriteIsOperator` at `compiler/src/codegen/rewrite.ts:561-562`.

This is one of the few S137 dispatches where the brief hypothesis is likely correct (S137 track record otherwise: 1 correct / 5 wrong-direction). The asymmetric behavior is documented: string-rewrite path has `\s*` tolerance; AST-emit path doesn't. Mirror it. **Verify with the AST probe before writing the fix.**

# WHAT YOU MUST DO

## Phase 0 — diagnose

1. **Run the direct AST probe** in the worktree to confirm the symptom:
   ```js
   import { parseExprToNode } from "./compiler/src/expression-parser.ts";
   console.log(parseExprToNode("@x is . All", "test.scrml", 0));
   // expected: {kind: "ident"} or similar — predicate lost
   console.log(parseExprToNode("@x is .All", "test.scrml", 0));
   // expected: {kind: "binary", op: "is"} — predicate present
   ```

2. **Read** `rewriteIsPredicates` in `compiler/src/expression-parser.ts`. Identify the regex(es) that match `is .Variant`. Find the dot-then-identifier pattern.

3. **Read** the sibling `rewriteIsOperator` in `compiler/src/codegen/rewrite.ts:561-562` (or thereabouts). Confirm the `\s*` tolerance pattern.

4. **Report root-cause in `docs/changes/r24-bug-35-rewrite-is-space-padded-dot-2026-05-27/progress.md`** BEFORE writing fix code. If you find the bug ISN'T where the brief hypothesizes, surface that.

## Phase 1 — fix

Apply the minimal regex tweak in `rewriteIsPredicates`:
- Add `\s*` between `.` and the variant-identifier match
- Compose correctly with the existing tolerance for other tokens in the predicate
- Don't change behavior on the no-space form (regression-guard)

## Phase 2 — regression tests

NEW: `compiler/tests/unit/rewrite-is-predicates-space-padded-r24-bug-35.test.js`. Test sites:

1. **Direct AST probe — no-space form** — `parseExprToNode("@x is .All")` returns binary-op AST (regression-guard)
2. **Direct AST probe — space-padded form** — `parseExprToNode("@x is . All")` returns same shape AST as no-space (THE BUG FIX)
3. **Mixed forms** — `@x is .A and @y is . B` — both predicates recognized
4. **Negation** — `@x is not .All` (with various spacings)
5. **Multiple variants** — `@x is .A or @x is .B`
6. **Inside arrow** — `(c) => c.status is . Active`
7. **Inside if-condition** — `if (@x is . All) { ... }`
8. **Positive control — `is`-predicate with no qualifier** (`@x is`) — still rejected appropriately
9. **Negative control — non-predicate `is`** — e.g., a property `obj.is = 1` (if legal) NOT misclassified

Aim for 8-12 tests.

## Phase 3 — verify

1. The direct AST probe MUST show identical AST for `@x is .All` and `@x is . All`.
2. Full suite: `bun run test` must pass. Baseline at HEAD `2775170e`: 14,907 pass / 0 fail / 88 skip / 1 todo (subset). Full suite ~21,914.
3. **No empirical R26 verification mandatory** — this is a compiler-internal completeness fix, not a codegen path that affects adopter-visible output. The adopter-visible behavior was already correct via the string-rewrite fallback. (Per S138 R26 doctrine: applies to HIGH-severity codegen fixes; Bug 35 is MED + compiler-internal.) But DO run a quick check: compile R24's `dev-1-react.scrml` filter callback shape before vs after — emitted JS shouldn't change (the string-rewrite fallback path becomes unnecessary but produces the same output).

# COMMIT DISCIPLINE (S83 + S113)

Coupled code + test = ONE commit per S113. WIP commits OK for crash-recovery.

# `--no-verify` PROHIBITION (S136 absolute)

NEVER. Pretest race → STOP, wait, retry, STOP-and-report. Session precedent: 6 of 7 dispatches clean (only Bug 37 had self-corrected violation).

# REPORTING

1. WORKTREE_PATH (literal `pwd`)
2. BRANCH
3. FINAL_SHA
4. FILES_TOUCHED
5. TEST_DELTA
6. ROOT-CAUSE FINDING (1-2 paragraphs — was the brief hypothesis correct?)
7. REPRODUCER VERIFICATION (the direct AST probe — BEFORE/AFTER)
8. MAPS CONSULTED + load-bearing finding
9. DEFERRED ITEMS
10. PROCESS VIOLATIONS

# OUT OF SCOPE

- All other MED bugs (30/31/32/44) — separate dispatches
- Bug 28/29/36/37/38/39/40/41/42/49 — RESOLVED this session, don't touch their files
- SPEC changes — compiler source only
- Any refactor beyond what fix requires

# IF YOU GET STUCK

After 60-90 min (this is a small fix, you should be done in 30-60 min): STOP, report partial. WIP commit each step. Append progress.md.

GO.
