/**
 * browser-lift-body-lowering.test.js —
 * g-lift-body-assignment-lowered-to-const-and-destructured-const-invisible-to-keyed-setup (HIGH).
 *
 * Two ordinary shapes compiled at exit 0 and killed the WHOLE page at boot:
 *
 *   let n = 0; for (let it of @items) { n = n + 1; lift <li>${n}:${it}</li> }
 *     → emitted `const n = n + 1;` → ReferenceError: Cannot access 'n' before initialization
 *   const { prefix, suffix } = @cfg; for (let it of @items) { lift <li>${prefix}…</li> }
 *     → the keyed setup hoisted out of the effect → ReferenceError: prefix is not defined
 *
 * and their siblings rendered WRONG values silently (`n += 1` / `n++` in a keyed body:
 * every row showed the final count; `lift …; n = n + 1`: the rebind was dropped).
 *
 * These tests MOUNT the compiled output in happy-dom (runtime + client in one scope, as
 * the two classic <script>s run), assert the rendered DOM, then drive reactive updates:
 * the counter restarts on every re-render and follows row order; destructured names
 * follow `@cfg`. Top level, `if=`-mounted, match arm and `<each>` row variants.
 *
 * Emit-shape pins: compiler/tests/unit/lift-body-lowering-s427.test.js.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-lift-body-lowering");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve(tmpRoot, `case-${uniq}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, `${baseName}.scrml`);
  writeFileSync(input, source);
  const outDir = resolve(dir, "out");
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  expect(errors).toEqual([]);
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeName = /scrml-runtime\.[A-Za-z0-9]+\.js/.exec(html)?.[0] ?? result.runtimeFilename ?? "scrml-runtime.js";
  const runtimeJs = readFileSync(resolve(outDir, runtimeName), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const consoleErrors = [];
  const origError = console.error;
  console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
  let initError = null;
  try {
    new Function(
      "window",
      "document",
      `${runtimeJs}\n` +
        captureInsideChunkScope(clientJs, "globalThis.__lb_get = _scrml_reactive_get; globalThis.__lb_set = _scrml_reactive_set;\n"),
    )(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  } catch (e) {
    initError = e;
  } finally {
    console.error = origError;
  }
  expect(initError).toBeNull();
  expect(consoleErrors).toEqual([]);
  const later = [];
  console.error = (...a) => { later.push(a.map(String).join(" ")); };
  return {
    get: (n) => globalThis.__lb_get(n),
    set: (n, v) => globalThis.__lb_set(n, v),
    done: () => { console.error = origError; expect(later).toEqual([]); },
  };
}

const rows = (sel = "li.row") => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());

const CELLS = `<items> = [{ id: 1, name: "a" }, { id: 2, name: "b" }]
<cfg> = { prefix: "P-", suffix: "!" }
<show> = true
`;

const COUNTER = `\${
        let n = 0
        for (let it of @items) {
            n = n + 1
            lift <li class="row">\${n}:\${it.name}</li>
        }
    }`;
const DESTRUCTURE = `\${
        const { prefix, suffix } = @cfg
        for (let it of @items) {
            lift <li class="row">\${prefix}\${it.name}\${suffix}</li>
        }
    }`;

/** The two brief shapes, driven through the same assertions at every host. */
function counterAssertions(app) {
  expect(rows()).toEqual(["1:a", "2:b"]);
  app.set("items", [...app.get("items"), { id: 3, name: "z" }]);
  expect(rows()).toEqual(["1:a", "2:b", "3:z"]);
  // The counter RESTARTS on every render and follows row order.
  app.set("items", [{ id: 3, name: "z" }, { id: 1, name: "a" }]);
  expect(rows()).toEqual(["1:z", "2:a"]);
}
function destructureAssertions(app) {
  expect(rows()).toEqual(["P-a!", "P-b!"]);
  app.set("cfg", { prefix: "Q-", suffix: "?" });
  expect(rows()).toEqual(["Q-a?", "Q-b?"]);
  app.set("items", [...app.get("items"), { id: 3, name: "z" }]);
  expect(rows()).toEqual(["Q-a?", "Q-b?", "Q-z?"]);
}

