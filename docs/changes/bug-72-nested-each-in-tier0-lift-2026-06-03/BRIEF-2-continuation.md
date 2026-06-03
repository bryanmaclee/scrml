# BRIEF-2 (CONTINUATION) — Bug 72, after agent aaf169de crashed mid-implementation

**Dispatched:** S158, 2026-06-03 · **Agent:** `scrml-js-codegen-engineer` (opus, isolation:worktree, bg) · **Worktree base:** HEAD `1a72c81c` (still; no landings yet this session) · **Change-id:** `bug-72-nested-each-in-tier0-lift-2026-06-03`

**Why a continuation:** the first Bug-72 agent (aaf169de) completed an excellent Phase-0 survey + wrote the codegen helpers + part of the wiring, then crashed on an API socket error before testing. Its WIP is captured as `docs/changes/bug-72-nested-each-in-tier0-lift-2026-06-03/wip-source-from-aaf169de.patch` (validated: applies clean to a 1a72c81c source tree). PA empirically R26-verified the WIP STILL FAILS the reproducer (incomplete threading). This brief: transplant the validated WIP + finish the precise missing threading + test + verify.

---

(Verbatim `prompt:` text passed to the Agent call follows.)

---

You are FINISHING **Bug 72** in the scrml compiler (a TypeScript/JS codegen bug). A prior agent did the survey + wrote the helpers + crashed before testing. Its work is validated-but-incomplete; you transplant it and finish a precise, PA-pinpointed gap. Change-id: `bug-72-nested-each-in-tier0-lift-2026-06-03`.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

## Startup verification (BEFORE any other tool call)
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any other repo, STOP and report (S90 CWD-routing failure). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` — MUST equal WORKTREE_ROOT.
3. `git rev-parse HEAD` — your base IS main HEAD `1a72c81c` (no prior-landing merge needed; first dispatch landing of S158).
4. `git status --short` — confirm clean.
5. `bun install` (worktrees don't inherit node_modules — pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise).
6. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/`; without it ~130 browser-test ECONNREFUSED failures). Use `bun run test` (chains pretest), NOT bare `bun test`, for baselines.

If ANY check fails: STOP and report.

