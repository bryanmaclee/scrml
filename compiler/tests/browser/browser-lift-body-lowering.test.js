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

function compileAndMount(source, baseName, { expectBootError = false, expectCodes = null } = {}) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve(tmpRoot, `case-${uniq}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, `${baseName}.scrml`);
  writeFileSync(input, source);
  const outDir = resolve(dir, "out");
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  if (expectCodes) expect(errors.map((e) => e.code)).toEqual(expectCodes);
  else expect(errors).toEqual([]);
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
  if (expectBootError) return { initError };
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

// ---------------------------------------------------------------------------
// Round 2 (adversarial review round 1 of s427). Repros:
// docs/changes/s427-lift-body-lowering/review-round1/.
// ---------------------------------------------------------------------------

const ul = (block, extra = "") => `<program>\n${CELLS}${extra}<ul>\n    \${\n${block}\n    }\n</ul>\n</program>\n`;

describe("round 2 M2 — a nested block's own declaration does not hide the loop's outer write", () => {
  for (const [label, body] of [
    ["r6 — nested `if` with its own `let n`", `            n = n + 1
            if (it.name == "zz") { let n = 99 }`],
    ["nested `for` with its own `let n`", `            n = n + 1
            for (let q of [1]) { let n = 50 }`],
    ["`else` branch with its own `let n`", `            n = n + 1
            if (it.id > 99) { let z = 1 } else { let n = 9 }`],
  ]) {
    test(`${label}: each row gets its ordinal and the counter restarts per render (was \`2:a,2:b\` keyed)`, () => {
      const app = compileAndMount(ul(`        let n = 0
        for (let it of @items) {
${body}
            lift <li class="row">\${n}:\${it.name}</li>
        }`), "m2");
      counterAssertions(app);
      app.done();
    });
  }
});

describe("round 2 L1 — a member write to an object declared outside the loop", () => {
  test("r7 — `acc.n = acc.n + 1`: each row gets its ordinal (keyed showed the final count)", () => {
    const app = compileAndMount(ul(`        const acc = { n: 0 }
        for (let it of @items) { acc.n = acc.n + 1
            lift <li class="row">\${acc.n}:\${it.name}</li> }`), "l1");
    counterAssertions(app);
    app.done();
  });
});

describe("round 2 M1 — a row-local name equal to a block-level name keeps the list keyed", () => {
  test("r5 — rows keep their element identity across push and reverse, and follow the cells", () => {
    const app = compileAndMount(ul(`        const name = @user
        lift <h4>\${name}</h4>
        for (let item of @items) {
            const name = item.name
            lift <li class="row">\${name}</li>
        }`, `<user> = "U"\n`), "m1");
    expect(rows()).toEqual(["a", "b"]);
    const first = document.querySelector("li.row");
    app.get("items").push({ id: 3, name: "c" });
    expect(rows()).toEqual(["a", "b", "c"]);
    expect(document.querySelector("li.row")).toBe(first);
    app.set("items", [...app.get("items")].reverse());
    expect(rows()).toEqual(["c", "b", "a"]);
    expect([...document.querySelectorAll("li.row")].includes(first)).toBe(true);
    app.set("user", "V");
    expect(document.querySelector("h4").textContent.trim()).toBe("V");
    app.done();
  });
});