describe("top level — the brief repros boot and stay correct", () => {
  test("running counter `n = n + 1` in a reactive for-lift", () => {
    const app = compileAndMount(`<program>\n${CELLS}<ul>\n    ${COUNTER}\n</ul>\n</program>\n`, "counter");
    counterAssertions(app);
    app.done();
  });

  test("destructured config `const { prefix, suffix } = @cfg`", () => {
    const app = compileAndMount(`<program>\n${CELLS}<ul>\n    ${DESTRUCTURE}\n</ul>\n</program>\n`, "destructure");
    destructureAssertions(app);
    app.done();
  });

  for (const [label, stmt] of [["n += 1", "n += 1"], ["n++", "n++"], ["nested if", "if (it.id > 0) { n = n + 1 }"]]) {
    test(`counter via ${label} — each row gets its ordinal (keyed lowering showed the final count)`, () => {
      const app = compileAndMount(`<program>\n${CELLS}<ul>
    \${
        let n = 0
        for (let it of @items) {
            ${stmt}
            lift <li class="row">\${n}:\${it.name}</li>
        }
    }
</ul>\n</program>\n`, "counter-variant");
      counterAssertions(app);
      app.done();
    });
  }

  test("`lift …; n = n + 1` — the rebind after the lift runs (it was dropped)", () => {
    const app = compileAndMount(`<program>\n${CELLS}<ul>
    \${
        let n = 0
        for (let it of @items) {
            lift <li class="row">\${n}:\${it.name}</li>
            n = n + 1
        }
    }
</ul>\n</program>\n`, "after");
    expect(rows()).toEqual(["0:a", "1:b"]);
    app.set("items", [...app.get("items"), { id: 3, name: "z" }]);
    expect(rows()).toEqual(["0:a", "1:b", "2:z"]);
    app.done();
  });

  test("a body-local `let m` rebound in a keyed body (was a duplicate declaration)", () => {
    const app = compileAndMount(`<program>\n${CELLS}<ul>
    \${
        for (let it of @items) {
            let m = 10
            m = m + it.id
            lift <li class="row">\${m}</li>
        }
    }
</ul>\n</program>\n`, "body-let");
    expect(rows()).toEqual(["11", "12"]);
    app.set("items", [...app.get("items"), { id: 5, name: "z" }]);
    expect(rows()).toEqual(["11", "12", "15"]);
    app.done();
  });

  test("a counter inside a logic block of lifted markup follows its own list", () => {
    const app = compileAndMount(`<program>\n${CELLS}<arr> = ["x"]\n<ul>
    \${
        for (let it of @items) {
            lift <li class="row">\${it.name}\${ let c = 0
                for (let x of @arr) { c = c + 1
                    lift <b>\${c}</b> } }</li>
        }
    }
</ul>\n</program>\n`, "in-markup");
    expect(rows()).toEqual(["a1", "b1"]);
    app.set("arr", ["x", "y"]);
    expect(rows()).toEqual(["a12", "b12"]);
    app.done();
  });

  test("a static const read by rows in a block that also reads state (mixed hoist)", () => {
    const app = compileAndMount(`<program>\n${CELLS}<ul>
    \${
        const pre = "S-"
        for (let it of @items) {
            lift <li class="row">\${pre}\${it.name}\${@cfg.suffix}</li>
        }
    }
</ul>\n</program>\n`, "static-mixed");
    expect(rows()).toEqual(["S-a!", "S-b!"]);
    app.set("cfg", { prefix: "Q-", suffix: "?" });
    expect(rows()).toEqual(["S-a?", "S-b?"]);
    app.done();
  });
});

describe("if=-mounted host", () => {
  test("counter: boots, restarts per render, survives an unmount/remount", () => {
    const app = compileAndMount(`<program>\n${CELLS}<div if=@show><ul>\n    ${COUNTER}\n</ul></div>\n</program>\n`, "if-counter");
    counterAssertions(app);
    app.set("show", false);
    expect(rows()).toEqual([]);
    app.set("show", true);
    expect(rows()).toEqual(["1:z", "2:a"]);
    app.done();
  });

  test("destructure: follows @cfg, survives an unmount/remount", () => {
    const app = compileAndMount(`<program>\n${CELLS}<div if=@show><ul>\n    ${DESTRUCTURE}\n</ul></div>\n</program>\n`, "if-destructure");
    destructureAssertions(app);
    app.set("show", false);
    app.set("show", true);
    expect(rows()).toEqual(["Q-a?", "Q-b?", "Q-z?"]);
    app.done();
  });
});

describe("match arm host", () => {
  const ARM = (block) => `<program>\n${CELLS}\${ type Ph:enum = { A, B } }
<phase>: Ph = .A
<match for=Ph on=@phase>
    <A><ul>${block}</ul></>
    <B><p class="b">b</p></>
</>
</program>
`;
  test("counter in an arm: boots, restarts per render, re-enters fresh", () => {
    const app = compileAndMount(ARM(COUNTER), "arm-counter");
    counterAssertions(app);
    app.set("phase", "B");
    expect(rows()).toEqual([]);
    app.set("phase", "A");
    expect(rows()).toEqual(["1:z", "2:a"]);
    app.done();
  });

  test("destructure in an arm follows @cfg", () => {
    const app = compileAndMount(ARM(DESTRUCTURE), "arm-destructure");
    destructureAssertions(app);
    app.done();
  });
});

describe("<each> row host (block-level let/const are E-EACH-BODY-DECL-UNSUPPORTED there, §17.7.3)", () => {
  test("a counter local to the loop body, per row", () => {
    const app = compileAndMount(`<program>
<groups> = [{ id: 1, items: [{ id: 1, name: "a" }, { id: 2, name: "b" }] }, { id: 2, items: [{ id: 3, name: "c" }] }]
<div>
    <each in=@groups key=@.id as g>
        <ul class="g">
            \${ for (let it of g.items) {
                let m = 0
                m = m + it.id
                lift <li class="row">\${m}</li>
            } }
        </ul>
    </each>
</div>
</program>
`, "each-row");
    expect(rows()).toEqual(["1", "2", "3"]);
    app.get("groups")[0].items.push({ id: 7, name: "q" });
    expect([...document.querySelectorAll("ul.g")].map((u) => [...u.querySelectorAll("li")].map((l) => l.textContent.trim()))).toEqual([["1", "2", "7"], ["3"]]);
    app.done();
  });
});
