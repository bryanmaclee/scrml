// parse.test.js — the bootstrap parser (parse.scrml, compiled by impl#1) on the
// §66.19.1 / §66.19.3 sources: FileAst shape, NodeIds, the §4 bodies-are-trees
// invariant, and the parse-level §66 diagnostics.

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadM2, source } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const parse = (path, src, first = 0) => mods.parse.parseFile(path, src, first);

// Every node of a FileAst, as plain objects carrying `nid`.
function nodes(x, out = []) {
  if (Array.isArray(x)) { for (const y of x) nodes(y, out); return out; }
  if (x && typeof x === "object") {
    if ("nid" in x) out.push(x);
    for (const [k, v] of Object.entries(x)) if (k !== "span") nodes(v, out);
  }
  return out;
}

// §4: `string` only in literal values, identifiers, comments and spans. Every
// string in the tree must sit under one of these keys (a variant tag is a string
// too — `variant` — and a nullary variant is a bare string element of an array
// or a field value, checked separately).
const STRING_KEYS = new Set(["path", "name", "v", "raw", "text", "tag", "from", "variant", "op"]);
function strayStrings(x, key = "", out = []) {
  if (Array.isArray(x)) { x.forEach((y) => strayStrings(y, key === "grants" ? "grant" : key, out)); return out; }
  if (x && typeof x === "object") { for (const [k, v] of Object.entries(x)) if (k !== "span") strayStrings(v, k, out); return out; }
  if (typeof x === "string" && !STRING_KEYS.has(key) && key !== "grant" && !/^[A-Z][A-Za-z]*$/.test(x)) out.push(`${key}=${JSON.stringify(x)}`);
  return out;
}

describe("the §66.19 sources are the SPEC's code blocks, verbatim (drift guard)", () => {
  const spec = readFileSync(join(import.meta.dir, "..", "..", "SPEC.md"), "utf8");
  const blocks = [...spec.matchAll(/```scrml\n([\s\S]*?)```/g)].map((m) => m[1]);
  test("counter.scrml is §66.19.1", () => {
    expect(blocks).toContain(source("counter.scrml"));
  });
  test("lib/dropdown.scrml + app.scrml are the two §66.19.3 blocks", () => {
    expect(blocks).toContain(source("lib/dropdown.scrml"));
    expect(blocks).toContain(source("app.scrml"));
  });
});

describe("parse — the three sources", () => {
  for (const f of ["counter.scrml", "lib/dropdown.scrml", "app.scrml"]) {
    test(`${f}: no diagnostics; NodeIds dense, unique, from firstId`, () => {
      const r = parse(f, source(f), 1000);
      expect(r.diags).toEqual([]);
      const ids = nodes(r.ast).map((n) => n.nid);
      expect(new Set(ids).size).toBe(ids.length);
      expect(Math.min(...ids)).toBe(1000);
      expect(Math.max(...ids)).toBe(r.nextId - 1);
      expect(ids.length).toBe(r.nextId - 1000);
    });
    test(`${f}: §4 — no string outside literals / identifiers / spans`, () => {
      expect(strayStrings(parse(f, source(f)).ast)).toEqual([]);
    });
  }

  test("counter: declarations, functions and markup are separated; comments are gone", () => {
    const prog = parse("c", source("counter.scrml")).ast.items[0].k.data.p;
    expect(prog.items.map((i) => i.k.variant)).toEqual(["DeclItem", "DeclItem", "DeclItem", "FnItem", "FnItem", "MarkupItem"]);
    const [count, step, doubled] = prog.items.slice(0, 3).map((i) => i.k.data.d);
    expect([count.isLet, count.name, count.ty.k.data.name, count.own.variant]).toEqual([true, "count", "int", "Bare"]);
    expect([step.isLet, step.name, step.ty, step.own.data.e.k.data.raw]).toEqual([false, "step", null, "1"]);
    expect(doubled.own.variant).toBe("Paren");
    expect(doubled.own.data.e.k.variant).toBe("Binary");
    const main = prog.items[5].k.data.n.k.data.e;
    const text = JSON.stringify(main);
    expect(text).not.toContain("E-DERIVED-WRITE");      // the <!-- --> lines are comments
  });

  test("dropdown: typed attributes, an exported `let` attribute, a state-child graph field, `renders`", () => {
    const d = parse("d", source("lib/dropdown.scrml")).ast.items[1].k.data.d;
    expect(d.exported).toBe(true);
    expect(d.attrs.map((a) => [a.name, a.exported, a.isLet, a.ty.k.variant, a.dflt.variant ?? a.dflt])).toEqual([
      ["label", false, false, "TName", "NoValue"],
      ["options", false, false, "TSeq", "NoValue"],
      ["value", true, true, "TName", "Quoted"],
    ]);
    const open = d.body[0];
    expect(open.variant).toBe("ChildField");
    expect(open.data.d.exported).toBe(true);
    expect(open.data.d.body.map((c) => [c.variant, c.data.s.name, c.data.s.attrs[0].value.data.e.k.data.name])).toEqual([
      ["StateChild", "Closed", "Opened"],
      ["StateChild", "Opened", "Closed"],
    ]);
    expect(d.renders.tag).toBe("div");
  });

  test("app: the braced handler is a block of two statements; `as line` binds; `@.id` is the item", () => {
    const prog = parse("a", source("app.scrml")).ast.items[1].k.data.p;
    const main = prog.items.find((i) => i.k.variant === "MarkupItem").k.data.n.k.data.e;
    const each = main.kids.map((k) => k.k).find((k) => k.variant === "Elem" && k.data.e.tag === "each").data.e;
    expect(each.attrs.map((a) => a.name)).toEqual(["in", "key", "as"]);
    expect(each.attrs[1].value.data.e.k.variant).toBe("Member");
    expect(each.attrs[1].value.data.e.k.data.obj.k).toBe("AtItem");
    expect(each.attrs[2].value.data.e.k.data.name).toBe("line");
  });
});