describe("round 2 M3 — a loop lowered plain re-renders on an in-place mutation (push), not only on reassignment", () => {
  // The round-1 review reported the demoted loop going stale on `push`. That did NOT
  // reproduce with a program-produced array: every compiled `@x = …` stores
  // `_scrml_deep_reactive(…)`, whose mutations notify the group's `_scrml_effect`
  // exactly as they notify the keyed path. The stale reading came from the review
  // harness writing a RAW array through `_scrml_reactive_set` (bypassing
  // `_scrml_deep_reactive`) and then pushing onto it — the keyed path is equally
  // stale on such an array. These pin the behaviour on the arrays a program makes.
  const pushZ = (app) => app.get("items").push({ id: 3, name: "z" });
  test("top level counter", () => {
    const app = compileAndMount(`<program>\n${CELLS}<ul>\n    ${COUNTER}\n</ul>\n</program>\n`, "m3-top");
    pushZ(app);
    expect(rows()).toEqual(["1:a", "2:b", "3:z"]);
    app.done();
  });
  test("if=-mounted counter", () => {
    const app = compileAndMount(`<program>\n${CELLS}<div if=@show><ul>\n    ${COUNTER}\n</ul></div>\n</program>\n`, "m3-if");
    pushZ(app);
    expect(rows()).toEqual(["1:a", "2:b", "3:z"]);
    app.done();
  });
  test("match-arm counter", () => {
    const app = compileAndMount(`<program>\n${CELLS}\${ type Ph:enum = { A, B } }
<phase>: Ph = .A
<match for=Ph on=@phase>
    <A><ul>${COUNTER}</ul></>
    <B><p class="b">b</p></>
</>
</program>
`, "m3-arm");
    pushZ(app);
    expect(rows()).toEqual(["1:a", "2:b", "3:z"]);
    app.done();
  });
  test("destructure (plain via the mixed-hoist guard)", () => {
    const app = compileAndMount(`<program>\n${CELLS}<ul>\n    ${DESTRUCTURE}\n</ul>\n</program>\n`, "m3-destructure");
    pushZ(app);
    expect(rows()).toEqual(["P-a!", "P-b!", "P-z!"]);
    app.done();
  });
});

describe("round 2 H1 — a keywordless write to a `const` in a nested block is LOUD, never a silent shadow", () => {
  // Since #996 the type system rejects these at compile time (E-ASSIGN-004); the
  // emitted lowering underneath is still pinned to throw, not to shadow.
  for (const [label, block, codes] of [
    ["in the loop body (E-ASSIGN-004)", `        const t = 1
        for (let it of @items) { t = 5
            lift <li class="row">\${t}:\${it.name}</li> }`, ["E-ASSIGN-004"]],
    ["in an `if` beside the loop (E-ASSIGN-004)", `        const t = 1
        if (@items.length > 0) { t = 2 }
        for (let it of @items) { lift <li class="row">\${t}\${it.name}</li> }`, ["E-ASSIGN-004"]],
    ["h1k — in a logic block inside lifted markup (the type system does not see it; exit 0)", `        const total = 10
        for (let it of @items) { lift <li class="row">\${ total = 3 }\${total}:\${it.name}</li> }`, []],
  ]) {
    test(label, () => {
      const { initError } = compileAndMount(ul(block), "h1-nested", { expectBootError: true, expectCodes: codes });
      expect(initError).not.toBeNull();
      expect(String(initError)).toMatch(/readonly|read-only|constant|const/i);
    });
  }
});

