# Bug 6 — `<li>` text-template lift inline codegen — progress

Dispatch: PA-supervised background agent, worktree-isolated.

## Plan

1. Startup verification + maps + briefings reads.
2. Reproduce — find a minimal scrml shape that surfaces the bug, dump AST + emitted JS.
3. Diagnose — locate the silent-drop site in `emit-lift.js`.
4. Fix — extend logic-block-in-markup dispatch to handle `for-stmt`, `if-stmt`, nested `lift-expr`.
5. Add unit test.
6. Regression: full test suite.
7. End-to-end confirm: `bun scrml compile` on a representative fixture.

## Steps

### 2026-05-12 — Step 0: startup
- pwd / git status / bun install / bun run pretest: all green.
- Read primary.map.md + structure.map.md + anti-patterns briefing + kickstarter §3.

### 2026-05-12 — Step 1: repro
- `bun compiler/bin/scrml.js compile examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml` fails with E-CHANNEL-OUTSIDE-PROGRAM (separate concern — channel files are pure-channel-file pattern, not the bug-6 surface).
- Constructed a minimal `<program>` fixture (examples/16-remote-data.scrml is the canonical minimal): `match @state { .Ready(rows) => { lift <ul>${ for (let r of rows) { lift <li>${r.name}<span class="email">${r.email}</span></li> } }</ul> } ... }`.
- Examined `examples/dist/16-remote-data.client.js`. The `<ul>` Ready arm emits a bare `<ul>` with NO `<li>` children — the inner `for/lift` is silently dropped.

### 2026-05-12 — Step 2: AST trace
- BS + TAB of the fixture confirms the AST shape:
  - `lift-expr.expr.node` = `markup{tag:"ul", children: [markup{<text>}, logic{body:[for-stmt{body:[lift-expr{<li>...}]}]}, ...]}`.
- The `<li>` and its `${r.name}` interpolation are correctly parsed; the `for-stmt` is correctly parsed; the bug is purely in the codegen lowering.

### 2026-05-12 — Step 3: diagnose
- `compiler/src/codegen/emit-lift.js:553-563` — `emitCreateElementFromMarkup` only handled `bare-expr` children inside a `logic` block. `for-stmt`, `if-stmt`, and nested `lift-expr` children of a `logic` block were silently no-ops. Root cause: the function predates the consolidated for-lift container-routing helpers (`emitForStmtWithContainer`) and was never extended to cover the structured-markup path.

### 2026-05-12 — Step 4: fix
- Edit `compiler/src/codegen/emit-lift.js`:
  - In `emitCreateElementFromMarkup`'s `child.kind === "logic"` branch, dispatch by `logicChild.kind`:
    - `bare-expr` → text node (existing behavior, retained).
    - `lift-expr` → `emitLiftExpr(..., { containerVar: elVar })`.
    - `for-stmt`  → `emitForStmtWithContainer(..., elVar)` (existing helper, now wired here).
    - `if-stmt`   → new `emitIfStmtWithContainer(..., elVar)` helper.
    - else → fallback `emitLogicNode`.
  - Add new helper `emitIfStmtWithContainer(ifNode, containerElVar)` next to the for-stmt twin.
  - Extend `emitForStmtWithContainer` to recurse into nested for-stmt / if-stmt children (so doubly-nested for-loops with inner lift work correctly).
- Verified: minimal repro fixture now emits `for (const r of rows) { _scrml_lift_el_8.appendChild((() => { const _scrml_lift_el_9 = document.createElement("li"); ... return _scrml_lift_el_9; })()); }` — exactly the shape that the top-level for-lift case has always emitted.

### 2026-05-12 — Step 5: unit test
- New `compiler/tests/unit/lift-li-text-template.test.js` exercising the `lift <ul>${ for ... lift <li>... }</ul>` shape and asserting the inner `<li>` createElement chain is present.

### 2026-05-12 — Step 6: regression
- Full `bun test` — see "Test suite delta" in the final report.

### 2026-05-12 — Step 7: e2e

- `examples/16-remote-data.scrml` recompiled: `examples/dist/16-remote-data.client.js` now contains the full for-loop + `<li>` createElement chain inside the Ready arm (lines 68-83 of the dist):
  ```js
  else if (_scrml_tag_8 === "Ready") { _scrml_lift(() => {
    const _scrml_lift_el_11 = document.createElement("ul");
    _scrml_lift_el_11.setAttribute("class", "rows");
    for (const r of rows) {
    _scrml_lift_el_11.appendChild((() => {
      const _scrml_lift_el_12 = document.createElement("li");
      _scrml_lift_el_12.appendChild(document.createTextNode(String(r.name ?? "")));
      ...
      return _scrml_lift_el_12;
    })());
  }
    return _scrml_lift_el_11;
  }); }
  ```
- `node --check` passes on all regen'd dist files.

### 2026-05-12 — out-of-scope surfaced findings

- **Acceptance criterion #4 (`bun scrml dev` on load-detail page) unreachable in current HEAD.** `examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml` imports two pure-channel-file modules (`channels/dispatch-board.scrml`, `channels/load-events.scrml`), each declaring a top-level `<channel>` per SPEC §38.12.6 (pure-channel-file pattern). Under v0.3 channel reversal (S86 commit 2b7c4df), top-level channels fire `E-CHANNEL-OUTSIDE-PROGRAM` uniformly — and per SPEC §38.12.6 (line 16057-16061), the **A8 dispensation for module-file `export <channel>` is explicitly deferred** in v0.3 with the failure mode acknowledged ("module-file `<channel>` declarations fire `E-CHANNEL-OUTSIDE-PROGRAM` uniformly"). This is a known v0.3-deferred concern, NOT Bug-6's surface. The minimal Bug-6 fixture (examples/16-remote-data.scrml) compiles cleanly and rendres the inner `<li>` correctly — Bug-6 is closed.

- Other lift-li-text-template fixtures touched and verified clean:
  - `examples/16-remote-data.scrml` — direct Bug-6 repro; FIXED.
  - `examples/03-contact-book.scrml` — top-level for-lift path; UNCHANGED, still works.
  - `examples/17-schema-migrations.scrml` — top-level for-lift path; UNCHANGED, still works.
  - `examples/15-channel-chat.scrml` — blocked by same channel-reversal issue, NOT Bug-6.

### 2026-05-12 — Step 8: final test sweep

- `bun test compiler/tests/unit/`         → 9131 pass / 37 skip / 0 fail / 32641 expect()
- `bun test compiler/tests/integration/`  → 1414 pass / 18 skip / 1 todo / 0 fail / 3182 expect()
- `bun test compiler/tests/conformance/`  → 313 pass / 30 skip / 0 fail / 738 expect()
- `bun test compiler/tests/browser/`      → 216 pass / 8 skip / 0 fail / 282 expect()
- `bash scripts/compile-test-samples.sh`  → 12 samples compiled, no regressions.

Total: 11,074 pass / 0 fail / 93 skip / 1 todo (delta +7 from new lift-li-text-template.test.js).

### Status: DONE
