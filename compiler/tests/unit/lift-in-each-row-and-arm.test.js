/**
 * g-lift-inside-each-row-or-match-arm-silently-dropped — EMIT-SHAPE pins.
 *
 * A Tier-0 `${ for (…) { lift <li/> } }` accumulation block (SPEC §10.1) inside
 * a per-instance render — an `<each>` row template or a match/engine arm body —
 * compiled at exit 0 and emitted NO lift code at all:
 *
 *   - `<each>` row: emit-each's logic-child branch took only a bare-expr / value
 *     form-if / raw shape; a `for`-stmt fell to `inner = ""` and emitted the
 *     comment `// each: empty logic interpolation skipped` — the row's `<ul>`
 *     rendered empty.
 *   - match / engine arm: the arm HTML carried the `<span data-scrml-logic>` host,
 *     but arm bodies never reach the file-scope Step 4b lift-group pass and the
 *     arm wire function had no lift branch, so the host stayed empty.
 *
 * Fix: the block is registered as a NESTED lift group and lowered by Step 4b
 * through the same per-group path as a top-level block, emitted as
 * `function _scrml_lift_nested_<n>(_scrml_lift_host, _scrml_effect,
 * _scrml_effect_static, ...scope)`. The row factory / arm wire function builds
 * the host and runs it (`_scrml_lift_item_run` / `_scrml_lift_scoped_run`).
 *
 * The behavioural half (mount in happy-dom, mutate, switch, toggle) is
 * compiler/tests/browser/browser-lift-in-each-row-and-arm.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "lift-each-arm-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const abs = join(TMP, `case-${++seq}.scrml`);
  writeFileSync(abs, source);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  const errors = (result.errors || []).filter((e) => (e.severity ?? "error") === "error");
  const out = [...(result.outputs || new Map()).values()][0];
  return { errors, js: out?.clientJs ?? "", html: out?.html ?? "" };
}

const count = (hay, needle) => hay.split(needle).length - 1;

/** The body of the (single) nested lift group function, or "". */
function nestedFn(js) {
  const m = /function (_scrml_lift_nested_\d+)\(_scrml_lift_host, _scrml_effect, _scrml_effect_static([^)]*)\) \{/.exec(js);
  if (!m) return { name: null, params: null, body: "" };
  // Brace-match from the opening `{` (the group's code declares inner functions
  // at column 0, so a line-based end marker would stop early). The pinned
  // sources carry no braces inside string literals.
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  for (; i < js.length && depth > 0; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}") depth--;
  }
  return { name: m[1], params: m[2].split(",").map((s) => s.trim()).filter(Boolean), body: js.slice(start, i - 1) };
}

const EACH_ROW = `<program>
<groups> = [{ id: 1, items: ["a", "b"] }]
<div>
    <each in=@groups key=@.id as g>
        <ul class="g">
            \${ for (let it of g.items) { lift <li class="row">\${it}</li> } }
        </ul>
    </each>
</div>
</program>
`;

describe("<each> row — a `${ for … lift }` block is lowered, not skipped", () => {
  test("the row no longer emits the skip comment, and emits the nested group + its driver", () => {
    const { errors, js } = compile(EACH_ROW);
    expect(errors).toEqual([]);
    expect(js).not.toContain("each: empty logic interpolation skipped");
    const fn = nestedFn(js);
    expect(fn.name).not.toBeNull();
    // The row's iteration name is a PARAMETER — the group lives at file scope.
    expect(fn.params).toEqual(["g"]);
    expect(fn.body).toContain("_scrml_lift_target = _scrml_lift_host;");
    expect(fn.body).toContain("for (const it of g.items)");
    expect(fn.body).toContain("_scrml_lift(");
    // Driven per row, live-keyed on the row's create-time key.
    expect(js).toContain(`_scrml_lift_item_run(`);
    expect(js).toMatch(/const _scrml_lv0 = _scrml_resolve_item\(_mount, _scrml_each_key_\d+\);/);
    expect(count(js, "function _scrml_lift_scoped_run(")).toBe(1);
    expect(count(js, "function _scrml_lift_item_run(")).toBe(1);
  });

  test("`@.` in the block lowers to the row's iter binding", () => {
    const { errors, js } = compile(EACH_ROW.replace("as g>", ">").replace("g.items", "@.items"));
    expect(errors).toEqual([]);
    const fn = nestedFn(js);
    expect(fn.params).toEqual(["_scrml_each_item"]);
    expect(fn.body).toContain("for (const it of _scrml_each_item.items)");
    expect(fn.body).not.toContain("@");
  });

  test("a nested <each>: the inner row's group receives the OUTER item it reads", () => {
    const { errors, js } = compile(`<program>
<groups> = [{ id: 1, tag: "t", subs: [{ id: 11, items: ["a"] }] }]
<div>
    <each in=@groups key=@.id as g>
        <section><each in=g.subs key=@.id as s>
            <ul>\${ for (let it of s.items) { lift <li>\${g.tag}\${it}</li> } }</ul>
        </each></section>
    </each>
</div>
</program>
`);
    expect(errors).toEqual([]);
    const fn = nestedFn(js);
    expect(fn.params).toEqual(["s", "g"]);
    // Both are re-resolved by key in the driver (live across same-key reconcile).
    expect(count(js, "_scrml_resolve_item(")).toBeGreaterThanOrEqual(2);
  });

  test("a declaration in the row block is still rejected loudly (E-EACH-BODY-DECL-UNSUPPORTED)", () => {
    const { errors } = compile(`<program>
<groups> = [{ id: 1, items: ["a"] }]
<div>
    <each in=@groups key=@.id as g>
        <ul>\${ const n = g.items.length
            for (let it of g.items) { lift <li>\${it}\${n}</li> } }</ul>
    </each>
</div>
</program>
`);
    expect(errors.map((e) => e.code)).toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });
});

