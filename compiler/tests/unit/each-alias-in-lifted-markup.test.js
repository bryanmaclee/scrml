/**
 * each-alias-in-lifted-markup.test.js — PARSE + EMIT-SHAPE pins for
 * g-each-alias-dropped-inside-tier0-lifted-markup (item 1 of the S427 each findings).
 *
 * Root cause: `parseLiftTag` (ast-builder.js) parsed a lifted `<each … as c>`
 * as two BOOLEAN attributes — `as` (valueless) and `c` — so
 * `eachBlockFromMarkupNode` (emit-each.ts) found no alias, the per-item factory
 * bound `_scrml_each_item`, and the body's `${c}` was an unbound read (the whole
 * page script died at init, or silently read an outer `c`). `as (k, v)` hit the
 * `(` and bailed the whole tag to the string fallback. A `<each>` nested under an
 * element in the lifted body was never promoted to an each-block and rendered as
 * a literal `<each>` element.
 *
 * Every emit pin is paired with the NON-lifted twin's emission.
 * Behaviour (happy-dom, shipped runtime): compiler/tests/browser/each-alias-in-lifted-markup.browser.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "each-alias-lift-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const abs = join(TMP, `case-${++seq}.scrml`);
  writeFileSync(abs, source);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  const all = [...(result.errors || []), ...(result.warnings || [])];
  const errors = all.filter((e) => (e.severity ?? "error") === "error");
  const out = [...(result.outputs || new Map()).values()][0];
  return { errors, all, js: out?.clientJs ?? "" };
}

/** Every generic-markup `<each>` node (lift markup) in a parsed file. */
function liftEachNodes(source) {
  const bs = splitBlocks("t.scrml", source);
  const { ast } = buildAST(bs);
  const found = [];
  const seen = new Set();
  (function walk(n) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (n.kind === "markup" && n.tag === "each") found.push(n);
    for (const k of Object.keys(n)) {
      if (k === "parent") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  })(ast);
  return found;
}

const prog = (body, decls = `<items> = [{id: 1, n: "a", kids: ["a1"]}, {id: 2, n: "b", kids: ["b1"]}]`) =>
  `<program>\n${decls}\n${body}\n</program>\n`;

describe("parseLiftTag — the `as` clause of a lifted <each> is the `as` attribute's value", () => {
  test("`as c` → one `as` attribute carrying the name, no stray `c` attribute", () => {
    const [each] = liftEachNodes(prog(`<ul>\${ lift <li><each in=@items as c><b>\${c.n}</b></each></li> }</ul>`));
    expect(each).toBeDefined();
    expect(each.attrs.map((a) => a.name)).toEqual(["in", "as"]);
    const as = each.attrs[1].value;
    expect(as.kind).toBe("variable-ref");
    expect(as.name).toBe("c");
    // A binding, not a read — no exprNode for downstream reference walks.
    expect(as.exprNode).toBeUndefined();
  });

  test("`as c key=c.id` and `key=@.id as c` both keep `key` a separate attribute", () => {
    const [a] = liftEachNodes(prog(`<ul>\${ lift <li><each in=@items as c key=c.id><b>\${c.n}</b></each></li> }</ul>`));
    expect(a.attrs.map((x) => x.name)).toEqual(["in", "as", "key"]);
    expect(a.attrs[1].value.name).toBe("c");
    const [b] = liftEachNodes(prog(`<ul>\${ lift <li><each in=@items key=@.id as c><b>\${c.n}</b></each></li> }</ul>`));
    expect(b.attrs.map((x) => x.name)).toEqual(["in", "key", "as"]);
    expect(b.attrs[2].value.name).toBe("c");
  });

  test("`as (k, v)` no longer bails the tag parse (the each stays structured markup)", () => {
    const [each] = liftEachNodes(prog(
      `<ul>\${ lift <li><each in=@pairs as (k, v)><b>\${k}</b></each></li> }</ul>`,
      `<pairs> = [{key: "a", value: 1}]`,
    ));
    expect(each).toBeDefined();
    expect(each.attrs.map((a) => a.name)).toEqual(["in", "as"]);
    expect(each.attrs[1].value).toMatchObject({ kind: "expr", raw: "(k, v)" });
  });

  test("`as` on a NON-each lifted tag is untouched (still two boolean attributes)", () => {
    const bs = splitBlocks("t.scrml", prog(`<ul>\${ lift <li as c>x</li> }</ul>`));
    const { ast } = buildAST(bs);
    const s = JSON.stringify(ast);
    expect(s).toContain(`"name":"as","value":{"kind":"absent"`);
    expect(s).toContain(`"name":"c","value":{"kind":"absent"`);
  });
});

