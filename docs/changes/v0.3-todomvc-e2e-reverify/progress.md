# TodoMVC e2e re-verify (post Bug 4 + Bug 5 fixes) — progress

Append-only.

## 2026-05-12 startup
- WORKTREE_ROOT = `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a4a00d318ce8d628a`
- Worktree base was at `7a00b1b` (S86 wrap); rebased onto main `8666d45` to inherit S87/S88 fixes (Bug 5 fix `279bfc8`, Bug 4 walker fix `cee4469`, all engine + match-arm + migrate landings).
- `bun install` 117 packages.
- `bun run pretest` — 12 samples compiled OK.
- Maps consulted: `primary.map.md`, `structure.map.md`, `test.map.md`.
- Required reads: BRIEFING-ANTI-PATTERNS, llm-kickstarter v1, progress-bug-4 (full diagnostic).

## Step 1 — Bug 5 fix downstream verification
- Reverted S87 D3b `.filter(cb).length` workaround on activeCount/completedCount (canonical single-statement form).
- Recompile: `.filter(function(t) { ... }).length` round-trips intact (app.client.js:92-94 + 96-98).
- Bug 5 fix CONFIRMED working at compile level.
- Commit: `3bbd610` revert(todomvc): restore canonical .filter(cb).length form.
- Pre-commit gate: PASSED (full unit+integration+conformance suite).
- Compile status: 5 warnings (W-PROGRAM-001 cosmetic + 3 W-DEAD-FUNCTION on commitEdit/cancelEdit/visibleTodos + 1 E-DG-002 on @editingId — all to be closed by edit-mode markup landing).

## Step 2 — Edit-mode markup attempt — BLOCKED by 4 lift-template attribute-parser bugs

Drafted canonical TodoMVC edit-mode markup:
- Refactored commitEdit() to take no args (drives off @editingId so bare-call
  in markup doesn't have to thread loop-bound todo.id, which would block
  event auto-injection per §5.2.2).
- Added handleEditKey(e) for Enter-commits / Escape-cancels.
- Switched `for (let todo of @todos)` to `for (let todo of visibleTodos())`
  to wire visibleTodos function reference.
- Added `<input class="edit" if=@editingId == todo.id bind:value=@editText
  onkeydown=handleEditKey() onblur=commitEdit() />` inside the per-item lift.
- Added `class:editing=(@editingId == todo.id)` on the `<li>`.
- Replaced display:none CSS rule for .edit with proper TodoMVC visual.

Compiled output inspection revealed FOUR distinct lift-template
attribute-parser gaps — all out of scope per dispatch brief
("If TodoMVC fixture editing reveals additional compiler bugs, STOP and
surface for separate dispatch"):

  Bug LIFT-1 (CATASTROPHIC):
    `class:NAME=(parens-expr)` (or any paren-wrapped attr value) inside
    a lift template ELIDES the parent element entirely AND duplicates
    inner text content. Repro: `lift <li class:editing=(@x == item.id)
    data-id=${item.id}>${item.id}</li>` emits
      `_scrml_lift_el_N = document.createElement("div")`  // NOT "li"!
      `_scrml_lift_el_N.appendChild(document.createTextNode(\`${item.id}\`))`
      `_scrml_lift_el_N.appendChild(document.createTextNode(\`${item.id}\`))` // DUP

  Bug LIFT-2:
    `bind:value=@var` inside lift template emits literal
    `setAttribute("bind:value", _scrml_reactive_get("var"))` — NO
    addEventListener("input", ...) two-way wiring. Diverges from top-level
    `bind:value=` which emits proper bind plumbing.

  Bug LIFT-3:
    `if=@expr` inside lift template emits literal
    `setAttribute("if", String(expr ?? ""))` — NO style.display toggle.
    Diverges from top-level `if=` conditional rendering.

  Bug LIFT-4:
    `onkeydown=fn()` (bare-call empty-args) inside lift template does NOT
    auto-inject `event` arg. Emits `_scrml_fn_N ( )` — empty parens.
    Diverges from top-level behavior locked in by
    event-handler-args-e2e.test.js §4 "onkeydown=handleKey() threads event".

  Bug LIFT-5 (additional, surfaced via if-inside-for design probe):
    `if (cond) { lift <li>... }` inside `for (let item of @items) { ... }`
    creates `_scrml_create_item_N` reconciler factory that returns
    `_scrml_tmp_M.firstChild` which is empty (the if-body uses
    `_scrml_lift(() => ...)` with ambient `_scrml_lift_target` — but that
    target is NOT set inside the reconciler-called create-item). Likely
    runtime breakage; not directly verified (no Playwright access in this
    dispatch's worktree).

Decision: STOPPED per brief. Reverted markup changes (kept only the
activeCount/completedCount Bug 5 revert from Step 1). Edit-mode markup
not shippable until the 4-5 lift-template bugs are closed.

## Step 3 — Unit test landing
- `compiler/tests/unit/todomvc-fixture-edit-mode.test.js` — new (+7 tests):
  §A.1  TodoMVC fixture compiles with zero errors
  §A.2  activeCount() preserves .filter(cb).length callback (Bug 5 anchor on live fixture)
  §A.3  completedCount() preserves .filter(cb).length callback (Bug 5 anchor on live fixture)
  §B.1  Lift class:NAME=(parens-expr) elides parent element (broken-output anchor)
  §B.2  Lift bind:value=@var emits literal setAttribute (broken-output anchor)
  §B.3  Lift if=@expr emits literal setAttribute (broken-output anchor)
  §B.4  Lift onkeydown=fn() does NOT auto-inject event (broken-output anchor)
- §B tests assert CURRENT BROKEN OUTPUT — they fail when the underlying
  gap is later fixed, prompting test upgrade. Repro-anchor pattern.
- Test delta: 11764 → 11771 pass (+7); 0 fail (excluding pre-existing
  `Bug 3a §1 SQL round-trip` failure unrelated to this dispatch).
- Commit: `66e734a` test(s88-todomvc-e2e-reverify): ... (pre-commit PASSED).

## Final status — PARTIAL

ACs landed:
- AC1 (form-submit working post Bug 5) — VERIFIED at compile level.
  Live e2e run BLOCKED (Playwright execution disabled in this sandbox;
  see Open Questions below).
- AC2 (edit-mode markup added) — NOT LANDED (5 compiler bugs surfaced).
- AC3 (W-DEAD-FUNCTION closed) — NOT LANDED (depends on AC2).
- AC4 (E-DG-002 closed) — NOT LANDED (depends on AC2).
- AC5 (e2e PASSES on 3 browsers) — NOT EXECUTABLE (Playwright blocked).
- AC6 (idiomatic styling rule) — N/A (no shippable file-top #{} added).
- AC7 (unit tests on edit-mode shape) — REPLACED by repro tests for the
  4 surfaced bugs (+3 anchor tests on live fixture state). +7 total.

Walltime: ~2.5h. Within band.
