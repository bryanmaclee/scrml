/**
 * g-nested-for-lift-no-reconcile-on-cell-replace (HIGH, S288) — runtime gate.
 *
 * Outer `${ for (e of @engines) { lift ... } }` whose per-item body contains an
 * INNER `${ for (s of e.states) { lift <li> } }`. When @engines is REPLACED (a
 * new array assigned, not mutated in place) and the outer reconcile REUSES DOM
 * nodes (index keys match), the outer `<h3>` name updates but the inner state
 * `<li>`s stay STALE — the inner for-lift is emitted as a one-shot creation-time
 * loop with no reconcile of its own. Silent wrong-render. (Executed-DOM — codegen
 * inspection cannot see this; models each-in-tier0-lift-bug72.browser.test.js.)
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const SRC = `<program>
type Engine:struct = { name: string, states: string[] }
<engines>: Engine[] = []
<div id="root">
  \${ for (let e of @engines) {
    lift <div class="eng"><h3>\${e.name}</h3><ul>\${ for (let s of e.states) { lift <li>\${s}</li>; } }</ul></div>;
  } }
</div>
</program>
`;

const MARIO = [
  { name: "mario", states: ["Big", "Cape", "Fire", "Small"] },
  { name: "luigi", states: ["Big", "Cape", "Fire", "Small"] },
];
const TRIAGE = [
  { name: "drag", states: ["Idle", "Dragging"] },
  { name: "drop", states: ["Idle", "Dragging"] },
];

// Fresh deep copy per set() so the in-place-mutation cases (4/4b) never corrupt
// the shared MARIO/TRIAGE fixtures for later tests (test isolation).
const clone = (x) => JSON.parse(JSON.stringify(x));

const tmpRoot = resolve("/tmp", "scrml-gap2-nested-for-lift");
function compileOut(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  rmSync(tmpDir, { recursive: true, force: true });
  return { errors: result.errors ?? [], html, clientJs, runtimeJs };
}

describe("gap2 nested for-lift reconcile on cell REPLACE", () => {
  beforeEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} GlobalRegistrator.register(); });
  afterEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileOut(source, baseName);
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        `globalThis.__scrml_rx__ = _scrml_deep_reactive;\n`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (n, v) => globalThis.__scrml_set__(n, v),
      get: (n) => globalThis.__scrml_get__(n),
      // Deep-reactive view of a cell — the handle through which in-place field /
      // array mutation (`@coll[i].f = x`, `@coll[i].arr.push(y)`) is reactive.
      // `_scrml_reactive_get` returns the RAW stored value; scrml's compiled
      // in-place writes go through the deep-reactive proxy (proxy-cached per raw
      // object, so it shares subscription identity with `_scrml_resolve_item`).
      rx: (n) => globalThis.__scrml_rx__(globalThis.__scrml_get__(n)),
      names: () => [...document.querySelectorAll("#root h3")].map((n) => n.textContent.trim()),
      states: () => [...document.querySelectorAll("#root li")].map((n) => n.textContent.trim()),
    };
  }

  test("REPLACE @engines mario→triage — inner state lists must update", () => {
    const app = mount(SRC, "repro");
    app.set("engines", clone(MARIO));
    expect(app.names()).toEqual(["mario", "luigi"]);
    expect(app.states()).toEqual(["Big","Cape","Fire","Small","Big","Cape","Fire","Small"]);
    // The bug: REPLACE (not mutate) the outer cell.
    app.set("engines", clone(TRIAGE));
    expect(app.names()).toEqual(["drag", "drop"]);          // outer updates?
    expect(app.states()).toEqual(["Idle","Dragging","Idle","Dragging"]);  // inner updates?
  });

  // ── Bug-CLASS coverage (S288): prove the fix generalizes, not just the repro ──

  // Case 1 — REPLACE with a DIFFERENT inner-count (4 states → 2 states). The
  // inner <li> COUNT must shrink 8→4 (index-keyed inner reconcile removes the
  // trailing nodes), and the surviving nodes must show the NEW values.
  test("case1: index-keyed REPLACE changes inner count (8→4) and values", () => {
    const app = mount(SRC, "repro");
    app.set("engines", clone(MARIO));
    expect(app.states().length).toBe(8);
    app.set("engines", clone(TRIAGE));
    expect(app.states().length).toBe(4);
    expect(app.states()).toEqual(["Idle","Dragging","Idle","Dragging"]);
  });

  // Case 2 — id-KEYED outer list. Give engines an `id`; replace with NEW ids.
  // Outer keys differ so outer nodes are recreated, but the inner reconcile must
  // still be correct. (Also proves the fix does not depend on index reuse.)
  const SRC_ID = `<program>
type Engine:struct = { id: string, name: string, states: string[] }
<engines>: Engine[] = []
<div id="root">
  \${ for (let e of @engines) {
    lift <div class="eng"><h3>\${e.name}</h3><ul>\${ for (let s of e.states) { lift <li>\${s}</li>; } }</ul></div>;
  } }
</div>
</program>
`;
  test("case2: id-keyed outer REPLACE — inner lists correct under new ids", () => {
    const app = mount(SRC_ID, "repro-id");
    app.set("engines", [
      { id: "a", name: "mario", states: ["Big", "Cape", "Fire", "Small"] },
      { id: "b", name: "luigi", states: ["Big", "Cape", "Fire", "Small"] },
    ]);
    expect(app.names()).toEqual(["mario", "luigi"]);
    expect(app.states().length).toBe(8);
    // Replace with wholly NEW ids (outer nodes recreated) + different counts.
    app.set("engines", [
      { id: "c", name: "drag", states: ["Idle", "Dragging"] },
      { id: "d", name: "drop", states: ["Idle", "Dragging"] },
    ]);
    expect(app.names()).toEqual(["drag", "drop"]);
    expect(app.states()).toEqual(["Idle","Dragging","Idle","Dragging"]);
  });

  // Case 2b — id-keyed outer REPLACE that REUSES ids but swaps inner states
  // (same outer key → outer node reused, inner must still update). This is the
  // id-keyed analog of the index-keyed reuse that caused the original bug.
  test("case2b: id-keyed REPLACE reusing ids — inner still updates", () => {
    const app = mount(SRC_ID, "repro-id");
    app.set("engines", [
      { id: "a", name: "mario", states: ["Big", "Cape"] },
      { id: "b", name: "luigi", states: ["Small"] },
    ]);
    expect(app.states()).toEqual(["Big","Cape","Small"]);
    // Same ids (a,b) → outer nodes reused; inner states swapped + resized.
    app.set("engines", [
      { id: "a", name: "mario", states: ["Fire"] },
      { id: "b", name: "luigi", states: ["Idle","Dragging","X"] },
    ]);
    expect(app.names()).toEqual(["mario", "luigi"]);
    expect(app.states()).toEqual(["Fire","Idle","Dragging","X"]);
  });

  // Case 3 — DEEPER nesting: for-lift → for-lift → for-lift (3 levels). Replace
  // the outer cell and confirm the innermost list rebuilds. Index-keyed at every
  // level (no ids), so every level relies on the reuse-driven inner reconcile.
  const SRC_3 = `<program>
type Grp:struct = { name: string, rows: string[][] }
<grps>: Grp[] = []
<div id="root">
  \${ for (let g of @grps) {
    lift <section><h3>\${g.name}</h3><div class="rows">\${ for (let r of g.rows) { lift <div class="row"><ul>\${ for (let c of r) { lift <li>\${c}</li>; } }</ul></div>; } }</div></section>;
  } }
</div>
</program>
`;
  test("case3: 3-level nested for-lift rebuilds innermost on outer REPLACE", () => {
    const cells = () => [...document.querySelectorAll("#root li")].map((n) => n.textContent.trim());
    const app = mount(SRC_3, "repro3");
    app.set("grps", [
      { name: "g1", rows: [["a", "b"], ["c"]] },
    ]);
    expect(cells()).toEqual(["a", "b", "c"]);
    // REPLACE the whole outer cell with new objects + different shapes.
    app.set("grps", [
      { name: "g2", rows: [["x"], ["y", "z", "w"]] },
    ]);
    expect(app.names()).toEqual(["g2"]);
    expect(cells()).toEqual(["x", "y", "z", "w"]);
  });

  // Case 4 — MUTATE-in-place: replace ONE engine's states field with a new array
  // (@engines[0].states = [...]) — a deep field set on the LIVE cell, NOT a full
  // cell replace. The inner list for that engine must re-render; siblings intact.
  test("case4: in-place field set of one engine's states re-renders inner", () => {
    const app = mount(SRC, "repro");
    app.set("engines", clone(MARIO));
    expect(app.states().length).toBe(8);
    const live = app.rx("engines"); // deep-reactive handle (the reactive path)
    live[0].states = ["ONE", "TWO", "THREE"]; // deep field set, in place
    expect(app.states()).toEqual(["ONE","TWO","THREE","Big","Cape","Fire","Small"]);
  });

  // Case 4b — true in-place PUSH onto a live engine's states array. Requires the
  // reactive getter; drives the `.length` subscription in the emitted render fn.
  test("case4b: in-place push onto a live engine's states array re-renders", () => {
    const app = mount(SRC, "repro");
    app.set("engines", clone(MARIO));
    expect(app.states().length).toBe(8);
    const live = app.rx("engines"); // deep-reactive handle (the reactive path)
    expect(Array.isArray(live)).toBe(true);
    live[0].states.push("Star"); // deep in-place mutation through the proxy
    expect(app.states()).toEqual(["Big","Cape","Fire","Small","Star","Big","Cape","Fire","Small"]);
  });

  // Case 6 — empty→refill: the adopter's `[]`-clear-first workaround must STILL
  // work AND the direct replace (no clear) must now also work.
  test("case6: empty→refill works AND direct replace works", () => {
    const app = mount(SRC, "repro");
    app.set("engines", clone(MARIO));
    expect(app.states().length).toBe(8);
    app.set("engines", []); // clear
    expect(app.states()).toEqual([]);
    app.set("engines", clone(TRIAGE)); // refill after clear (the workaround)
    expect(app.states()).toEqual(["Idle","Dragging","Idle","Dragging"]);
    // Direct replace with no intervening clear (the bug the fix closes).
    app.set("engines", clone(MARIO));
    expect(app.states()).toEqual(["Big","Cape","Fire","Small","Big","Cape","Fire","Small"]);
  });

  // ── S288 adversarial-review follow-ups (FINDING 1 + FINDING 2) ───────────────

  // FINDING 1 — item-derived local ALIAS. The outer factory aliases the item's
  // collection into a local (`let sts = e.states`) BEFORE the inner for iterates
  // it. The inner iterable (`sts`) names no ancestor iter var directly, so the
  // pre-fix predicate missed it → one-shot loop → stale on REPLACE. The fix
  // replays the item-derived local inside the inner reactive render fn.
  const SRC_ALIAS = `<program>
type Engine:struct = { name: string, states: string[] }
<engines>: Engine[] = []
<div id="root">
  \${ for (let e of @engines) {
    let sts = e.states;
    lift <div class="eng"><h3>\${e.name}</h3><ul>\${ for (let s of sts) { lift <li>\${s}</li>; } }</ul></div>;
  } }
</div>
</program>
`;
  test("finding1: item-derived local alias re-renders inner on REPLACE", () => {
    const app = mount(SRC_ALIAS, "repro-alias");
    app.set("engines", clone(MARIO));
    expect(app.names()).toEqual(["mario", "luigi"]);
    expect(app.states()).toEqual(["Big","Cape","Fire","Small","Big","Cape","Fire","Small"]);
    app.set("engines", clone(TRIAGE)); // REPLACE (index-keyed reuse)
    expect(app.names()).toEqual(["drag", "drop"]);
    expect(app.states()).toEqual(["Idle","Dragging","Idle","Dragging"]);
  });

  // FINDING 1b — TRANSITIVE local alias: `let a = e.states; let b = a;` then
  // `for (s of b)`. The fix must pull the whole transitive chain (b → a → e).
  const SRC_ALIAS2 = `<program>
type Engine:struct = { name: string, states: string[] }
<engines>: Engine[] = []
<div id="root">
  \${ for (let e of @engines) {
    let a = e.states;
    let b = a;
    lift <div class="eng"><h3>\${e.name}</h3><ul>\${ for (let s of b) { lift <li>\${s}</li>; } }</ul></div>;
  } }
</div>
</program>
`;
  test("finding1b: transitive local alias (b→a→e) re-renders inner on REPLACE", () => {
    const app = mount(SRC_ALIAS2, "repro-alias2");
    app.set("engines", clone(MARIO));
    expect(app.states().length).toBe(8);
    app.set("engines", clone(TRIAGE));
    expect(app.names()).toEqual(["drag", "drop"]);
    expect(app.states()).toEqual(["Idle","Dragging","Idle","Dragging"]);
  });

  // FINDING 2 — GRANDPARENT reference in a 3-level nest. The innermost for
  // iterates a NON-immediate ancestor's collection (`for (c of g.rows)`, where
  // `g` is the grandparent). The pre-fix predicate tested only the innermost ctx
  // (`r`), missing `g` → one-shot loop → stale on REPLACE of @grps. The fix scans
  // the whole ctx stack and re-resolves the matched grandparent.
  const SRC_GP = `<program>
type Grp:struct = { tag: string, rows: string[] }
<grps>: Grp[] = []
<div id="root">
  \${ for (let g of @grps) {
    lift <section><h3>\${g.tag}</h3><div>\${ for (let r of g.rows) { lift <div class="mid">\${ for (let c of g.rows) { lift <li>\${c}</li>; } }</div>; } }</div></section>;
  } }
</div>
</program>
`;
  test("finding2: grandparent reference in 3-level nest re-renders on REPLACE", () => {
    const tags = () => [...document.querySelectorAll("#root h3")].map((n) => n.textContent.trim());
    const lis = () => [...document.querySelectorAll("#root li")].map((n) => n.textContent.trim());
    const app = mount(SRC_GP, "repro-gp");
    app.set("grps", [{ tag: "g1", rows: ["a", "b"] }]);
    // outer 1 group; middle iterates g.rows (2) → 2 <div.mid>; innermost iterates
    // g.rows (2) per middle → 2×2 = 4 <li>.
    expect(tags()).toEqual(["g1"]);
    expect(lis()).toEqual(["a", "b", "a", "b"]);
    // REPLACE @grps with new objects + different g.rows.
    app.set("grps", [{ tag: "g2", rows: ["x", "y", "z"] }]);
    expect(tags()).toEqual(["g2"]);
    expect(lis()).toEqual(["x", "y", "z", "x", "y", "z", "x", "y", "z"]);
  });

  // ── S288 review-2 follow-ups: detection for all let/const decl SHAPES ─────────
  // Root cause: scanItemDerivedLocals only recorded string-name + string-init
  // decls; these three shapes were silently skipped → inner for-lift stayed a
  // one-shot loop → stale on REPLACE. Replay was already sound; only detection
  // needed widening.

  // FINDING 1 (review-2) — OBJECT destructuring of the item: `let { states } = e`.
  const SRC_ODES = `<program>
type Engine:struct = { name: string, states: string[] }
<engines>: Engine[] = []
<div id="root">
  \${ for (let e of @engines) {
    let { states } = e;
    lift <div class="eng"><h3>\${e.name}</h3><ul>\${ for (let s of states) { lift <li>\${s}</li>; } }</ul></div>;
  } }
</div>
</program>
`;
  test("r2-finding1: object-destructure { states } = e re-renders on REPLACE", () => {
    const app = mount(SRC_ODES, "repro-odes");
    app.set("engines", clone(MARIO));
    expect(app.states()).toEqual(["Big","Cape","Fire","Small","Big","Cape","Fire","Small"]);
    app.set("engines", clone(TRIAGE)); // REPLACE (index-keyed reuse)
    expect(app.names()).toEqual(["drag", "drop"]);
    expect(app.states()).toEqual(["Idle","Dragging","Idle","Dragging"]);
  });

  // FINDING 2 (review-2) — ARRAY/REST destructuring: `let [first, ...rest] = e.states`.
  // NB: h3 uses `${e.name}` (iter var), NOT a destructured local, to isolate the
  // INNER-for-lift detection under test. A per-item TEXT binding over a
  // destructured local (`<h3>${first}</h3>`) exercises a SEPARATE code path
  // (maybeWrapLiftPerItemEffect re-resolves only the iter var, not item-derived
  // locals) — a distinct residual reported alongside, out of scope for the inner
  // for-lift reconcile detection this review targets.
  const SRC_ADES = `<program>
type Engine:struct = { name: string, states: string[] }
<engines>: Engine[] = []
<div id="root">
  \${ for (let e of @engines) {
    let [ first, ...rest ] = e.states;
    lift <div class="eng"><h3>\${e.name}</h3><ul>\${ for (let s of rest) { lift <li>\${s}</li>; } }</ul></div>;
  } }
</div>
</program>
`;
  test("r2-finding2: array/rest-destructure [first, ...rest] drives inner list on REPLACE", () => {
    const app = mount(SRC_ADES, "repro-ades");
    app.set("engines", clone(MARIO));
    // inner list shows `rest` (Cape,Fire,Small) × 2 engines.
    expect(app.names()).toEqual(["mario", "luigi"]);
    expect(app.states()).toEqual(["Cape","Fire","Small","Cape","Fire","Small"]);
    app.set("engines", clone(TRIAGE)); // REPLACE (index-keyed reuse); rest is [Dragging]
    expect(app.names()).toEqual(["drag", "drop"]);
    expect(app.states()).toEqual(["Dragging","Dragging"]);
  });

  // FINDING 3 (review-2) — EXPR-FORM init (empty node.init): a for-expression that
  // accumulates raw values into the local (`let ups = for (s of e.states) { lift s }`).
  const SRC_EXPR = `<program>
type Engine:struct = { name: string, states: string[] }
<engines>: Engine[] = []
<div id="root">
  \${ for (let e of @engines) {
    let ups = for (let s of e.states) { lift s };
    lift <div class="eng"><h3>\${e.name}</h3><ul>\${ for (let u of ups) { lift <li>\${u}</li>; } }</ul></div>;
  } }
</div>
</program>
`;
  test("r2-finding3: expr-form init (for-expression) re-renders on REPLACE", () => {
    const app = mount(SRC_EXPR, "repro-expr");
    app.set("engines", clone(MARIO));
    expect(app.states()).toEqual(["Big","Cape","Fire","Small","Big","Cape","Fire","Small"]);
    app.set("engines", clone(TRIAGE)); // REPLACE (index-keyed reuse)
    expect(app.names()).toEqual(["drag", "drop"]);
    expect(app.states()).toEqual(["Idle","Dragging","Idle","Dragging"]);
  });

  // FINDING 4 (review-2) — nested-destructure + TRANSITIVE combo:
  // `let { states } = e; let top = states.slice(0, 1);` then `for (s of top)`.
  // The closure must pull top → states → e (the destructure decl AND its dependent).
  const SRC_TRANS = `<program>
type Engine:struct = { name: string, states: string[] }
<engines>: Engine[] = []
<div id="root">
  \${ for (let e of @engines) {
    let { states } = e;
    let top = states.slice(0, 1);
    lift <div class="eng"><h3>\${e.name}</h3><ul>\${ for (let s of top) { lift <li>\${s}</li>; } }</ul></div>;
  } }
</div>
</program>
`;
  test("r2-finding4: destructure + transitive alias (top→states→e) re-renders", () => {
    const app = mount(SRC_TRANS, "repro-trans");
    app.set("engines", clone(MARIO));
    // top = states.slice(0,1) = ["Big"] per engine → 2 <li> total.
    expect(app.states()).toEqual(["Big","Big"]);
    app.set("engines", clone(TRIAGE)); // REPLACE; top = ["Idle"] per engine
    expect(app.names()).toEqual(["drag", "drop"]);
    expect(app.states()).toEqual(["Idle","Idle"]);
  });
});