## Path discipline (EVERY edit — S99/S126)
- **Apply ALL file edits via Bash** (`perl -i`, `python3`, heredoc, `cp`) on **worktree-absolute paths including the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools (they've leaked into MAIN 15+ times — the filesystem-divergence class). Echo the path before each write; re-verify via `git diff`/`grep` after.
- **NEVER `cd` into the main repo or anywhere outside WORKTREE_ROOT.** Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths only.

# STEP 1 — TRANSPLANT THE PRIOR AGENT'S VALIDATED WIP (do this first, after startup verification)
The prior agent's helpers are CORRECT and PA-validated — do NOT rewrite them. The patch lives in the MAIN checkout (a static artifact; read-only-safe to reference cross-tree — it applies INTO your worktree via `-C`). Apply it:
```
PATCH=/home/bryan-maclee/scrmlMaster/scrmlTS/docs/changes/bug-72-nested-each-in-tier0-lift-2026-06-03/wip-source-from-aaf169de.patch
git -C "$WORKTREE_ROOT" apply "$PATCH"
git -C "$WORKTREE_ROOT" diff --stat   # expect: emit-each.ts +185, emit-lift.js +81
```
If `git apply` reports any reject, fall back to `patch -p1 -d "$WORKTREE_ROOT" < "$PATCH"`. The patch base IS 1a72c81c (your base) so it applies clean. (This is the ONLY main-path read you do — everything else is worktree-absolute.)
Then commit it immediately as the transplant baseline: `WIP(bug72): transplant aaf169de helpers at $(pwd)`.

Also recreate the two tiny reproducers (the prior commit had them; recreate to be safe) at `$WORKTREE_ROOT/repro-bug72.scrml` and `$WORKTREE_ROOT/repro-bug72-control.scrml`:

`repro-bug72.scrml` (the FAILING case — your fix must make this compile clean):
```scrml
type Row:struct = { id: string, cells: string[] }

<rows>: Row[] = []

<table>
  <tbody>
    ${ for (row of @rows) {
      lift <tr><each in=row.cells><td>${@.}</td></each></tr>
    } }
  </tbody>
</table>
```
`repro-bug72-control.scrml` (the WORKING control — must STAY working, no regression):
```scrml
type Row:struct = { id: string, cells: string[] }

<rows>: Row[] = []

<table><tbody>
  <each in=@rows as row>
    <tr><each in=row.cells><td>${@.}</td></each></tr>
  </each>
</tbody></table>
```

# WHAT THE PRIOR AGENT DID (read these — they are CORRECT, reuse them)
- `emit-each.ts`: exported `eachBlockFromMarkupNode(markupNode)` (generic markup `<each>` → `EachBlockAstNode` shape from structured attrs/children) + `emitNestedEachFromMarkup(markupNode, enclosingScopeVar, fragmentVar, indent, engineCtx)` (promotes + emits inline via the SHARED `emitEachReconcileLines` helper — the same one the Tier-1 nested-each branch uses). These lower the inner `@.` to the inner each's iter var.
- `emit-lift.js`: added `tryEmitNestedLiftEach(eachMarkupNode, scopeVar, fragmentVar, engineCtx)` (require-based, init-order safe); `emitCreateElementFromMarkup` gained a `scopeVar` param and routes a `<each>` markup child through `tryEmitNestedLiftEach` when `scopeVar` is non-null; `emitLiftExpr` threads `opts.scopeVar` → `emitCreateElementFromMarkup`; and `emitForStmtWithContainer` / `emitIfStmtWithContainer` thread `scopeVar: varName` into their lift calls.

# THE PRECISE GAP (PA-pinpointed via R26 — this is what you finish)
The reproducer STILL FAILS with the prior WIP because the prior agent threaded `scopeVar` ONLY through `emit-lift.js`'s `emitForStmtWithContainer` + `emitIfStmtWithContainer`. **But the reproducer's Tier-0 `for`-loop emits through a DIFFERENT for-stmt emitter: `emitForStmt` in `compiler/src/codegen/emit-control-flow.ts` (line ~355) — the non-container global `_scrml_lift()` accumulation path.** PA confirmed: the failing emit is `...createTextNode(String((@ .) ?? ""))); _scrml_lift...` — the `_scrml_lift(` marks the consolidated-lift path, NOT the container path.

`emitForStmt` (emit-control-flow.ts:355) routes its lift body through these sub-paths — NONE thread `scopeVar` today:
- `emitConsolidatedLift(body, {...})` at emit-control-flow.ts ~line 456 (the createFn `directReturn` path) and ~line 527 (the non-createFn path). `emitConsolidatedLift` is defined in `emit-lift.js:1570`.
- the reactive-iterable createFn it builds inline: `function ${createFnVar}(${varName}, _scrml_idx) {` (emit-control-flow.ts ~line 452) — `varName` IS the loop variable.
- the DocumentFragment fallback `emitLiftExpr(child, { containerVar: tmpContainerVar, engineCtx })` at emit-control-flow.ts ~line 467 (no scopeVar).
- `emitConsolidatedLift` (emit-lift.js:1570) internally calls `emitLiftExpr` / `emitCreateElementFromMarkup` — it needs a `scopeVar` param too, passed down to those calls and into its own createFn body.

**Your task: thread `scopeVar` (the for-loop variable — already available as `varName` in `emitForStmt`) through `emitForStmt` (emit-control-flow.ts) AND `emitConsolidatedLift` (emit-lift.js:1570) AND every lift-emission sub-path they reach, exactly mirroring how the prior agent did it in `emitForStmtWithContainer`.** The if-stmt consolidated paths (emit-control-flow.ts:314/328) should also thread scopeVar from their enclosing opts so a nested-each inside an `if` inside a `for` works.

**SURVEY BREADTH (the depth-of-survey lesson that caused this gap):** there may be MORE than these paths. After threading the obvious ones, R26 the reproducer; if it still leaks, trace the ACTUAL emit path for the reproducer (add a temporary console.error or grep the emitted JS) and thread scopeVar through whatever path it actually takes. Do NOT declare done until R26 passes empirically.

# SPEC AUTHORITY (Rule 4 — PA-confirmed, do not re-litigate)
- **SPEC.md §17.7.3 line 10564:** "Nested `<each>` scopes resolve `@.` to the INNERMOST scope's current value." → the inner `@.` MUST lower to the inner each's iter var, in ANY markup context incl. Tier-0 lifted markup (§17.4).
- **E-SYNTAX-064 (§34 / §17.7.3)** correctly does NOT fire on the inner `@.` (it IS inside an `<each>` body). Do NOT touch E-SYNTAX-064 logic.

# TESTS (add after R26 passes)
Unit (`compiler/tests/unit/each-in-tier0-lift-bug72.test.js`) + happy-dom (`compiler/tests/browser/`) covering: the reproducer (nested `<each in=row.cells>` inside `${for row of @rows lift}`); `<each of=N>` nested in a lift (`@.`=index); `as name` alias on the inner each; `${@.}` interpolation AND any per-item attr/handler `@.` form reachable in the lift-embedded position; and a NEGATIVE no-regression (a Tier-0 lift with NO nested each emits byte-identical). The happy-dom test should render the reproducer + assert the table cells contain the actual cell text (proving the inner `@.` resolved at runtime).

Do NOT regress the 6 S157 fixes (Bug 63/65/67/68/70/71) — full suite covers it; if you touch shared emit-each/emit-lift/emit-control-flow helpers, run the Bug 65 + each-block + existing each-block tests explicitly.

# COMMIT DISCIPLINE (S83)
- After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>`; `git -C "$WORKTREE_ROOT" add <file>`; commit IMMEDIATELY (per fix-unit / per test-file). First commit message includes verbatim `pwd`.
- Update `$WORKTREE_ROOT/docs/changes/bug-72-nested-each-in-tier0-lift-2026-06-03/progress.md` (append-only) after each step.
- Before DONE: `git -C "$WORKTREE_ROOT" status` MUST be clean. "HEAD unchanged — work in worktree" is NOT acceptable.
- Pre-commit hook runs `bun test {unit,integration,conformance} --bail`. **NEVER `--no-verify`** (forbidden, no authorization). Fix the cause if it fails.

# PHASE 3 — MANDATORY EMPIRICAL R26 (S138)
Before DONE, re-compile the reproducer on your post-fix baseline:
```
bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile "$WORKTREE_ROOT"/repro-bug72.scrml --output-dir /tmp/r26-bug72/$(date +%s) 2>&1 | tee /tmp/r26-bug72.log
```
ALL must hold:
- Exits 0 (no `E-CODEGEN-INVALID-JS`).
- `grep` the emitted `repro-bug72.client.js`: ZERO raw `(@ .)` / `(@.)` / `@ .` — the inner sigil reads as the inner each's iter var.
- `node --check` on the emitted client.js exits 0.
- The control (`repro-bug72-control.scrml`) STILL compiles clean.
Paste the grep counts + node --check exits in your report. DO NOT mark DONE without R26 passing.

# FINAL REPORT
WORKTREE_PATH · BRANCH + FINAL_SHA · FILES_TOUCHED · ROOT CAUSE (the full path picture — which emitters needed scopeVar) · FIX SUMMARY (incl. how you reused the transplanted helpers) · TEST DELTA (N new; full-suite pass/fail/skip from `bun run test`) · R26 EMPIRICAL RESULTS (grep counts + node --check + control-clean) · MAPS feedback line · ANY SIBLING GAPS surfaced (Rule 5 — surface, don't silently fix/skip) · DEFERRED items.
