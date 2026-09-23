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

// ---------------------------------------------------------------------------
// Round 2 (adversarial review round 1 of s427: H1 / M1 / M2 / L1). Repros:
// docs/changes/s427-lift-body-lowering/review-round1/.
// ---------------------------------------------------------------------------

const codes = (errors) => errors.map((e) => e.code);

/** Compile through the WRITE path, where the emitted-JS parse gate runs — base's
 *  duplicate-`const` failures surface there (E-CODEGEN-INVALID-LOGIC). */
function compileW(source) {
  const n = ++seq;
  const abs = join(TMP, `case-${n}.scrml`);
  writeFileSync(abs, source);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, `dist-w-${n}`), write: true, log: () => {} });
  const errors = (result.errors || []).filter((e) => (e.severity ?? "error") === "error");
  return { errors };
}

// Round 3: origin/main #996 landed E-ASSIGN-004 (§50.8.5) in the type system. These
// pin the post-merge truth — the type system rejects the write — AND the lowering
// underneath it (never a silent shadowing `const`), which is what still stands
// where the type system does not see the write (see the h1k pin below).
describe("round 2 H1 — a keywordless write to a `const` stays LOUD (never a silent shadow, never exit 0 where base failed the compile)", () => {
  test("r3b — `const total` and `total = 5` in the same lift block: compile fails, as on base", () => {
    const { errors } = compileW(prog(`<ul>\${ const total = 10
       total = 5
       for (let it of @items) { lift <li>\${total}:\${it.name}</li> } }</ul>`));
    expect(codes(errors)).toContain("E-ASSIGN-004");
  });

  test("r3 — `const` in an earlier block, the write in a later lift block at chunk scope: compile fails, as on base", () => {
    const { errors } = compileW(prog(`\${ const total = 10 }
<ul>\${ total = 5
       for (let it of @items) { lift <li>\${total}:\${it.name}</li> } }</ul>`));
    expect(codes(errors)).toContain("E-ASSIGN-004");
  });

  test("r3c — `const` and the write in two plain file-level blocks: compile fails, as on base", () => {
    const { errors } = compileW(prog(`\${ const total = 10 }
\${ total = 5 }
<p>\${total}</p>`));
    expect(codes(errors)).toContain("E-ASSIGN-004");
  });

  test("sibling: a destructured `const` binding written in the same block: compile fails", () => {
    const { errors } = compileW(prog(`<ul>\${ const { prefix } = @cfg
       prefix = "Z"
       for (let it of @items) { lift <li>\${prefix}\${it.name}</li> } }</ul>`));
    expect(codes(errors)).toContain("E-ASSIGN-004");
  });

  test("sibling: the write in a later block whose code runs INSIDE its re-render effect fails the compile ONCE (E-ASSIGN-004; no duplicate codegen report)", () => {
    const { errors } = compileW(prog(`\${ const total = 10 }
<ul>\${ total = 5
       let n = 0
       for (let it of @items) { n = n + 1
           lift <li>\${n}:\${total}</li> } }</ul>`));
    expect(codes(errors).filter((c) => c === "E-ASSIGN-004").length).toBe(1);
    expect(codes(errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("sibling: a write in a NESTED block of the lift body — E-ASSIGN-004, and lowered as the assignment, never a shadowing `const`", () => {
    const { errors, js } = compile(prog(`<ul>\${ const t = 1
       for (let it of @items) { t = 5
           lift <li>\${t}:\${it.name}</li> } }</ul>`));
    expect(codes(errors)).toContain("E-ASSIGN-004");
    expect(js).toContain("t = 5;");
    expect(js).not.toContain("const t = 5");
  });

  test("sibling: a write in an `if` body next to the lift loop — E-ASSIGN-004, and lowered as the assignment, never a shadowing `const`", () => {
    const { errors, js } = compile(prog(`<ul>\${ const t = 1
       if (@items.length > 0) { t = 2 }
       for (let it of @items) { lift <li>\${t}\${it.name}</li> } }</ul>`));
    expect(codes(errors)).toContain("E-ASSIGN-004");
    expect(js).toContain("t = 2;");
    expect(js).not.toContain("const t = 2");
  });

  test("sibling: the negative corpus fixture phase3-assign-expr-to-const-081 still fails the compile", () => {
    const { errors } = compileW(`// assigning to a const — E-ASSIGN-004
\${
    const x = 1
    x = 2
}
<program>
    <p>bad</>
</>
`);
    expect(codes(errors)).toContain("E-ASSIGN-004");
  });

  test("h1k — a write in a `${}` logic block INSIDE lifted markup (a position E-ASSIGN-004 does not reach) is the assignment, never a shadowing `const`", () => {
    const { errors, js } = compile(prog(`<ul>\${ const total = 10
    for (let it of @items) { lift <li>\${ total = 3 }\${total}:\${it.name}</li> } }</ul>`));
    // KNOWN: the type system does not see this position (compiles at exit 0 on main
    // too). The lowering keeps it loud — it throws at boot — where main renders 3.
    expect(errors).toEqual([]);
    expect(js).toContain("total = 3;");
    expect(js).not.toContain("const total = 3");
  });

  test("control: a `let` of the same name in the loop body shadows the `const` — its rebind is an ordinary assignment", () => {
    const { errors, js } = compile(prog(`<ul>\${ const x = 1
       for (let it of @items) { let x = 0
           x = x + it.id
           lift <li class="row">\${x}</li> } }</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain("let x = 0;");
    expect(js).toContain("x = x + it.id;");
  });

  test("control: a `let` rebound across blocks is still the assignment (the round-1 fix)", () => {
    const { errors, js } = compile(prog(`\${ let total = 10 }
<ul>\${ total = 5
       for (let it of @items) { lift <li>\${total}:\${it.name}</li> } }</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain("total = 5;");
    expect(js).not.toContain("const total = 5");
  });
});

describe("round 2 M1 — the mixed-hoist guard resolves names by scope", () => {
  const block = (row) => prog(`<ul>
    \${
        const name = @user
        lift <h4>\${name}</h4>
        for (let item of @items) {
${row}
        }
    }
</ul>`, `<user> = "U"\n`);
  for (const [label, row] of [
    ["r5 — a row-local `const name`", `            const name = item.name
            lift <li class="row">\${name}</li>`],
    ["a `const name` in a nested block of the row", `            if (item.id > 0) {
                const name = item.name
                lift <li class="row">\${name}</li>
            }`],
    ["a lambda parameter `name`", `            lift <li class="row">\${[item.name].map(name => name + "!").join("")}</li>`],
    ["a nested function's parameter `name`", `            function fmt(name) { return "<" + name + ">" }
            lift <li class="row">\${fmt(item.name)}</li>`],
  ]) {
    test(`${label} is not a reference to the block's \`name\` — the list stays keyed`, () => {
      const { errors, js } = compile(block(row));
      expect(errors).toEqual([]);
      expect(js).toContain("_scrml_create_item_");
      expect(js).toContain("_scrml_reconcile_list(");
    });
  }

  test("control: a row that DOES read the block's `name` still lowers plain", () => {
    const { errors, js } = compile(prog(`<ul>
    \${
        const name = @user
        for (let item of @items) {
            lift <li class="row">\${name}\${item.name}</li>
        }
    }
</ul>`, `<user> = "U"\n`));
    expect(errors).toEqual([]);
    expect(js).not.toContain("_scrml_create_item_");
  });
});

describe("round 2 M2 — the loop-purity check is block-scoped", () => {
  const counter = (body) => prog(`<ul>
    \${
        let n = 0
        for (let it of @items) {
${body}
            lift <li class="row">\${n}:\${it.name}</li>
        }
    }
</ul>`);
  for (const [label, body] of [
    ["r6 — a nested `if` declares its own `n`", `            n = n + 1
            if (it.name == "zz") { let n = 99 }`],
    ["a nested `for` declares its own `n`", `            n = n + 1
            for (let q of [1]) { let n = 50 }`],
    ["an `else` branch declares its own `n`", `            n = n + 1
            if (it.id > 99) { let z = 1 } else { let n = 9 }`],
    ["an EARLIER nested block declares its own `n`", `            if (it.id > 0) { let n = 7 }
            n = n + 1`],
  ]) {
    test(`${label}: the loop's own \`n = n + 1\` still writes the outer counter → plain loop`, () => {
      const { errors, js } = compile(counter(body));
      expect(errors).toEqual([]);
      expect(js).not.toContain("_scrml_reconcile_list(");
      expect(js).toContain("n = n + 1;");
    });
  }

  test("control: a write to a nested block's OWN `n` is local — the list stays keyed", () => {
    const { errors, js } = compile(prog(`<ul>
    \${
        let n = 0
        for (let it of @items) {
            if (it.id > 0) { let n = 7
                n = n + 1 }
            lift <li class="row">\${it.name}</li>
        }
    }
</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain("_scrml_reconcile_list(");
  });
});

describe("round 2 L1 — a member write to an object declared outside the loop is impure", () => {
  for (const [label, stmt] of [["r7 — `acc.n = acc.n + 1`", "acc.n = acc.n + 1"], ["`acc.n++`", "acc.n++"], ["`acc[\"n\"] += 1`", "acc[\"n\"] += 1"]]) {
    test(`${label} → plain loop`, () => {
      const { errors, js } = compile(prog(`<ul>
    \${
        const acc = { n: 0 }
        for (let it of @items) { ${stmt}
            lift <li class="row">\${acc.n}:\${it.name}</li> }
    }
</ul>`));
      expect(errors).toEqual([]);
      expect(js).not.toContain("_scrml_reconcile_list(");
    });
  }

  test("control: a member write to the loop's own item stays keyed", () => {
    const { errors, js } = compile(prog(`<ul>
    \${
        for (let it of @items) { it.seen = 1
            lift <li class="row">\${it.name}</li> }
    }
</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain("_scrml_reconcile_list(");
  });
});

// ---------------------------------------------------------------------------
// Round 3 F1 — a write to a rendering loop's OWN binder.
// ---------------------------------------------------------------------------

describe("round 3 F1 — a write to the loop's own binder takes effect (let) or stays loud (const)", () => {
  const S = `<items> = ["a", "b"]\n`;
  const P = (block, cells = S) => `<program>\n${cells}<ul>\${ ${block} }</ul>\n</program>\n`;
  for (const [label, block] of [
    ["lv3 — an outer `const it` of the same name", `const it = 5
    for (let it of @items) { it = it + "!"
        lift <li>\${it}</li> }`],
    ["lv7 — an outer `let it` of the same name", `let it = "z"
    for (let it of @items) { it = it + "!"
        lift <li>\${it}</li> }`],
    ["lv1 — no outer binding", `for (let it of @items) { it = it + "!"
        lift <li>\${it}</li> }`],
    ["lv6 — the write in a nested `if`", `for (let it of @items) { if (it == "a") { it = "A" }
        lift <li>\${it}</li> }`],
  ]) {
    test(`${label}: plain loop with a \`let\` head, the write is the binder's assignment`, () => {
      const { errors, js } = compile(P(block));
      expect(errors).toEqual([]);
      expect(js).not.toContain("_scrml_reconcile_list(");
      expect(js).toMatch(/for \(let it of _scrml_cs_reactive_get\("items"\)\)/);
      expect(js).not.toMatch(/const it = (it|"A")/);
    });
  }

  test("lv4 — the binder shares its name with an EARLIER block's `let item`", () => {
    const { errors, js } = compile(P(`for (let item of @items) { item = item + "!"
        lift <li>\${item}</li> }`, `${S}\${ let item = "none" }\n<p>\${item}</p>\n`));
    expect(errors).toEqual([]);
    expect(js).toMatch(/for \(let item of _scrml_cs_reactive_get\("items"\)\)/);
    expect(js).toContain(`item = item + "!";`);
  });

  test("a destructured head `for (let [k, v] of …)`: the written binder is the body's own", () => {
    const { errors, js } = compile(P(`let v = "z"
    for (let [k, v] of @pairs) { v = v + "!"
        lift <li>\${k}\${v}</li> }`, `<pairs> = [["k1", "a"], ["k2", "b"]]\n`));
    expect(errors).toEqual([]);
    expect(js).toMatch(/for \(let \[\s*k,\s*v\s*\] of _scrml_cs_reactive_get\("pairs"\)\)/);
    expect(js).toContain(`v = v + "!";`);
  });

  // Round 4: a write to a `const` or keywordless binder FAILS THE COMPILE (it compiled
  // at 5946c3da and threw at boot — or, with an empty initial list, only logged an
  // effect error on the first push). Choice (b): E-CODEGEN-INVALID-LOGIC with a
  // message naming the binder. The keywordless case is pending bryan's ruling on
  // whether a keywordless loop binder is mutable (§17.4a / §50.8.5).
  const binderErr = (errors) => errors.find((e) => e.code === "E-CODEGEN-INVALID-LOGIC" && /loop binder/.test(e.message));
  for (const [label, block] of [
    ["c1 — `const` binder, `=`", `for (const it of @items) { it = it + "!"
        lift <li>\${it}</li> }`],
    ["`const` binder, `+=`", `for (const it of @items) { it += "!"
        lift <li>\${it}</li> }`],
    ["`const` binder, `++`", `for (const it of @items) { it++
        lift <li>\${it}</li> }`],
    ["`const` binder, write in a nested `if`", `for (const it of @items) { if (it == "a") { it = "A" }
        lift <li>\${it}</li> }`],
    ["`const` binder, write in a logic block inside lifted markup (c13c)", `for (const it of @items) { lift <li>\${ it = it + "!" }\${it}</li> }`],
    ["t3 — keywordless binder (pending bryan's ruling)", `for (it of @items) { it = it + "!"
        lift <li>\${it}</li> }`],
    ["c8b — keywordless binder with an outer `let it`", `let it = "outer"
    for (it of @items) { it = it + "!"
        lift <li>\${it}</li> }
    lift <li>after:\${it}</li>`],
    ["`const` destructured head", `for (const [k, v] of @pairs) { v = v + "!"
        lift <li>\${k}\${v}</li> }`],
  ]) {
    test(`${label}: compile error naming the binder`, () => {
      const { errors } = compile(P(block, `${S}<pairs> = [["k1", "a"]]\n`));
      const e = binderErr(errors);
      expect(e).toBeDefined();
      expect(e.message).toMatch(/`(it|v)`/);
    });
  }

  test("c1b — `const` binder over an initially EMPTY list: still a compile error (was an effect error on the first push)", () => {
    const { errors } = compile(`<program>\n<items> = []\n<p>ok</p>\n<ul>\${ for (const it of @items) { it = it + "!"
        lift <li>\${it}</li> } }</ul>\n</program>\n`);
    expect(binderErr(errors)).toBeDefined();
  });

  const HOSTS = {
    "top level": (l) => `<ul>${l}</ul>`,
    "`if=`": (l) => `<div if=@show><ul>${l}</ul></div>`,
    "match arm": (l) => `\${ type Ph:enum = { A, B } }\n<phase>: Ph = .A\n<match for=Ph on=@phase>\n    <A><ul>${l}</ul></>\n    <B><p>b</p></>\n</>`,
    "engine arm": (l) => `\${ type Ph:enum = { A, B } }\n<engine for=Ph initial=.A>\n    <A rule=.B><ul>${l}</ul></>\n    <B></>\n</>`,
    "`<each>` row": (l) => `<div><each in=@groups key=@.id as g><ul>${l.replace("@items", "g.items")}</ul></each></div>`,
    "nested lift": (l) => `<div>\${ for (let g of @groups) { lift <ul>${l.replace("@items", "g.items")}</ul> } }</div>`,
  };
  const hostProg = (host, kw) => `<program>\n<items> = ["a", "b"]\n<groups> = [{ id: 1, items: ["a", "b"] }]\n<show> = true\n${HOSTS[host](`\${ for (${kw}it of @items) { it += "!"
        lift <li>\${it}</li> } }`)}\n</program>\n`;
  for (const host of Object.keys(HOSTS)) {
    test(`every host — ${host}: \`const\` and keywordless binder writes fail the compile; a \`let\` one compiles`, () => {
      expect(binderErr(compile(hostProg(host, "const ")).errors)).toBeDefined();
      expect(binderErr(compile(hostProg(host, "")).errors)).toBeDefined();
      expect(compile(hostProg(host, "let ")).errors).toEqual([]);
    });
  }

  test("control: reading (not writing) a `const` / keywordless binder is unaffected", () => {
    expect(compile(P(`for (const it of @items) { lift <li>\${it}</li> }`)).errors).toEqual([]);
    expect(compile(P(`for (it of @items) { lift <li>\${it}</li> }`)).errors).toEqual([]);
  });

  test("control: a member write through a `const` binder (`it.seen = 1`) is not a binder write", () => {
    const { errors } = compile(prog(`<ul>\${ for (const it of @items) { it.seen = 1
        lift <li>\${it.name}</li> } }</ul>`));
    expect(errors).toEqual([]);
  });

  test("control: a nested `let it` shadowing a `const` binder takes the write", () => {
    const { errors } = compile(P(`for (const it of @items) { if (@items.length > 0) { let it = 1
            it = it + 1 }
        lift <li>\${it}</li> }`));
    expect(errors).toEqual([]);
  });

  test("`for (… in …)` stays a compile error (E-CTRL-011)", () => {
    const { errors } = compile(P(`for (let k in @items) { k = k + "!"
        lift <li>\${k}</li> }`));
    expect(codes(errors)).toContain("E-CTRL-011");
  });

  test("a C-style counter with an outer `const i`: the counter's own writes assign the loop `let i`", () => {
    const { errors, js } = compile(P(`const i = 9
    for (let i = 0; i < 4; i = i + 1) { i = i + 1
        lift <li>\${i}</li> }`));
    expect(errors).toEqual([]);
    expect(js).toContain("i = i + 1;");
    expect(js).not.toContain("const i = i + 1");
  });

  test("control: a nested loop that reuses the name writes ITS binder — the outer list stays keyed", () => {
    const { errors, js } = compile(P(`for (let it of @items) { for (let it of [1, 2]) { it = it + 10 }
        lift <li>\${it}</li> }`));
    expect(errors).toEqual([]);
    expect(js).toContain("_scrml_reconcile_list(");
  });

  test("a NESTED rendering loop that writes its own binder is lowered plain with a `let` head", () => {
    const { errors, js } = compile(`<program>\n<groups> = [{ id: 1, items: ["a", "b"] }]\n<div>\${ for (let g of @groups) { lift <ul>\${ for (let it of g.items) { it = it + "!"
        lift <li>\${it}</li> } }</ul> } }</div>\n</program>\n`);
    expect(errors).toEqual([]);
    expect(js).toMatch(/for \(let it of g\.items\)/);
    expect(js).not.toMatch(/const it = (it|"A")/);
  });
});

describe("KNOWN pre-existing — a callback invoked immediately inside the loop body writes the counter unseen", () => {
  // The purity walk does not descend into lambda / function bodies (a handler runs
  // later), so a callback INVOKED during the render (`[1].forEach(x => { n = n + 1 })`,
  // `bump()`) is invisible to it and the list stays keyed: every row shows the final
  // count. Base b497b892 renders the same (`3:a,3:b,3:c`). Pinned as today's
  // behaviour, NOT as correct — see progress.md (round 3).
  for (const [label, block] of [
    ["`[1].forEach(x => { n = n + 1 })`", `let n = 0
    for (let it of @items) { [1].forEach(x => { n = n + 1 })
        lift <li>\${n}:\${it}</li> }`],
    ["`const bump = () => { n = n + 1 }` then `bump()`", `let n = 0
    const bump = () => { n = n + 1 }
    for (let it of @items) { bump()
        lift <li>\${n}:\${it}</li> }`],
  ]) {
    test(`KNOWN pre-existing: ${label} — the loop stays keyed`, () => {
      const { errors, js } = compile(`<program>\n<items> = ["a", "b", "c"]\n<ul>\${ ${block} }</ul>\n</program>\n`);
      expect(errors).toEqual([]);
      expect(js).toContain("_scrml_reconcile_list(");
    });
  }
});