describe("emit — the lifted each binds its alias exactly as its non-lifted twin does", () => {
  const LIFT = prog(`<ul>\${ lift <li><each in=@items key=c.id as c><b title=c.n>\${c.n}</b></each></li> }</ul>`);
  const TWIN = prog(`<ul><li><each in=@items key=c.id as c><b title=c.n>\${c.n}</b></each></li></ul>`);

  test("the key fn and item factory take the alias as their item parameter", () => {
    for (const src of [LIFT, TWIN]) {
      const { errors, js } = compile(src);
      expect(errors).toEqual([]);
      expect(js).toContain("(c, _scrml_each_idx) => c.id,");
      expect(js).toContain("(c, _scrml_each_idx) => {");
      // Per-item effects re-resolve the LIVE row under the alias name.
      expect(js).toMatch(/let c = _scrml_resolve_item\(_scrml_each_mount_\d+|let c = _scrml_resolve_item\(_mount/);
      expect(js).toContain("String(c.n)");
    }
  });

  test("no W-ATTR-001 for the alias name (it was a stray attribute before)", () => {
    const { all } = compile(LIFT);
    expect(all.filter((e) => e.code === "W-ATTR-001")).toEqual([]);
  });

  test("`as (k, v)` binds both names from the synthetic item, like the twin", () => {
    const decls = `<pairs> = [{key: "a", value: 1}]`;
    const lift = compile(prog(`<ul>\${ lift <li><each in=@pairs as (k, v)><b>\${k}=\${v}</b></each></li> }</ul>`, decls));
    const twin = compile(prog(`<ul><li><each in=@pairs as (k, v)><b>\${k}=\${v}</b></each></li></ul>`, decls));
    for (const { errors, js } of [lift, twin]) {
      expect(errors).toEqual([]);
      expect(js).toContain("const k = _scrml_each_item.key;");
      expect(js).toContain("const v = _scrml_each_item.value;");
      expect(js).not.toContain(`createElement("each")`);
    }
  });

  test("a nested <each> under an element in the lifted row is lowered, not emitted as a literal element", () => {
    const lift = compile(prog(`<ul>\${ lift <li><each in=@items as c><b><each in=c.kids as k><i>\${c.n}/\${k}</i></each></b></each></li> }</ul>`));
    const twin = compile(prog(`<ul><li><each in=@items as c><b><each in=c.kids as k><i>\${c.n}/\${k}</i></each></b></each></li></ul>`));
    for (const { errors, js } of [lift, twin]) {
      expect(errors).toEqual([]);
      expect(js).not.toContain(`createElement("each")`);
      // The inner list reads the OUTER row's live alias and binds its own.
      expect(js).toContain("(k, _scrml_each_idx) => {");
      expect(js).toMatch(/const _scrml_each_items_\d+ = c\.kids;/);
    }
  });
});

describe("unchanged / still loud", () => {
  test("the `@.` form of a lifted each is byte-identical in shape (no alias → synthetic item)", () => {
    const { errors, js } = compile(prog(`<ul>\${ lift <li><each in=@items><b>\${@.n}</b></each></li> }</ul>`));
    expect(errors).toEqual([]);
    expect(js).toContain("(_scrml_each_item, _scrml_each_idx) => {");
    expect(js).toContain("String(_scrml_each_item.n)");
  });

  // Unchanged from main: the tag still bails to the string fallback, and the
  // page fails at init on the unbound `a` (loud, not silently re-bound).
  test("a three-name `as (a, b, x)` is not accepted as a destructure (it is not §59.8)", () => {
    const { js } = compile(prog(
      `<ul>\${ lift <li><each in=@pairs as (a, b, x)><b>\${a}</b></each></li> }</ul>`,
      `<pairs> = [{key: "a", value: 1}]`,
    ));
    expect(js).not.toContain("const a = _scrml_each_item.key;");
  });
});
