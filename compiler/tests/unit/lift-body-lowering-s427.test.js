/**
 * lift-body-lowering-s427.test.js — emitted-shape pins for
 * g-lift-body-assignment-lowered-to-const-and-destructured-const-invisible-to-keyed-setup (HIGH).
 *
 * Every shape below compiled at exit 0 and killed the page at boot (or rendered wrong
 * values) before the fix. Governing: SPEC §7.2 (the content of `${}` is JavaScript —
 * a destructuring declaration is ordinary logic-context content, so it RENDERS),
 * §50.7 / §50.9 (an assignment compiles to a direct JavaScript assignment), §7.6
 * (a top-level `let`/`const` of a file-level `${}` block is file scope).
 *
 * Four causes, one class ("the binding semantics of a lift body are not preserved"):
 *   1. Step 4b emitted every top-level statement with NO declared-name set, and every
 *      lift-body emitter dropped it, so a keywordless `n = n + 1` (a `tilde-decl`)
 *      after `let n` lowered to `const n = n + 1` (TDZ at boot; a duplicate-declaration
 *      codegen error at the same level).
 *   2. A body whose first `lift` has a complete markup AST was routed to the
 *      consolidated emitter whenever a later statement looked like a fragment
 *      (`n = n + 1` after the lift) — and that emitter drops everything after the lift.
 *   3. A keyed reconcile of a body that writes an outer binding: the factory runs once
 *      per NEW key against a shared counter that never restarts (every row showed the
 *      final count). Such a loop now lowers plain; the group's effect re-runs it.
 *   4. The mixed-case hoist moved a keyed factory out of the group effect while the
 *      block's declarations stayed inside (`prefix is not defined`). Such a loop now
 *      lowers plain too.
 *
 * Behavioural (mounted) pins: compiler/tests/browser/browser-lift-body-lowering.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "lift-body-s427-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const abs = join(TMP, `case-${++seq}.scrml`);
  writeFileSync(abs, source);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  const errors = (result.errors || []).filter((e) => (e.severity ?? "error") === "error");
  const out = [...(result.outputs || new Map()).values()][0];
  return { errors, js: out?.clientJs ?? "" };
}

const prog = (body, cells = "") => `<program>
<items> = [{ id: 1, name: "a" }, { id: 2, name: "b" }]
<cfg> = { prefix: "P-", suffix: "!" }
${cells}${body}
</program>
`;

describe("a rebind of an enclosing `let` stays an assignment", () => {
  test("the brief's counter: `n = n + 1` in a reactive for-lift body", () => {
    const { errors, js } = compile(prog(`<ul>
    \${
        let n = 0
        for (let it of @items) {
            n = n + 1
            lift <li class="row">\${n}:\${it.name}</li>
        }
    }
</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain("n = n + 1;");
    expect(js).not.toContain("const n = n + 1");
    // Impure body → the plain loop, re-run whole by the group's effect (no keyed factory).
    expect(js).not.toContain("_scrml_reconcile_list(");
    expect(js).toContain('for (const it of _scrml_cs_reactive_get("items"))');
    expect(js).toMatch(/_scrml_effect\(function\(\) \{[\s\S]*let n = 0;[\s\S]*for \(const it of _scrml_cs_reactive_get\("items"\)\)/);
  });

  test("a non-reactive iterable and a non-lift loop at top level (the same TDZ, no lift involved)", () => {
    const { errors, js } = compile(prog(`\${
    let n = 0
    for (let it of [1, 2]) { n = n + 1 }
    let k = 0
    k = k + 1
}
<p>x</p>`));
    expect(errors).toEqual([]);
    expect(js).toContain("n = n + 1;");
    expect(js).toContain("k = k + 1;");
    expect(js).not.toMatch(/const [nk] = [nk] \+ 1/);
  });

  test("a later `${}` block rebinds a name an earlier block declared at file scope (§7.6)", () => {
    const { errors, js } = compile(prog(`\${ let total = 0 }
\${ for (let it of [1, 2]) { total = total + it } }
<p>x</p>`));
    expect(errors).toEqual([]);
    expect(js).toContain("total = total + it;");
    expect(js).not.toContain("const total = total + it");
  });

  test("`let m` declared and rebound INSIDE a keyed body (was a duplicate `const m`)", () => {
    const { errors, js } = compile(prog(`<ul>
    \${
        for (let it of @items) {
            let m = 0
            m = m + it.id
            lift <li class="row">\${m}</li>
        }
    }
</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain("let m = 0;");
    expect(js).toContain("m = m + it.id;");
    // A body-LOCAL rebind is pure: the loop stays keyed.
    expect(js).toContain("_scrml_reconcile_list(");
  });

  test("a counter in a logic block INSIDE lifted markup", () => {
    const { errors, js } = compile(prog(`<ul>
    \${
        for (let it of @items) {
            lift <li class="row">\${it.name}\${ let c = 0
                for (let x of @items) { c = c + 1
                    lift <b>\${c}</b> } }</li>
        }
    }
</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain("c = c + 1;");
    expect(js).not.toContain("const c = c + 1");
  });
});

describe("a statement after the lift is lowered, not dropped", () => {
  test("`lift …; n = n + 1` keeps the rebind (the consolidated path dropped it)", () => {
    const { errors, js } = compile(prog(`<ul>
    \${
        let n = 0
        for (let it of [{ id: 1, name: "a" }, { id: 2, name: "b" }]) {
            lift <li class="row">\${n}:\${it.name}</li>
            n = n + 1
        }
    }
</ul>`));
    expect(errors).toEqual([]);
    const loop = js.slice(js.indexOf("for (const it of"));
    expect(loop.indexOf("_scrml_lift(")).toBeGreaterThan(-1);
    expect(loop.indexOf("n = n + 1;")).toBeGreaterThan(loop.indexOf("_scrml_lift("));
  });
});

describe("keyed reconciliation only for a pure per-item body", () => {
  for (const [label, stmt] of [["compound `n += 1`", "n += 1"], ["update `n++`", "n++"], ["nested `if` rebind", "if (it.id > 0) { n = n + 1 }"]]) {
    test(`${label} → plain loop`, () => {
      const { errors, js } = compile(prog(`<ul>
    \${
        let n = 0
        for (let it of @items) {
            ${stmt}
            lift <li class="row">\${n}:\${it.name}</li>
        }
    }
</ul>`));
      expect(errors).toEqual([]);
      expect(js).not.toContain("_scrml_reconcile_list(");
      expect(js).toContain('for (const it of _scrml_cs_reactive_get("items"))');
    });
  }

  test("control: a pure body keeps the keyed reconcile, byte-shape unchanged", () => {
    const { errors, js } = compile(prog(`<ul>
    \${
        for (let it of @items) {
            lift <li class="row">\${it.name}</li>
        }
    }
</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain('_scrml_reconcile_list(_scrml_list_wrapper_');
    expect(js).toContain("_scrml_effect_static(_scrml_render_list_");
    expect(js).not.toContain('for (const it of _scrml_cs_reactive_get("items"))');
  });

  test("control: a write inside an event handler is not a render-time write (stays keyed)", () => {
    const { errors, js } = compile(prog(`\${ let sel = 0 }
<ul>
    \${
        for (let it of @items) {
            lift <li class="row" onclick=\${() => { sel = it.id }}>\${it.name}</li>
        }
    }
</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain("_scrml_reconcile_list(");
  });
});

describe("the mixed-case hoist never strands a block declaration", () => {
  for (const [label, decl, li] of [
    ["object destructuring (the brief)", "const { prefix, suffix } = @cfg", "${prefix}${it.name}${suffix}"],
    ["array destructuring", "const [first] = @arr", "${first}${it.name}"],
    ["nested destructuring", "const { deep: { tag } } = @cfg2", "${tag}${it.name}"],
    ["a plain const of reactive state", "const pre = @cfg.prefix", "${pre}${it.name}"],
    ["a static const in a block that ALSO reads state in the row", "const pre = \"S-\"", "${pre}${it.name}${@cfg.suffix}"],
  ]) {
    test(label, () => {
      const { errors, js } = compile(prog(`<ul>
    \${
        ${decl}
        for (let it of @items) {
            lift <li class="row">${li}</li>
        }
    }
</ul>`, `<arr> = ["F"]\n<cfg2> = { deep: { tag: "T" } }\n`));
      expect(errors).toEqual([]);
      // No keyed factory was hoisted out of the effect that declares the name.
      expect(js).not.toContain("_scrml_create_item_");
      expect(js).toMatch(/_scrml_effect\(function\(\) \{[\s\S]*const [\s\S]*for \(const it of _scrml_cs_reactive_get\("items"\)\)/);
    });
  }

  test("control: a hoisted factory that reads NO block declaration keeps the mixed hoist", () => {
    const { errors, js } = compile(prog(`<ul>
    \${
        const title = @cfg.prefix
        lift <h2>\${title}</h2>
        for (let it of @items) {
            lift <li class="row">\${it.name}</li>
        }
    }
</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain("_scrml_create_item_");
    expect(js).toContain("_scrml_reconcile_list(");
  });
});
