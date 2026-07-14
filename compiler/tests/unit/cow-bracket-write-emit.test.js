// cycles-prereq (S168 COW-all bracket-write) — emit-shape regression.
//
// RATIFIED (user, S168): value-cycles are FORBIDDEN and the language must make
// "acyclic value-data" actually true. A true self-cycle was constructible in
// pure scrml TODAY via `@arr[0] = @arr` — it compiled to a RAW IN-PLACE write
// (`_scrml_reactive_get("arr")[0] = _scrml_reactive_get("arr")`) against the
// live backing array, so `arr[0] === arr` survived into the reactive cell.
//
// Root cause: the AT_IDENT path-collector in ast-builder.js gated entry on
// `peek().text === "."`, so a `[` target never entered the COW
// (`reactive-nested-assign`) branch — it fell through to the bare-expr fallback
// (raw verbatim). Dotted writes (`@obj.a.b = x`) already went through COW.
//
// Fix (COW-all): route ALL `@name[idx] = x` bracket WRITES through the same
// `reactive-nested-assign` -> `_scrml_deep_set` clone-mutate-replace path as a
// dotted write (SPEC §6.5.1 reassignment-canonical). The clone-then-set inside
// `_scrml_deep_set` breaks any self-reference into a stale, acyclic snapshot.
//
// This file asserts the EMIT SHAPE. A bare-LITERAL index (`[0]` / `["DAL"]`)
// lowers to a STRING path segment ("0" / "DAL"); a NON-literal index
// (`@arr[@sel]`) lowers to an inline index expression in the JS array literal.
// READS (`@arr[i].foo()`, `let x = @arr[i]`) are NOT COW'd — they reconstruct
// verbatim as bare-expr.

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compile(scrmlSource) {
  const tag = `cow-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_cow_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
      log: () => {},
    });
    let clientJs = "";
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? "";
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function fnBody(clientJs, name) {
  const m = clientJs.match(new RegExp(`function _scrml_${name}_\\d+\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  return m ? m[1] : null;
}

describe("COW-all bracket-write emit shape (cycles-prereq S168)", () => {
  test("computed index `@arr[@sel] = 99` → _scrml_deep_set with inline index expr", () => {
    const { errors, clientJs } = compile([
      "<arr> = [1, 2, 3]",
      "<sel> = 1",
      "function bump() { @arr[@sel] = 99 }",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "bump");
    expect(body).toBeTruthy();
    expect(body).toContain(
      '_scrml_reactive_set("arr", _scrml_deep_set(_scrml_reactive_get("arr"), [_scrml_reactive_get("sel")], 99));',
    );
    // NOT a raw in-place write.
    expect(body).not.toMatch(/_scrml_reactive_get\("arr"\)\[[^\]]*\]\s*=/);
  });

  test("literal numeric index `@arr[0] = @arr` → COW string segment, NO live cycle", () => {
    const { errors, clientJs } = compile([
      "<arr> = [1, 2, 3]",
      "function evil() { @arr[0] = @arr }",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "evil");
    expect(body).toBeTruthy();
    // bare-literal index → STRING segment "0"; value is the COW reassign.
    expect(body).toContain(
      '_scrml_reactive_set("arr", _scrml_deep_set(_scrml_reactive_get("arr"), ["0"], _scrml_reactive_get("arr")));',
    );
    // The cycle-construction guard: NO raw in-place `_scrml_reactive_get("arr")[0] = ...`.
    expect(body).not.toMatch(/_scrml_reactive_get\("arr"\)\[0\]\s*=/);
  });

  test("literal string index `@m[\"DAL\"] = 99` → COW string segment", () => {
    const { errors, clientJs } = compile([
      "<m> = { DAL: 1, IAH: 2 }",
      'function setKey() { @m["DAL"] = 99 }',
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "setKey");
    expect(body).toContain(
      '_scrml_reactive_set("m", _scrml_deep_set(_scrml_reactive_get("m"), ["DAL"], 99));',
    );
  });

  test("nested computed indices `@grid[@r][@c] = 9` → two inline index exprs", () => {
    const { errors, clientJs } = compile([
      "<grid> = [[1, 2], [3, 4]]",
      "<r> = 0",
      "<c> = 1",
      "function setCell() { @grid[@r][@c] = 9 }",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "setCell");
    expect(body).toContain(
      '_scrml_reactive_set("grid", _scrml_deep_set(_scrml_reactive_get("grid"), [_scrml_reactive_get("r"), _scrml_reactive_get("c")], 9));',
    );
  });

  test("mixed dotted + bracket `@obj.field[0] = 5` on a STRUCTURAL COMPOUND → retargets the backing leaf `obj.field` (Bug B)", () => {
    // `<obj> <field> = [1,2] </>` is a Variant C structural compound: `obj` is a
    // DERIVED composite, `obj.field` is the backing leaf. Per SPEC §6.3.2 the
    // field write must target the backing storage. Bug B fix: retarget to the
    // leaf `obj.field` and COW the bracket index `[0]` into its value. (Pre-fix
    // this asserted `_scrml_reactive_set("obj", _scrml_deep_set(... ["field","0"]))`,
    // which wrote the composite and was clobbered by the derived recompute.)
    const { errors, clientJs } = compile([
      "<obj>",
      "    <field> = [1, 2]",
      "</>",
      "function setMix() { @obj.field[0] = 5 }",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "setMix");
    expect(body).toContain(
      '_scrml_reactive_set("obj.field", _scrml_deep_set(_scrml_reactive_get("obj.field"), ["0"], 5));',
    );
    expect(body).not.toMatch(/_scrml_reactive_set\("obj",\s*_scrml_deep_set/);
  });

  test("bracket READ `let x = @arr[@sel]` reconstructs verbatim — NOT COW'd", () => {
    const { errors, clientJs } = compile([
      "<arr> = [1, 2, 3]",
      "<sel> = 0",
      "function readIt() { let x = @arr[@sel]\n return x }",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "readIt");
    expect(body).toContain('_scrml_reactive_get("arr")[_scrml_reactive_get("sel")]');
    expect(body).not.toContain("_scrml_deep_set");
  });

  test("multi-statement: bracket + dotted writes ALL survive in source order", () => {
    const { errors, clientJs } = compile([
      "<a> = [1, 2, 3]",
      "<b>",
      "    <k> = 0",
      "</>",
      "function multi() {\n @a[0] = 10\n @b.k = 20\n @a[1] = 30\n }",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "multi");
    expect(body).toBeTruthy();
    // `a` is a FLAT array → cell-targeted COW deep-set (unchanged). `b` is a
    // STRUCTURAL COMPOUND (`<b> <k> = 0 </>`) → the field write `@b.k = 20`
    // retargets the backing leaf `b.k` with a plain reactive_set (Bug B fix;
    // pre-fix this asserted a deep-set against the composite `b`). All three
    // writes survive in source order.
    const idxA0 = body.indexOf('_scrml_deep_set(_scrml_reactive_get("a"), ["0"], 10)');
    const idxBk = body.indexOf('_scrml_reactive_set("b.k", 20)');
    const idxA1 = body.indexOf('_scrml_deep_set(_scrml_reactive_get("a"), ["1"], 30)');
    expect(idxA0).toBeGreaterThanOrEqual(0);
    expect(idxBk).toBeGreaterThan(idxA0);
    expect(idxA1).toBeGreaterThan(idxBk);
    // The compound field write must NOT target the composite `b`.
    expect(body).not.toMatch(/_scrml_reactive_set\("b",\s*_scrml_deep_set/);
  });
});