describe("round 3 F1 — a write to the loop's own binder", () => {
  const S = `<items> = ["a", "b"]\n`;
  const mount = (block, name, cells = S) => compileAndMount(`<program>\n${cells}<ul>\${ ${block} }</ul>\n</program>\n`, name);
  const lis = () => [...document.querySelectorAll("li")].map((e) => e.textContent.trim());
  for (const [label, block] of [
    ["lv3 — outer `const it` of the same name", `const it = 5
    for (let it of @items) { it = it + "!"
        lift <li>\${it}</li> }`],
    ["lv7 — outer `let it` of the same name", `let it = "z"
    for (let it of @items) { it = it + "!"
        lift <li>\${it}</li> }`],
    ["lv1 — no outer binding", `for (let it of @items) { it = it + "!"
        lift <li>\${it}</li> }`],
  ]) {
    test(`${label}: the rows show the written value and follow push (was the untouched item at exit 0)`, () => {
      const app = mount(block, "f1");
      expect(lis()).toEqual(["a!", "b!"]);
      app.get("items").push("c");
      expect(lis()).toEqual(["a!", "b!", "c!"]);
      app.done();
    });
  }

  test("lv5 — a write in a nested `if` (base and main shadowed it silently)", () => {
    const app = mount(`const label = "L"
    for (let label of @items) { if (label == "a") { label = "A" }
        lift <li>\${label}</li> }`, "f1-if");
    expect(lis()).toEqual(["A", "b"]);
    app.done();
  });

  test("a destructured `[k, v]` head", () => {
    const app = mount(`let v = "z"
    for (let [k, v] of @pairs) { v = v + "!"
        lift <li>\${k}\${v}</li> }`, "f1-destr", `<pairs> = [["k1", "a"], ["k2", "b"]]\n`);
    expect(lis()).toEqual(["k1a!", "k2b!"]);
    app.done();
  });

  test("a nested rendering loop writing its own binder", () => {
    compileAndMount(`<program>\n<groups> = [{ id: 1, items: ["a", "b"] }]\n<div>\${ for (let g of @groups) { lift <ul>\${ for (let it of g.items) { it = it + "!"
        lift <li>\${it}</li> } }</ul> } }</div>\n</program>\n`, "f1-nested").done();
    expect(lis()).toEqual(["a!", "b!"]);
  });

  test("`+=` and `++` on a `let` binder take effect too", () => {
    const app = mount(`for (let it of @items) { it += "!"
        lift <li>\${it}</li> }`, "f1-pe");
    expect(lis()).toEqual(["a!", "b!"]);
    app.done();
    const app2 = mount(`for (let it of @nums) { it++
        lift <li>\${it}</li> }`, "f1-pp", `<nums> = [1, 2]\n`);
    expect(lis()).toEqual(["2", "3"]);
    app2.done();
  });

  test("a `let` binder written in a match arm (native-parsed arm body) takes effect", () => {
    compileAndMount(`<program>\n${S}\${ type Ph:enum = { A, B } }\n<phase>: Ph = .A\n<match for=Ph on=@phase>\n    <A><ul>\${ for (let it of @items) { it = it + "!"
        lift <li>\${it}</li> } }</ul></>\n    <B><p>b</p></>\n</>\n</program>\n`, "f1-arm").done();
    expect(lis()).toEqual(["a!", "b!"]);
  });
});

// ---------------------------------------------------------------------------
// Round 5 — the binder keyword of a NATIVE-parsed loop (component bodies,
// match / engine arm bodies, and the `${}` logic inside their lifted markup) comes
// from the native parser's own VarDecl `declKind`, carried by the translation
// layer (native-parser/translate-stmt.js makeForStmtInOf) — not from a scan of the
// source text. The round-4 text scan read BLOCK-relative spans as file offsets
// (both loops of a nested pair resolved to the same text), matched `let$` / a
// label / a comment wrongly. Repros: scratchpad r4v/x/.
// ---------------------------------------------------------------------------

