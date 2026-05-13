/**
 * todomvc-fixture-edit-mode.test.js
 *
 * Sibling to method-chain-callback-emission.test.js. Anchors TWO things:
 *
 *   §A  The TodoMVC fixture (benchmarks/todomvc/app.scrml) compiles
 *       successfully and locks in S87 Bug 5 fix at the live fixture site:
 *       `.filter(cb).length` in activeCount() / completedCount() preserves
 *       the inner callback in the emitted client JS. This is the canonical
 *       Wave 3 D3b shape and is the reason the v0.3 TodoMVC e2e re-verify
 *       dispatch was filed.
 *
 *       S89 update: §A also anchors the edit-mode markup landing. After
 *       S88's LIFT-1..5 closure, the fixture now wires canonical TodoMVC
 *       edit-mode markup (`<input class="edit" if=@editingId == todo.id
 *       bind:value=@editText onkeydown=handleEditKey() onblur=commitEdit(
 *       todo.id) />`) inside the per-item `for (let todo of visibleTodos())
 *       { lift <li>... }` loop. The §A.3 test asserts the edit input + the
 *       three previously-W-DEAD functions (commitEdit / cancelEdit /
 *       visibleTodos) are now emitted and referenced from markup.
 *
 *   §B  Originally reproduced FOUR lift-template-attribute-parser gaps
 *       surfaced by the v0.3 TodoMVC e2e re-verify dispatch (2026-05-12).
 *       Each test asserted the CURRENT BROKEN OUTPUT to fail when the gap
 *       was fixed, prompting test upgrade. S88 LIFT-1..5 fixes closed ALL
 *       FOUR gaps end-to-end:
 *
 *       §B.1  Parens-wrapped attribute expression (`if=(expr)` or
 *             `class:NAME=(expr)`) — FIXED by LIFT-1 (`be7b261`,
 *             ast-builder.js cursor desync fix). Parent element preserved;
 *             single text node emitted.
 *
 *       §B.2  `bind:value=@var` inside lift template — FIXED by LIFT-2
 *             (`14e21de`). Two-way wiring emitted (addEventListener("input")
 *             + reactive_get/set/subscribe).
 *
 *       §B.3  `if=@expr` inside lift template — FIXED by LIFT-3 (`14e21de`).
 *             Display-style toggle + reactive subscription emitted.
 *
 *       §B.4  `onkeydown=fn()` bare-call inside lift template — FIXED by
 *             LIFT-4 (`14e21de`). `event` argument auto-injected.
 *
 *       §B tests have been UPGRADED to assert the CORRECT (post-fix)
 *       output — the canonical "per-item interactive markup inside for/lift"
 *       pattern is now end-to-end functional.
 *
 * Created: 2026-05-12 (S88 v0.3 TodoMVC e2e re-verify dispatch).
 * Updated: 2026-05-13 (S89 TodoMVC edit-mode markup landing; §B upgraded
 *          from broken-output to correct-output anchors).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const TODOMVC_PATH = join(REPO_ROOT, "benchmarks/todomvc/app.scrml");

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/todomvc-edit-mode");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

let liftParensClassFx, liftBindValueFx, liftIfExprFx, liftOnKeydownFx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // §B.1 — parens-wrapped class:NAME=(expr) inside lift template
  // EXPECTED-BROKEN: `<li>` element is elided; emitted as `createElement("div")`.
  liftParensClassFx = fix("lift-parens-class.scrml", `<program>
\${
  @items = [{id: 1}, {id: 2}]
  @editingId = 1
}
<ul>
  \${
    for (let item of @items) {
      lift <li class:editing=(@editingId == item.id) data-id=\${item.id}>
        \${item.id}
      </li>
    }
  }
</ul>
</program>
`);

  // §B.2 — bind:value=@var inside lift template
  // EXPECTED-BROKEN: literal setAttribute("bind:value", _scrml_reactive_get("editText"))
  // instead of two-way bind wiring (addEventListener("input", ...)).
  liftBindValueFx = fix("lift-bind-value.scrml", `<program>
\${
  @items = [{id: 1}, {id: 2}]
  @editText = ""
}
<ul>
  \${
    for (let item of @items) {
      lift <li data-id=\${item.id}>
        <input class="edit" bind:value=@editText type="text" />
      </li>
    }
  }
</ul>
</program>
`);

  // §B.3 — if=@expr inside lift template
  // EXPECTED-BROKEN: literal setAttribute("if", "...") instead of display:none toggle.
  liftIfExprFx = fix("lift-if-expr.scrml", `<program>
\${
  @items = [{id: 1}, {id: 2}]
  @editingId = 1
}
<ul>
  \${
    for (let item of @items) {
      lift <li data-id=\${item.id}>
        <span if=@editingId == item.id>editing</span>
      </li>
    }
  }
</ul>
</program>
`);

  // §B.4 — onkeydown=fn() inside lift template (bare-call, empty args)
  // EXPECTED-BROKEN: emitted call is _scrml_fn_N() WITHOUT event arg.
  // Top-level equivalent (per event-handler-args-e2e.test.js §4) emits
  // _scrml_fn_N(event).
  liftOnKeydownFx = fix("lift-on-keydown.scrml", `<program>
\${
  @items = [{id: 1}, {id: 2}]

  function handleKey(e) {
    // bare-call empty-args should auto-inject event per §5.2.2
  }
}
<ul>
  \${
    for (let item of @items) {
      lift <li data-id=\${item.id}>
        <input type="text" onkeydown=handleKey() />
      </li>
    }
  }
</ul>
</program>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// §A: TodoMVC fixture — compiles + Bug 5 fix locked in
// ---------------------------------------------------------------------------

describe("§A: TodoMVC fixture (benchmarks/todomvc/app.scrml) — post Bug 5 fix + S89 edit-mode landing", () => {
  test("compiles with zero errors (only W-PROGRAM-001 warning expected post-S89-edit-mode)", () => {
    const result = compileScrml({ inputFiles: [TODOMVC_PATH], outputDir: FIXTURE_OUTPUT, write: false });
    expect(result.errors).toEqual([]);
    // S89 edit-mode landing wires commitEdit/cancelEdit/visibleTodos/@editingId
    // into markup; W-DEAD-FUNCTION × 3 + E-DG-002 should no longer fire.
    // Only remaining warning is W-PROGRAM-001 (fixture uses bare <div class="todoapp">
    // root not <program>; out of scope for edit-mode landing).
    const warnings = result.warnings ?? [];
    const codes = warnings.map((w) => w.code);
    expect(codes).not.toContain("W-DEAD-FUNCTION");
    expect(codes).not.toContain("E-DG-002");
  });

  test("edit-mode markup is wired (<input class=\"edit\"> emitted inside lift body) — S89 anchor", () => {
    const result = compileScrml({ inputFiles: [TODOMVC_PATH], outputDir: FIXTURE_OUTPUT, write: false });
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(TODOMVC_PATH).clientJs;
    // The edit input element must be created in the lift create-item factory.
    expect(js).toMatch(/document\.createElement\("input"\)/);
    // The edit input class is "edit" (canonical TodoMVC).
    expect(js).toMatch(/"edit"/);
    // handleEditKey is referenced (wired via onkeydown).
    expect(js).toMatch(/_scrml_handleEditKey_\d+/);
    // commitEdit is referenced (wired via onblur — was W-DEAD pre-S89).
    expect(js).toMatch(/_scrml_commitEdit_\d+/);
    // visibleTodos is referenced (wired as for-iterable — was W-DEAD pre-S89).
    expect(js).toMatch(/_scrml_visibleTodos_\d+/);
  });

  test("activeCount() preserves .filter(cb).length callback (Bug 5 anchor)", () => {
    const result = compileScrml({ inputFiles: [TODOMVC_PATH], outputDir: FIXTURE_OUTPUT, write: false });
    const js = result.outputs.get(TODOMVC_PATH).clientJs;
    // The activeCount function body must contain the callback returning `!t.completed`.
    expect(js).toMatch(/_scrml_activeCount_\d+\s*\(\s*\)\s*\{[^}]*\.filter\(\s*function/);
    expect(js).toMatch(/return\s+!\s*t\s*\.\s*completed/);
    // Must NOT contain the broken empty-filter shape.
    expect(js).not.toMatch(/_scrml_activeCount_\d+\s*\(\s*\)\s*\{[^}]*\.filter\(\s*\)\.length/);
  });

  test("completedCount() preserves .filter(cb).length callback (Bug 5 anchor)", () => {
    const result = compileScrml({ inputFiles: [TODOMVC_PATH], outputDir: FIXTURE_OUTPUT, write: false });
    const js = result.outputs.get(TODOMVC_PATH).clientJs;
    expect(js).toMatch(/_scrml_completedCount_\d+\s*\(\s*\)\s*\{[^}]*\.filter\(\s*function/);
    expect(js).toMatch(/return\s+t\s*\.\s*completed/);
    expect(js).not.toMatch(/_scrml_completedCount_\d+\s*\(\s*\)\s*\{[^}]*\.filter\(\s*\)\.length/);
  });
});

// ---------------------------------------------------------------------------
// §B: Lift-template attribute-parser gap repros (current-broken-output anchors)
// ---------------------------------------------------------------------------

describe("§B: lift-template attribute parser — current-broken-output repros", () => {
  test("§B.1 parens class:NAME=(expr) preserves parent element <li> (FIXED by LIFT-1 patch)", () => {
    const result = compile(liftParensClassFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(liftParensClassFx).clientJs;
    // LIFT-1 FIX verified: the lift element (_scrml_lift_el_N) is now "li", not the
    // broken "div" fallback that occurred when parseLiftTag returned null and the
    // rootTag default was used.
    expect(js).toMatch(/_scrml_lift_el_\d+\s*=\s*document\.createElement\("li"\)/);
    expect(js).not.toMatch(/_scrml_lift_el_\d+\s*=\s*document\.createElement\("div"\)/);
    // Single text node for \${item.id} — no duplicate from the broken string-fallback path.
    // (The list wrapper createElement("div") is a separate variable and not a regression.)
    const textNodeMatches = js.match(/createTextNode/g);
    expect(textNodeMatches).not.toBeNull();
    expect(textNodeMatches.length).toBe(1);
  });

  test("§B.2 bind:value=@var inside lift emits two-way wiring (FIXED by LIFT-2 patch)", () => {
    const result = compile(liftBindValueFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(liftBindValueFx).clientJs;
    // LIFT-2 FIX: no literal setAttribute("bind:value", ...) call.
    expect(js).not.toMatch(/setAttribute\("bind:value"/);
    // Two-way wiring: addEventListener on "input" + reactive get/set/subscribe.
    expect(js).toMatch(/addEventListener\("input"/);
    expect(js).toMatch(/_scrml_reactive_get\("editText"\)/);
    expect(js).toMatch(/_scrml_reactive_set\("editText"/);
    expect(js).toMatch(/_scrml_reactive_subscribe\("editText"/);
  });

  test("§B.3 if=@expr inside lift emits display toggle (FIXED by LIFT-3 patch)", () => {
    const result = compile(liftIfExprFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(liftIfExprFx).clientJs;
    // LIFT-3 FIX: no literal setAttribute("if", ...) call.
    expect(js).not.toMatch(/setAttribute\("if"/);
    // Display-style toggle + subscription to the reactive cell.
    expect(js).toMatch(/style\.display\s*=/);
    expect(js).toMatch(/_scrml_reactive_subscribe\("editingId"/);
  });

  test("§B.4 onkeydown=fn() inside lift auto-injects event (FIXED by LIFT-4 patch)", () => {
    const result = compile(liftOnKeydownFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(liftOnKeydownFx).clientJs;
    // LIFT-4 FIX: bare-call empty-args now auto-injects `event` per §5.2.2 +
    // event-handler-args-e2e.test.js §4 locked invariant. Astring inserts
    // spaces inside (): `_scrml_handleKey_N ( event )`.
    expect(js).toMatch(/_scrml_handleKey_\d+\s*\(\s*event\s*\)/);
    // No bare empty-parens form.
    expect(js).not.toMatch(/_scrml_handleKey_\d+\s*\(\s*\)/);
  });
});
