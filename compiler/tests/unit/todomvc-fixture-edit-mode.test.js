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
 *   §B  Reproduces FOUR lift-template-attribute-parser gaps surfaced by the
 *       v0.3 TodoMVC e2e re-verify dispatch (2026-05-12). The dispatch
 *       attempted to land canonical TodoMVC edit-mode markup
 *       (`<input class="edit" if=@editingId == todo.id bind:value=@editText
 *       onkeydown=handleEditKey() onblur=commitEdit() />`) inside the
 *       per-item `for (let todo of visibleTodos()) { lift <li>... }` loop,
 *       which is the canonical TodoMVC shape (see https://todomvc.com).
 *
 *       The lift-attribute parser in compiler/src/codegen/emit-lift.js has
 *       FOUR gaps that block the canonical shape:
 *
 *       §B.1  Parens-wrapped attribute expression (`if=(expr)` or
 *             `class:NAME=(expr)`) causes the PARENT element to be elided
 *             from the emitted lift create-item factory AND text content
 *             duplicated. Repro: a `<li class:editing=(@x == item.id)>...</li>`
 *             emits `_scrml_lift_el_N = document.createElement("div")` (NOT
 *             "li") and duplicates inner text nodes.
 *
 *       §B.2  `bind:value=@var` inside lift template emits a literal
 *             `setAttribute("bind:value", _scrml_reactive_get("var"))` call.
 *             No `addEventListener("input", ...)`, no two-way wiring. Diverges
 *             from top-level `bind:value=` which emits proper bind wiring.
 *
 *       §B.3  `if=@expr` inside lift template emits a literal
 *             `setAttribute("if", String(expr ?? ""))` call. No display:none
 *             toggle, no conditional rendering. Diverges from top-level `if=`.
 *
 *       §B.4  `onkeydown=fn()` (or any non-click handler, bare-call empty-args
 *             form) inside lift template does NOT auto-inject the `event`
 *             argument. The emitted call is `_scrml_fn_N()` (empty parens)
 *             instead of `_scrml_fn_N(event)`. Diverges from the top-level
 *             behavior locked in by event-handler-args-e2e.test.js §4 "bare-call
 *             onkeydown=handleKey() threads event".
 *
 *       Each §B test asserts the CURRENT BROKEN OUTPUT so the test fails when
 *       any of the four gaps is later fixed — at which point the test should
 *       be UPGRADED to assert the new (correct) output. This is a deliberate
 *       repro-anchor pattern (cf. PA primer §"latent compiler bugs surfaced").
 *
 * Scope of fix per dispatch brief: STOP when fixture editing surfaces
 * additional compiler bugs. All four §B gaps are out of scope here and
 * are surfaced for separate dispatch(es).
 *
 * Created: 2026-05-12 (S88 v0.3 TodoMVC e2e re-verify dispatch).
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

describe("§A: TodoMVC fixture (benchmarks/todomvc/app.scrml) — post Bug 5 fix", () => {
  test("compiles with zero errors (warnings allowed: W-PROGRAM-001 + 3× W-DEAD-FUNCTION + E-DG-002)", () => {
    const result = compileScrml({ inputFiles: [TODOMVC_PATH], outputDir: FIXTURE_OUTPUT, write: false });
    expect(result.errors).toEqual([]);
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
  test("§B.1 parens class:NAME=(expr) elides parent element (BROKEN; should preserve <li>)", () => {
    const result = compile(liftParensClassFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(liftParensClassFx).clientJs;
    // CURRENT BROKEN: parent element is elided; createElement("div") is emitted instead.
    // When fixed: this assertion should be flipped to require createElement("li").
    expect(js).toMatch(/document\.createElement\("div"\)/);
    expect(js).not.toMatch(/document\.createElement\("li"\)/);
  });

  test("§B.2 bind:value=@var inside lift emits literal setAttribute (BROKEN; should emit two-way wiring)", () => {
    const result = compile(liftBindValueFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(liftBindValueFx).clientJs;
    // CURRENT BROKEN: literal HTML-attr setter, no event listener.
    expect(js).toMatch(/setAttribute\("bind:value",\s*_scrml_reactive_get\("editText"\)\)/);
    // No addEventListener for "input" — confirms no two-way bind wiring.
    expect(js).not.toMatch(/addEventListener\("input"/);
  });

  test("§B.3 if=@expr inside lift emits literal setAttribute (BROKEN; should emit display toggle)", () => {
    const result = compile(liftIfExprFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(liftIfExprFx).clientJs;
    // CURRENT BROKEN: literal setAttribute("if", String(...)) call.
    expect(js).toMatch(/setAttribute\("if",\s*String\(/);
    // No style.display toggle.
    expect(js).not.toMatch(/style\.display\s*=/);
  });

  test("§B.4 onkeydown=fn() inside lift does NOT auto-inject event (BROKEN; top-level injects)", () => {
    const result = compile(liftOnKeydownFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(liftOnKeydownFx).clientJs;
    // CURRENT BROKEN: bare-call inside lift emits `_scrml_handleKey_N ( )` (no event).
    // Spaced formatting: astring inserts spaces inside ().
    expect(js).toMatch(/_scrml_handleKey_\d+\s*\(\s*\)/);
    // The correct top-level shape would be `_scrml_handleKey_N(event)`.
    expect(js).not.toMatch(/_scrml_handleKey_\d+\s*\(\s*event\s*\)/);
  });
});