describe("match / engine arm — the arm's lift group runs from its wire function", () => {
  test("<match> arm with a payload binding: the payload is the group's parameter", () => {
    const { errors, js } = compile(`<program>
\${
    type LoadPhase:enum = { NotAsked, Ready(rows: string[]) }
}
<phase>: LoadPhase = .Ready(["a", "b"])
<match for=LoadPhase on=@phase>
    <NotAsked><p>none</p></>
    <Ready(rows)><ul>\${ for (let r of rows) { lift <li>\${r}</li> } }</ul></>
</>
</program>
`);
    expect(errors).toEqual([]);
    const fn = nestedFn(js);
    expect(fn.params).toEqual(["rows"]);
    expect(fn.body).toContain("for (const r of rows)");
    // The Ready arm's wire fn runs it and hands the teardown to the arm's disposers.
    const wire = js.slice(js.indexOf("_wire_Ready(_root, rows) {"));
    expect(wire).toMatch(/_disposers\.push\(_scrml_lift_scoped_run\(el, _scrml_lift_nested_\d+, \[rows\]\)\);/);
    // The NotAsked arm has no lift: it stays the no-op shell.
    expect(js).toMatch(/_wire_NotAsked\(_root\) \{ return function\(\) \{\}; \}/);
  });

  test("<engine> arm over a reactive cell: effect-wrapped group, disposed with the arm", () => {
    const { errors, js } = compile(`<program>
\${
    type Phase:enum = { Idle, Active }
}
<items> = ["a", "b"]
<engine for=Phase initial=.Active>
    <Idle rule=.Active><p>idle</p></>
    <Active rule=.Idle><ul>\${ for (let it of @items) { lift <li>\${it}</li> } }</ul></>
</>
</program>
`);
    expect(errors).toEqual([]);
    const fn = nestedFn(js);
    expect(fn.params).toEqual([]);
    expect(fn.body).toContain("_scrml_reconcile_list(");
    expect(js).toMatch(/_disposers\.push\(_scrml_lift_scoped_run\(el, _scrml_lift_nested_\d+, \[\]\)\);/);
  });
});

describe("byte-identity — no nested lift, no nested-lift output", () => {
  test("a top-level lift block emits no nested group and no drivers", () => {
    const { errors, js } = compile(`<program>
<items> = ["a", "b"]
<ul>\${ for (let it of @items) { lift <li>\${it}</li> } }</ul>
</program>
`);
    expect(errors).toEqual([]);
    expect(js).not.toContain("_scrml_lift_nested_");
    expect(js).not.toContain("_scrml_lift_scoped_run");
    expect(js).not.toContain("_scrml_lift_item_run");
  });

  test("an <each> row with only a display interpolation is unchanged in shape", () => {
    const { errors, js } = compile(`<program>
<groups> = [{ id: 1, name: "a" }]
<ul><each in=@groups key=@.id as g><li>\${g.name}</li></each></ul>
</program>
`);
    expect(errors).toEqual([]);
    expect(js).not.toContain("_scrml_lift_nested_");
    expect(js).not.toContain("_scrml_lift_item_run");
  });
});
