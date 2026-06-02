# BRIEF — Bug 62: engine `.advance(...)` (+ `@engine = .X`) inside a Tier-1 `<each>` event handler emits raw → E-CODEGEN-INVALID-JS

**change-id:** `s156-bug62-each-render-engine-ctx`
**severity:** HIGH (codegen) · **agent:** scrml-js-codegen-engineer · **isolation:** worktree
**SPEC authority:** §51.0.G (`.advance`), §51.0.G.1 (two-plane resolution), §51.0.S (engine message dispatch), §17.7 (`<each>`), §5.2.2/§5.2.3 (event handlers). Read these IN FULL via `offset:`+`limit:` from `compiler/SPEC.md` before changing emission semantics (PA Rule 4: SPEC is normative).

---

# MAPS — REQUIRED FIRST READ

Before consuming any other context, read `.claude/maps/primary.map.md` in full (~100 lines). The §"Task-Shape Routing" section tells you which additional maps to consult — this is a **compiler-source bug fix in codegen**; follow that routing.

Map currency: maps reflect HEAD **`c665714c`** as of **2026-06-02 (S154 era)**. They are STALE by 4 commits — notably `a9ce4c3a` (#14 batch-3 codegen+runtime) which ADDED the engine message-dispatch ctx (`enginesWithMessageArms` / `engineMessageVariants` / `_scrml_engine_dispatch_message`) to `emit-event-wiring.ts` + `emit-expr.ts` + the runtime. **Treat any map content about `emit-each.ts` / `emit-event-wiring.ts` / `emit-expr.ts` / engine codegen as a starting hypothesis — verify against current source via grep/Read.** The fire site + pattern-to-mirror are given below with exact line anchors (current as of HEAD `118db71d`).

Feedback: in your final report, include "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing."

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is assigned by the harness. **S99 leak-history: this dispatch class has had repeated path-discipline leaks — do not become the next incident.**

## Startup verification (BEFORE any other tool call)
1. `pwd` via Bash. Output MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If it is under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report (S90 CWD-routing failure). Save it as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` MUST equal `WORKTREE_ROOT`.
3. `git merge main` (worktree base = session-start commit, may be stale; bring in current main). Resolve trivially or report if conflict.
4. `git status --short` clean.
5. `bun install` (worktrees don't inherit node_modules; the pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise).
6. `bun run pretest` (populates `samples/compilation-tests/dist/` for browser tests; full `bun test` produces ~130 ECONNREFUSED failures without it).

If ANY check fails: STOP and report. Do not proceed.

## Path discipline (EVERY edit)
- **Apply ALL file edits via Bash** (`perl`/`python`/heredoc/`cp`) on **worktree-absolute paths that include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools (S126: Edit/Write have leaked to MAIN while Bash/git saw the worktree). Echo the target path before each write; re-verify via `git diff`/`grep` after.
- **NEVER `cd` into the main repo** (or anywhere outside WORKTREE_ROOT). Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, and worktree-absolute paths exclusively. (S126 incident #14: a `cd` into main leaked a `bun add` into main's package.json.)
- Reads of main via absolute path give WRONG content (main may be ahead). Read only under WORKTREE_ROOT.

## Commit discipline (S83 — two-sided rule)
- Commit after EACH meaningful change (don't batch). First commit message includes verbatim `pwd` output: `WIP(bug62): start at <pwd>`.
- Before reporting DONE: `git status` MUST be clean (no uncommitted changes). "work in worktree, no commits" is NOT an acceptable terminal report.
- Update `docs/changes/s156-bug62-each-render-engine-ctx/progress.md` (append-only, timestamped) after each step. If you crash, your commits + progress.md are how the next agent resumes.
- Coupled code+test = ONE commit.

Report at the end: WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, deferred-items, Phase-3 R26 results.

---

# THE BUG (reproduced empirically by PA at HEAD `118db71d`)

An engine `.advance(...)` call (and the sibling `@engineVar = .Variant` direct-write) inside a **Tier-1 `<each>` per-item event handler** is emitted RAW — neither the `@` sigil nor `.advance`/the bare variant are lowered — producing invalid JS that the default-ON emit parse-gate rejects with `E-CODEGEN-INVALID-JS`.

This is **PRE-EXISTING and NOT #14-specific**: it breaks STATE-plane `.advance(.StateVariant)` identically (the reproducer below is state-plane). The #14 message-dispatch arc surfaced it because the canonical SPEC §51.0.S.6 example mounts dispatch handlers in a nested `<each>` (`<li ondrop=@dragPhase.advance(.Drop(col.id))>` inside `<each in=@columns as col>`).

## Reproducer (recreate in your worktree; PA confirmed it FAILS at HEAD)
```scrml
<program>
${
    type Phase:enum = { Idle, Active }
    <cols>: string[] = ["a", "b", "c"]
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>idle</>
    <Active rule=.Idle>active</>
</>

<ul>
    <each in=@cols as col>
        <li onclick=@phase.advance(.Active)>${col}</li>
    </each>
</ul>
</program>
```
Compile: `bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile <repro> --output-dir /tmp/bug62-pre`
**Current (broken) emit:** `...addEventListener("click", function(event) { @phase.advance(.Active); })` → `E-CODEGEN-INVALID-JS: Unexpected character '@'`.

## Fire site
`compiler/src/codegen/emit-each.ts`:
- `renderTemplateAttrToJs` (line ~498), case **(2) event handlers** (lines ~539-562). The handler value (`val.kind` = `expr`/`call-ref`/`variable-ref`, with `val.raw`/`val.name` — a **string**, no structured ExprNode) is routed through `rewriteIterValueExpr` (line ~455).
- `rewriteIterValueExpr` does ONLY iter-scope lowering: `@.field`→`<iterVar>.field` (`rewriteContextualSigil`) + bare `@cell`→`_scrml_reactive_get("cell")` (`rewriteAtCellAccess`). It has **no engine ctx and no `.advance`/bare-variant lowering**. So `@phase.advance(.Active)` survives raw.

## Pattern-to-mirror (the WORKING non-each path)
`compiler/src/codegen/emit-event-wiring.ts:330-364` builds `engineRewriteCtx`/`engineExprCtxExtras` from `ctx.fileAST` via collect* helpers **exported from `emit-engine.ts`** (`collectEngineVarNames`, `collectEnginesWithMessageArms`, `collectEngineMessageVariants`, `buildEngineBindingsMap`, + the hooks/timeout/idle/internal/history collectors). It then routes handlers through `emitExprField(node, fallbackStr, {mode:"client", ...engineExprCtxExtras})` (`emit-expr.ts:316`) → the **C13 `.advance` arm** (`emit-expr.ts:1142+`) which lowers:
- state plane: `@phase.advance(.Active)` → `_scrml_engine_advance("phase", "Active", __scrml_engine_phase_transitions)`
- message plane (§51.0.G.1, when the arg variant ∈ `engineMessageVariants.get(varName)`): → `_scrml_engine_dispatch_message(...)`

PA-captured canonical correct output for the non-each `<button onclick=@phase.advance(.Active)>`:
```js
"_scrml_attr_onclick_1": function(event) { _scrml_engine_advance("phase", "Active", __scrml_engine_phase_transitions); }
```

**Critical:** the C13 `.advance` lowering is **structured-ExprNode-only**. The string-fallback path (`rewriteExprWithDerived`/`rewriteIterValueExpr`) does NOT detect `.advance`. So the fix cannot be a string regex — you must obtain a structured ExprNode for the each handler (parse the handler string via the expression-parser, or find whether the each AST already carries a node) and route through `emitExprField` with `engineExprCtxExtras`.

## The crux (your architectural call — survey first)
The each handler must compose TWO rewrites: (a) iter-var scope (`@.field`→iterVar.field, `as col`→`col` bound param) and (b) engine-aware structured `.advance`/`@engine = .X` lowering. These target DISJOINT `@`-forms (`@.`/as-name are iter-locals; `@engineVar` is a file-scope engine var), so they should compose — but the structured emit path must have the iter binding in scope (`@.`/`col` must resolve) AND the engine ctx threaded. Determine the cleanest mechanism (e.g. parse handler→ExprNode, pre-rewrite `@.`/iter-scope, then `emitExprField` with engineExprCtxExtras; or thread an iter-binding into the EmitExprContext). You own the survey + the touchpoint — correct the approach if this framing is off (depth-of-survey-discount: the real fix may be smaller or differently-shaped than described).

---

# PHASES

## Phase 0 — survey + STOP-if-mismatch
Confirm the fire site + the structured-vs-string constraint against current source. If the bug does NOT reproduce as described, or the pattern-to-mirror differs materially, STOP and report before editing (R26 reverse-direction: don't fix a ghost / don't fix the wrong shape). Otherwise proceed.

## Phase 1 — fix `emit-each.ts` event-handler emission
Thread engine ctx into the each render-factory event-wiring so engine `.advance(.X)` (state AND message plane) AND `@engineVar = .Variant` direct-write lower correctly per-item, composing with iter-scope. Reuse the emit-event-wiring/emit-expr machinery (collect* + emitExprField + C13 arm) — do NOT duplicate the `.advance` lowering logic. Keep non-engine handlers (`onclick=fn()`, `onclick=@.handler`, `class:`, interpolation) working exactly as before (these are well-tested — don't regress them).

## Phase 2 — regression tests
Add unit tests (`compiler/tests/unit/`) asserting the each-handler emits `_scrml_engine_advance(...)` for state-plane and `_scrml_engine_dispatch_message(...)` for message-plane, AND a happy-dom test (`compiler/tests/browser/`) that loads the emitted client.js and exercises a click in an each-rendered item that advances the engine. Cover the assign form (`@engine = .X`) too. Run the FULL suite (`bun run test`) — 0 regressions is the contract (S155 baseline 22,672 pass / 0 fail).

## Phase 3 — R26 empirical verification (MANDATORY — HIGH codegen, S138)
Re-compile the reproducer above on your post-fix baseline AND the canonical SPEC §51.0.S.6 form (message-plane `.advance(.MsgVariant)` in `<each in=@columns as col>`). For each: compile exit 0, **`node --check` clean on the emitted client.js**, and grep confirms `_scrml_engine_advance` / `_scrml_engine_dispatch_message` present (NOT raw `@`/`.advance`). Also re-compile `examples/25-triage-board.scrml` (the gold §51.0.S site — currently uses the Tier-0 `${for…lift}` workaround) to confirm no regression. **DO NOT mark DONE without empirical R26 verification passing.**

Note (do NOT fix — just report): check whether the Tier-0 `${for…lift}` path (`emit-lift.js`) has the identical engine-`.advance`-in-handler gap. If yes, name it for a sibling filing. Keep this dispatch scoped to the Tier-1 `<each>` path.