describe("parse — §66 diagnostics", () => {
  const codes = (src) => parse("t.scrml", src).diags.map((d) => d.code);

  test("E-DECL-OPENER-EXPR-UNPARENTHESIZED — a non-literal, non-@ref opener value written bare (§66.2.4)", () => {
    expect(codes("<program><total:int=@a/></program>")).toEqual([]);
    expect(codes("<program><doubled:int=(@count * 2)/></program>")).toEqual([]);
    expect(codes("<program><x:int=f()/></program>")).toEqual(["E-DECL-OPENER-EXPR-UNPARENTHESIZED"]);
    expect(codes("<program><card title:string=a.b/></program>")).toEqual(["E-DECL-OPENER-EXPR-UNPARENTHESIZED"]);
  });

  test("E-DECL-ILLEGAL-FIELD-NAME — `class` / `bind` / … as a field or on a declaration opener (§66.2.3)", () => {
    expect(codes("<program><card title:string>\n<class:string=\"\"/>\n</></program>")).toEqual(["E-DECL-ILLEGAL-FIELD-NAME"]);
    expect(codes("<program><card title:string class:active=@x/></program>")).toEqual(["E-DECL-ILLEGAL-FIELD-NAME"]);
  });

  test("a spread `{ ...@x, f: v }` / `{ ...x }` parses as spread props (three touching dots)", () => {
    const r = parse("t.scrml", "<program>\nfunction f() { @o = { ...@o, s: .Shipped }\n let y = { ...x } }\n</program>");
    expect(r.diags).toEqual([]);
    const body = r.ast.items[0].k.data.p.items[0].k.data.f.body.stmts;
    const obj = body[0].k.data.e.k.data.value.k.data.props;
    expect(obj.map((p) => [p.spread, p.name, p.value.k.variant])).toEqual([[true, "", "At"], [false, "s", "Variant"]]);
    const obj2 = body[1].k.data.init.k.data.props;
    expect(obj2.map((p) => [p.spread, p.value.k.variant, p.value.k.data.name])).toEqual([[true, "Name", "x"]]);
  });

  test("`===` and `null` are not scrml", () => {
    expect(codes("<program>\nfunction f() { return @a === 1 }\n</program>")).toEqual(["E-PARSE-STRICT-EQ"]);
    expect(codes("<program>\nfunction f() { return null }\n</program>")).toEqual(["E-PARSE-NO-NULL"]);
  });
});

describe("fix round — out-of-subset forms are REPORTED by name (F-C, F-D)", () => {
  const codes = (src) => parse("t.scrml", src).diags.map((d) => [d.code, d.message]);

  test("F-D: `#{ … }` inside markup / at program level is reported, never lowered as text", () => {
    const r = parse("t.scrml", "<program>\n#{ .x { color: red; } }\n<main><p>a #{ .y { margin: 0 } } b</p></main>\n</program>");
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED"]);
    expect(r.diags[0].message).toContain("#{");
    expect(JSON.stringify(r.ast)).not.toContain("color");
    expect(JSON.stringify(r.ast)).not.toContain("margin");
  });

  test("F-C: `@count += @step` names compound assignment; `@count++` names `++`", () => {
    const a = codes("<program>\nfunction f() { @count += @step }\n</program>");
    expect(a.length).toBe(1);
    expect(a[0][0]).toBe("E-BOOTSTRAP-UNSUPPORTED");
    expect(a[0][1]).toContain("compound assignment `+=`");
    const b = codes("<program>\nfunction f() { @count++ }\n</program>");
    expect(b.map((x) => x[0])).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(b[0][1]).toContain("`++`");
  });

  test("F-C: `<let count:int = 0/>` — §66.2.2 says `=` IMMEDIATELY after the name / `name:Type`: one diagnostic each", () => {
    const r = parse("t.scrml", "<program><let count:int = 0/><card title:string = \"x\"/></program>");
    expect(r.diags.map((d) => d.code)).toEqual(["E-PARSE-OPENER-EQ-SPACED", "E-PARSE-OPENER-EQ-SPACED"]);
    expect(parse("t.scrml", "<program><let count:int=0/></program>").diags).toEqual([]);
  });
});