describe("round 5 — native-parsed loop binders: `let` writes take effect, `const` / keywordless writes fail the compile", () => {
  const binderErr = (errors) => errors.find((e) => e.code === "E-CODEGEN-INVALID-LOGIC" && /loop binder/.test(e.message));
  const compileOnly = (source, name) => {
    const dir = resolve(tmpRoot, `r5-${name}-${Math.random().toString(36).slice(2, 10)}`);
    mkdirSync(dir, { recursive: true });
    const input = resolve(dir, `${name}.scrml`);
    writeFileSync(input, source);
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: resolve(dir, "out"), log: () => {} });
    return (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  };
  const comp = (loop, extra = "") => `<program>
\${
    const List = <ul props={ xs: string[] }>
        \${ ${extra}${loop}
            lift <li>\${it}</li> } }
    </>
}
<items> = ["a", "b"]
<div><List xs=@items/></div>
<div><List xs=@items/></div>
</program>
`;
  const nestComp = (outer, inner) => `<program>
\${
    const List = <div props={ gs: string[][] }>
        \${ for (${outer}g of gs) { lift <ul>\${ for (${inner}it of g) { it += "!"
            lift <li>\${it}</li> } }</ul> } }
    </>
}
<groups> = [["a", "b"], ["c"]]
<div><List gs=@groups/></div>
</program>
`;
  const arm = (loop) => `<program>
<items> = ["a", "b"]
<groups> = [["a", "b"], ["c"]]
\${ type Ph:enum = { A, B } }
<phase>: Ph = .A
<match for=Ph on=@phase>
    <A><ul>\${ ${loop}
        lift <li>\${it}</li> } }</ul></>
    <B><p>b</p></>
</>
</program>
`;
  const nestArm = (outer, inner) => `<program>
<groups> = [["a", "b"], ["c"]]
\${ type Ph:enum = { A, B } }
<phase>: Ph = .A
<match for=Ph on=@phase>
    <A><div>\${ for (${outer}g of @groups) { lift <ul>\${ for (${inner}it of g) { it += "!"
            lift <li>\${it}</li> } }</ul> } }</div></>
    <B><p>b</p></>
</>
</program>
`;
  const lis = () => [...document.querySelectorAll("li")].map((e) => e.textContent.trim());

  // [label, source, expected rows | null for "the compile fails naming the binder"]
  const CASES = [
    ["component, `let` binder", comp(`for (let it of xs) { it += "!"`), ["a!", "b!", "a!", "b!"]],
    ["component, `const` binder", comp(`for (const it of xs) { it += "!"`), null],
    ["component, keywordless binder", comp(`for (it of xs) { it += "!"`), null],
    ["component, labelled `let` loop (c_lbl)", comp(`outer: for (let it of xs) { it += "!"`), ["a!", "b!", "a!", "b!"]],
    ["component, comment in the head (c_cmt)", comp(`for (/* c */ let it of xs) { it += "!"`), ["a!", "b!", "a!", "b!"]],
    ["component, a binder NAMED `let$` (same / c_letd — keywordless)", comp(`for (let$ of xs) { let$ += "!"`).replace("${it}</li>", "${let$}</li>"), null],
    ["component, outer `let let$` + keywordless `let$` loop (c_letd)", comp(`for (let$ of xs) { let$ += "!"`, `let let$ = "o"\n            `).replace("${it}</li>", "${let$}</li>"), null],
    ["component nested: outer `const`, inner `let` (comp1 / n_b)", nestComp("const ", "let "), ["a!", "b!", "c!"]],
    ["component nested: outer `let`, inner `const` (n_a)", nestComp("let ", "const "), null],
    ["component nested: outer `let`, inner `const`, inner block padded (s28 — the text scan read the OUTER head)",
      nestComp("let ", "const ").replace("lift <ul>${ for", "lift <ul>${                            for"), null],
    ["component nested: both `let`", nestComp("let ", "let "), ["a!", "b!", "c!"]],
    ["component nested: outer `let`, inner keywordless", nestComp("let ", ""), null],
    ["match arm, `let` binder", arm(`for (let it of @items) { it += "!"`), ["a!", "b!"]],
    ["match arm, `const` binder", arm(`for (const it of @items) { it += "!"`), null],
    ["match arm, labelled `let` loop (m_lbl)", arm(`outer: for (let it of @items) { it += "!"`), ["a!", "b!"]],
    ["match arm, labelled `const` loop (m_lblc)", arm(`outer: for (const it of @items) { it += "!"`), null],
    ["match arm, binder named `letter` (keywordless)", arm(`let letter = "o"
    for (letter of @items) { letter += "!"`).replace("${it}</li>", "${letter}</li>"), null],
    ["match arm, binder named `let_` (keywordless)", arm(`for (let_ of @items) { let_ += "!"`).replace("${it}</li>", "${let_}</li>"), null],
    ["match arm, CRLF source, `let` binder (m_crlf)", arm(`for (let it of @items) { it += "!"`).replace(/\n/g, "\r\n"), ["a!", "b!"]],
    ["match arm nested: outer `const`, inner `let` (marm)", nestArm("const ", "let "), ["a!", "b!", "c!"]],
    ["match arm nested: outer `let`, inner `const`", nestArm("let ", "const "), null],
  ];
  for (const [label, source, want] of CASES) {
    test(label, () => {
      if (want === null) {
        const errors = compileOnly(source, "r5");
        const e = binderErr(errors);
        expect(e).toBeDefined();
      } else {
        compileAndMount(source, "r5").done();
        expect(lis()).toEqual(want);
      }
    });
  }
});
