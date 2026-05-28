# R24-Bug-31 — `if`-statement-as-expression in `!{}` result binding produces invalid JS (R24-BUG-5)

You are dispatched to fix known-gaps Bug 31 (R24 finding, filed as R24-BUG-5; MED severity; narrow but adopter-encounterable on dev-1-react's load pattern).

Change-id: `r24-bug-31-if-as-expression-result-binding-2026-05-27`

PA archives this brief to `docs/changes/r24-bug-31-if-as-expression-result-binding-2026-05-27/BRIEF.md` per pa.md S136 addendum.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

## Startup verification (before ANY other tool call)

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. STOP if otherwise.
2. `git rev-parse --show-toplevel` — must equal WORKTREE_ROOT.
3. `git status --short` — clean.
4. `bun install`.
5. `bun run pretest`.

STOP on any failure.

## Startup-merge of main (S112)

```
git -C "$WORKTREE_ROOT" merge main
```

Current main HEAD: `f81d6a56` (post Bug 44 RESOLVED). Includes all R25 HIGH cluster fixes + Bug 38 codegen `emit-logic.ts` extension (`933d1ad3`) + Bug 49 tokenizer fix (`076d53e5`) + Bug 30 + Bug 44 lint pass + SPEC §19.4.1 + pa.md S138 + S139.

**Critical: emit-logic.ts has been modified multiple times this session.** Read the Bug 38 diff (`933d1ad3`) before changing — your Bug 31 fix is in adjacent territory but addresses a DIFFERENT concern (Bug 38 = arm-body emission; Bug 31 = result-binding SCOPE around the failable call):

```
git -C "$WORKTREE_ROOT" log --stat 933d1ad3 -- compiler/src/codegen/emit-logic.ts
git -C "$WORKTREE_ROOT" show 933d1ad3 -- compiler/src/codegen/emit-logic.ts | head -150
```

## Echo-pwd-in-first-commit (S99 — counter is 20)

First commit: `WIP(r24-bug-31): start at $(pwd)`.

## Path discipline

**S126: all compiler-source edits via BASH** (perl/python/sed/heredoc), NOT Edit/Write. Echo target path before each write; verify via `git diff`. **NEVER `cd` into the main repo.** Use `git -C "$WORKTREE_ROOT"` + worktree-absolute paths exclusively.

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` in full. This is a **codegen single-file fix** (likely `emit-logic.ts` or a sibling codegen file handling failable-call lowering).

Map watermark `27e14c66` (S135); main `f81d6a56` (~46 commits ahead). Post-map landings in codegen territory:
- Bug 38 `933d1ad3` modified `emit-logic.ts` `emitArmAssign` (case `"guarded-expr"`) — your Bug 31 fix may compose with this; don't break it
- Bug 42 `480aded4` modified `emit-logic.ts` + `emit-control-flow.ts` (yield-stmt + boundary threading) — read its diff too

Feedback in final report: "Maps consulted: [list]; load-bearing finding: <one sentence>".

# REQUIRED FIRST READS (canon)

1. `.claude/maps/primary.map.md`
2. `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md`
3. `docs/articles/llm-kickstarter-v2-2026-05-04.md` (canonical scrml shape)
4. **SPEC §19.4** — failable function + handler contract
5. **SPEC §17** — control flow (the early-return `if` is § 17 + the failable handler is §19 — composition between them is the surface)
6. **`compiler/src/codegen/emit-logic.ts`** — the fix locus. Read post-Bug-38-and-42 state. The `_result` binding emission is the load-bearing site.
7. `docs/known-gaps.md` Bug 31 entry — full context

# THE BUG

## Symptom (R24 dev-1-react surfaced)

A function body containing `if (cond) return` immediately followed by a `failableCall() !{...}` causes codegen to bind the entire sequence as:

```js
let _result = if (cond) { return fn(); }
```

— an `if` statement in expression position, which is a JS `SyntaxError`. Narrow but adopter-encounterable.

dev-1-react's reproducer (R24):

```scrml
function load() {
    if (!@searchTerm) return
    const r = fetchItems() !{ | .Network msg -> { ... } }
}
```

The `if (!@searchTerm) return` is the early-return guard; `const r = fetchItems() !{...}` is the failable call with handler. The codegen wraps both into `let _result = if (cond) { return ...; }` which is invalid JS.

## Expected behavior

The early-return `if` is a SEPARATE statement; the `_result` binding scope begins AFTER it. Emitted JS should look like:

```js
function _scrml_load_N() {
    if (!_scrml_reactive_get("searchTerm")) return;
    let _result = _scrml_fetch_fetchItems(...);
    if (_result && _result.__scrml_error) { ... }
}
```

## Locus hypothesis

PA HYPOTHESIS: the failable-call lowering pass treats the LAST statement preceding the failable call as part of the `_result` binding initializer. The early-return `if` happens to be a STATEMENT (not an expression), so binding it as an initializer produces the SyntaxError. Fix: result-binding scope semantics — the binding should begin AT the failable call, NOT earlier.

**Alternative hypotheses:**
- The fix may be in body-split / CPS planning (Bug 38 + Bug 49 territory, but a DIFFERENT concern — those handled the arm body emission AND the BS-level upstream gap). Bug 31 is about the SCOPE of the result variable, not arm body content.
- The fix may be upstream of codegen — possibly in a body-splitting pass that incorrectly groups the early-return with the failable call.

**S137 brief-hypothesis-vs-grep track record: 3 correct (Bug 35 + Bug 30 + Bug 44) / 7 wrong-direction.** Trust grep + reproducer + trace; the correct dispatches share "lint/regex narrowing with concrete SPEC anchor + bounded surface." Bug 31 is codegen + scope semantics — more complex surface. Hypothesis confidence is MODERATE.

**Investigation order:**
1. Construct minimal reproducer (below); compile; confirm emitted JS contains `let _result = if (...) { return ...; }`.
2. Grep `_result` and the binding-emission site in `emit-logic.ts`. Trace from the failable-call lowering back upstream.
3. Compare to a function that has NO early-return: `function load() { const r = fetchItems() !{...} }` — should emit clean.
4. Compare to a function with an early-return BETWEEN statements (not just before the failable call): `function load() { if (x) return; @a = 1; const r = fetchItems() !{...} }` — does the bug fire? Or only on the immediate-pre-failable case?
5. Report root-cause in `docs/changes/r24-bug-31-if-as-expression-result-binding-2026-05-27/progress.md` BEFORE writing fix code.

# WHAT YOU MUST DO

## Phase 0 — diagnose

1. Build minimal reproducer (use real canonical scrml shape per PRIMER + kickstarter):
   ```scrml
   <program title="repro">

       <state>
           <searchTerm> = ""
       </state>

       <page>
           <button onclick=load()>Load</button>
       </page>

       type LoadError:enum = { Network(msg: string), Empty }

       server function fetchItems() ! LoadError {
           fail LoadError::Empty
       }

       function load() {
           if (!@searchTerm) return
           const r = fetchItems() !{
               | ::Network msg -> { @searchTerm = msg }
               | ::Empty       -> { @searchTerm = "empty" }
           }
       }

   </program>
   ```
2. Compile + inspect emitted client.js. Confirm `_result` binding includes `if (...) { return ... }`.
3. Run `node --check` on the emitted client.js; confirm SyntaxError.
4. Trace where this happens in codegen. Report finding in `progress.md`.

## Phase 1 — fix

Apply the minimal fix that makes the early-return `if` emit as a separate STATEMENT, with the `_result` binding scope beginning AFTER it. Compose with:
- Bug 38 `emitArmAssign` extensions — arm body emission stays correct
- Bug 49 BS-level `tokenizeLogic` synthetic-error-effect-block recognition — upstream gap still closed
- Bug 42 yield-stmt + boundary threading — server function* / generator emission unchanged
- The non-early-return case (`function load() { const r = call() !{...} }`) — must STILL work; regression-guard
- Multi-statement-before-failable case (`function load() { if (x) return; @a = 1; const r = call() !{...} }`) — must work too

## Phase 2 — regression tests

NEW: `compiler/tests/unit/r24-bug-31-if-as-expression-result-binding.test.js`. Required test sites:

1. **Minimal repro** — `if (!@x) return; const r = fetchItems() !{...}` — emitted JS parses clean; early-return emits as separate statement; `_result` binding scope begins at failable call
2. **No early-return regression-guard** — `function load() { const r = fetchItems() !{...} }` — still emits correctly
3. **Multi-statement before failable** — `if (x) return; @a = 1; const r = call() !{...}` — emits cleanly
4. **Throw early-exit instead of return** — `if (x) throw new Error()` (or scrml's `fail` shape — pick whichever shape compiler accepts) — same fix path
5. **Multiple early-returns** — `if (a) return; if (b) return; const r = call() !{...}`
6. **Early-return INSIDE a block** — `if (x) { @a = 1; return; }; const r = call() !{...}`
7. **Negative control — `if`-expression in scrml-valid position** — e.g., `const x = a ? b : c` (ternary, not statement-if) — STILL works
8. **node --check** on each emitted JS — must parse clean

Aim for 10-15 tests.

## Phase 3 — verify (R26 EMPIRICAL DOCTRINE per S138)

1. `node --check` on emitted JS for each reproducer: parse clean.
2. **EMPIRICAL R26 verification on R24 dev-1-react** (the original reproducer source):
   ```
   bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile \
     /home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r24/dev-1-react.scrml \
     --output-dir /tmp/r26-bug31-verify/dev-1-react > /tmp/r26-bug31-verify/dev-1-react.log 2>&1
   echo "dev-1: node --check on client.js: $(node --check /tmp/r26-bug31-verify/dev-1-react/dev-1-react.client.js 2>&1 | head -1)"
   echo "dev-1: '_result = if' occurrences: $(grep -cE 'let _scrml_\w*result\w*\s*=\s*if' /tmp/r26-bug31-verify/dev-1-react/dev-1-react.client.js)"
   ```
   **Expected after fix:**
   - `node --check` exits 0 (no SyntaxError)
   - `_result = if (...)` occurrences drop to 0
3. Full suite: `bun run test` must pass. Baseline at HEAD `f81d6a56`: ~15,054 pass / 0 fail / 88 skip / 1 todo (subset).

# COMMIT DISCIPLINE (S83 + S113)

Coupled code + test = ONE commit per S113. WIP commits OK for crash-recovery.

# `--no-verify` PROHIBITION (S136 absolute)

NEVER. Session precedent: 9 of 10 dispatches clean.

# REPORTING

1. WORKTREE_PATH (literal `pwd`)
2. BRANCH
3. FINAL_SHA
4. FILES_TOUCHED
5. TEST_DELTA
6. ROOT-CAUSE FINDING (1-2 paragraphs)
7. REPRODUCER VERIFICATION (BEFORE/AFTER emitted JS for the `_result = if` shape)
8. R26 EMPIRICAL on R24 dev-1-react (node --check + `_result = if` count)
9. MAPS CONSULTED + load-bearing finding
10. DEFERRED ITEMS
11. PROCESS VIOLATIONS

# OUT OF SCOPE

- All other MED bugs (Bug 32 — next dispatch in `full wrap R25 MED tail` arc)
- Bug 38/40/41/37/49/42/35/30/43/44 — RESOLVED, don't touch their files
- SPEC changes — codegen-only fix
- Refactor beyond what fix requires

# IF YOU GET STUCK

After 60-90 min: STOP, report partial. WIP commit each step. Append progress.md.

GO.
