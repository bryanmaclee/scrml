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

// Line endings are normalized (a CRLF checkout of SPEC.md and of the sources
// is the same text), and each source is compared with the code blocks of ITS
// OWN §66.19 section — not with "some scrml block anywhere in the SPEC".
const lf = (t) => t.replace(/\r\n/g, "\n");

/** The ```scrml blocks of SPEC section `#### <num> …`, up to the next heading of level ≤ 4. */
function sectionBlocks(spec, num) {
  const text = lf(spec);
  const head = text.indexOf("\n#### " + num + " ");
  if (head < 0) throw new Error("SPEC section not found: " + num);
  const rest = text.slice(head + 1);
  const next = rest.slice(1).search(/\n#{1,4} /);
  const body = next < 0 ? rest : rest.slice(0, next + 1);
  return [...body.matchAll(/```scrml\n([\s\S]*?)```/g)].map((m) => m[1]);
}

describe("the §66.19 sources are the SPEC's code blocks, verbatim (drift guard)", () => {
  const spec = readFileSync(join(import.meta.dir, "..", "..", "SPEC.md"), "utf8");
  test("counter.scrml is §66.19.1's one block", () => {
    expect(sectionBlocks(spec, "66.19.1")).toEqual([lf(source("counter.scrml"))]);
  });
  test("lib/dropdown.scrml + app.scrml are the two §66.19.3 blocks, in order", () => {
    expect(sectionBlocks(spec, "66.19.3")).toEqual([lf(source("lib/dropdown.scrml")), lf(source("app.scrml"))]);
  });
  test("the guard bites: an edited §66.19.1 / §66.19.3 block, or another section's block, does not match", () => {
    const counter = lf(source("counter.scrml"));
    const edited = lf(spec).replace(counter, counter.replace("count", "kount"));
    expect(edited !== lf(spec)).toBe(true);       // the source IS in the SPEC to be edited
    expect(sectionBlocks(edited, "66.19.1")).not.toEqual([counter]);
    const app = lf(source("app.scrml"));
    const edited3 = lf(spec).replace(app, app.replace("Country", "Nation"));
    expect(edited3 !== lf(spec)).toBe(true);
    expect(sectionBlocks(edited3, "66.19.3")).not.toEqual([lf(source("lib/dropdown.scrml")), app]);
    // §66.19.2's block is a real scrml block of the SPEC, but it is not §66.19.1's
    expect(sectionBlocks(spec, "66.19.2").length).toBe(1);
    expect(sectionBlocks(spec, "66.19.1")).not.toContain(sectionBlocks(spec, "66.19.2")[0]);
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

  test("dropdown: typed (locked) attributes, an exported `let` CHILD (S447), a state-child graph field, `renders`", () => {
    const d = parse("d", source("lib/dropdown.scrml")).ast.items[1].k.data.d;
    expect(d.exported).toBe(true);
    // §66.4 rule 6 (S447): an attribute is always locked data — no grant on any
    expect(d.attrs.map((a) => [a.name, a.exported, a.isLet, a.ty.k.variant, a.dflt.variant ?? a.dflt])).toEqual([
      ["label", false, false, "TName", "NoValue"],
      ["options", false, false, "TSeq", "NoValue"],
    ]);
    // `export let <value:string=""/>` — the writable, exported field is a child declaration
    const value = d.body[0];
    expect(value.variant).toBe("ChildField");
    expect([value.data.d.name, value.data.d.exported, value.data.d.isLet, value.data.d.own.variant]).toEqual(["value", true, true, "Quoted"]);
    const open = d.body[1];
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

// S447 — keywords go OUTSIDE the declaration opener (§66.2.5, §66.4 rule 6,
// §66.5.1, §66.20; ruling:user-voice-scrml.md S447 "your recs", item 2).
describe("parse — S447 opener keywords (§66.2.5)", () => {
  const codes = (src) => parse("t.scrml", src).diags.map((d) => d.code);
  const decls = (src) => parse("t.scrml", src).ast.items[0].k.data.p.items.filter((i) => i.k.variant === "DeclItem").map((i) => i.k.data.d);

  test("`let <x/>` / `export let <x/>` / `export <x/>` before the `<` in a program body: the grant and the export, no diagnostic", () => {
    const src = "<program>\n    let <a:int=0/>\n    export let <b:bool=false/>\n    export <c:string=\"k\"/>\n    <d:int=1/>\n</program>";
    expect(codes(src)).toEqual([]);
    expect(decls(src).map((d) => [d.name, d.isLet, d.exported])).toEqual([
      ["a", true, false], ["b", true, true], ["c", false, true], ["d", false, false],
    ]);
  });

  test("a declaration body is an item position: `let` / `export let` before a child's `<` make a writable (exported) CHILD", () => {
    const src = "<program>\n    <box n:int=1>\n        let <k:int=0/>\n        export let <v:string=\"\"/>\n    </>\n</program>";
    expect(codes(src)).toEqual([]);
    const box = decls(src)[0];
    expect(box.attrs.map((a) => [a.name, a.isLet, a.exported])).toEqual([["n", false, false]]);
    expect(box.body.map((c) => [c.data.d.name, c.data.d.isLet, c.data.d.exported])).toEqual([["k", true, false], ["v", true, true]]);
  });

  test("BITE — the S435 in-opener `<let x/>` is E-DECL-LET-IN-OPENER, and the message names the S447 spelling", () => {
    const r = parse("t.scrml", "<program>\n    <let count:int=0/>\n</program>");
    expect(r.diags.map((d) => d.code)).toEqual(["E-DECL-LET-IN-OPENER"]);
    expect(r.diags[0].message).toContain("let <count");
    expect(r.diags[0].message).toContain("§66.2.5");
    // recovery: still the one declaration (no cascade)
    expect(decls("<program>\n    <let count:int=0/>\n</program>").map((d) => d.name)).toEqual(["count"]);
    // `<let/>` (no name, SF5) is refused too — it no longer passes silently
    expect(codes("<program>\n    <let/>\n</program>")).toEqual(["E-DECL-LET-IN-OPENER"]);
  });

  test("BITE — `let` anywhere else inside an opener: a trailing flag, or a grant on an attribute (§66.4 rule 6)", () => {
    expect(codes("<program><x:int=0 let/></program>")).toEqual(["E-DECL-LET-IN-OPENER"]);
    const attr = parse("t.scrml", "<program><box n:int=1 let k:int=0/></program>").diags;
    expect(attr.map((d) => d.code)).toEqual(["E-DECL-LET-IN-OPENER"]);
    expect(attr[0].message).toContain("child declaration");
    expect(attr[0].message).toContain("let <k:");
    expect(codes("<program><box n:int=1 export let k:int=0/></program>")).toEqual(["E-DECL-LET-IN-OPENER"]);
    // `export` alone on an attribute: the same rule (no grant on an attribute); no §66.20 code names it
    expect(codes("<program><box n:int=1 export k:int=0/></program>")).toEqual(["E-PARSE-ATTR"]);
  });

  test("BITE — `renders` inside an opener is E-DECL-RENDERS-IN-OPENER (never a generic parse error on the `<` after it)", () => {
    const r = parse("t.scrml", "<program>\n    let <email:string=\"\" req renders <input type=\"email\" bind:value=@email/>/>\n</program>");
    expect(r.diags.map((d) => d.code)).toEqual(["E-DECL-RENDERS-IN-OPENER"]);
    expect(r.diags[0].message).toContain("`renders` follows the closer");
    // the ruled spelling: after the closer
    expect(codes("<program>\n    let <email:string=\"\" req/>\n    renders <input type=\"email\" bind:value=@email/>\n</program>")).toEqual([]);
  });

  // S449 ruling item 2 (§66.2.5, narrowed): in a FREE-TEXT body the words are text; only a CODE-DEFAULT body
  // that is not an item position (an engine state-child body) reports the misplaced keyword.
  test("free-text bodies: `let` / `export` before a tag are TEXT (S449) — the words are kept, the tag is an element", () => {
    const r = parse("t.scrml", "<program>\n    <main><p>Please let <b>me</b> know</p><p>You can export <a href=\"/x\">a CSV</a></p></main>\n</program>");
    expect(r.diags).toEqual([]);
    const main = r.ast.items[0].k.data.p.items[0].k.data.n.k.data.e;
    const ps = main.kids.map((k) => k.k.data.e);
    expect(ps[0].kids.map((k) => k.k.variant === "Text" ? k.k.data.text : "<" + k.k.data.e.tag + ">")).toEqual(["Please let ", "<b>", " know"]);
    expect(ps[1].kids.map((k) => k.k.variant === "Text" ? k.k.data.text : "<" + k.k.data.e.tag + ">")).toEqual(["You can export ", "<a>"]);
  });

  test("BITE — `let` / `export` before a tag in a CODE-DEFAULT body (an engine state-child) is E-DECL-KEYWORD-NOT-ITEM", () => {
    const eng = (body) => "<program>\n    type Phase:enum = { Idle, Busy }\n    <phase:Phase=.Idle single>\n        <Idle rule=.Busy>" + body + "</>\n        <Busy rule=.Idle/>\n    </>\n</program>";
    expect(codes(eng("let <y:int=0/>"))).toContain("E-DECL-KEYWORD-NOT-ITEM");
    expect(codes(eng("export let <y:int=0/>"))).toContain("E-DECL-KEYWORD-NOT-ITEM");
    // a word that merely ENDS in "let" is not the keyword
    expect(codes(eng("outlet <b>x</b>"))).not.toContain("E-DECL-KEYWORD-NOT-ITEM");
  });

  test("BITE — the marker comes from the opener alone: `let <signup>` (no own value, no typed attribute) is not a declaration (SF2)", () => {
    expect(codes("<program>\n    let <signup>\n    </>\n</program>")).toEqual(["E-PARSE-LET"]);
    expect(codes("<program>\n    let <signup:struct>\n        let <email:string=\"\"/>\n    </>\n</program>")).toEqual([]);
  });

  // PA reading S449 (for veto) on ruling item 2: free text stays prose UNLESS the tag is a declaration by its opener.
  test("BITE — free text: `let` before a DECLARATION opener (`<p>let <x:int=0/></p>`) is still E-DECL-KEYWORD-NOT-ITEM, naming the `${\"let\"}` escape", () => {
    const r = parse("t.scrml", "<program>\n    <main><p>let <x:int=0/></p></main>\n</program>");
    expect(r.diags.map((d) => d.code)).toEqual(["E-DECL-KEYWORD-NOT-ITEM"]);
    expect(r.diags[0].message).toContain("free-text body of `<p>`");
    expect(r.diags[0].message).toContain("${\"let\"}");
    // a hyphenated or embedded word is not the keyword (markup word boundary)
    expect(codes("<program>\n    <main><p>re-let <x:int=0/> outlet <y:int=1/></p></main>\n</program>")).toEqual([]);
  });

  test("`renders` is reserved only as a clause in a DECLARATION opener (§66.5.1): elsewhere it is an ordinary attribute name", () => {
    expect(codes("<program>\n    <main><div renders=\"x\">a</div></main>\n</program>")).toEqual([]);
    expect(codes("<program>\n    <card renders:string=\"x\"/>\n    renders <p>${renders}</p>\n</program>")).toEqual([]);
    // a markup element inside a plain element's opener: a tag error, not the declaration code
    expect(codes("<program>\n    <main><div renders <b/>>a</div></main>\n</program>")).toEqual(["E-PARSE-TAG"]);
  });

  test("`let` inside the opener of a tag that declares nothing: the message says drop it, never `let <input/>` (which is E-PARSE-LET)", () => {
    for (const src of ["<program>\n    <main><input let/></main>\n</program>", "<program>\n    <let div/>\n</program>"]) {
      const r = parse("t.scrml", src);
      expect(r.diags.map((d) => d.code)).toEqual(["E-DECL-LET-IN-OPENER"]);
      expect(r.diags[0].message).toContain("declares nothing");
      expect(r.diags[0].message).not.toContain("goes BEFORE");
    }
    expect(parse("t.scrml", "<program><x:int=0 let/></program>").diags[0].message).toContain("write `let <x…/>`");
  });

  test("BITE — `renders<p>…</p>` with NO space inside a declaration opener is E-DECL-RENDERS-IN-OPENER, not a generic error on the `<`", () => {
    const r = parse("t.scrml", "<program>\n    let <email:string=\"\" req renders<input type=\"email\" bind:value=@email/>/>\n</program>");
    expect(r.diags.map((d) => d.code)).toEqual(["E-DECL-RENDERS-IN-OPENER"]);
    expect(r.diags[0].message).toContain("`renders` follows the closer");
  });

  test("BITE — `export` inside an opener (`<export x/>`, `<export let x/>`, a trailing `export`) is refused, never a tag named `export`", () => {
    for (const [src, kw] of [["<program>\n    <export x:int=0/>\n</program>", "export"],
                             ["<program>\n    <export let x:int=0/>\n</program>", "export let"],
                             ["<program>\n    <x:int=0 export/>\n</program>", "export"]]) {
      const r = parse("t.scrml", src);
      expect(r.diags.map((d) => d.code)).toEqual(["E-DECL-LET-IN-OPENER"]);
      expect(r.diags[0].message).toContain("`" + kw + "` goes BEFORE the `<`");
      expect(r.diags[0].message).toContain(kw + " <x");
      const d = r.ast.items[0].k.data.p.items[0];
      expect(d.k.variant).toBe("DeclItem");
      expect(d.k.data.d.name).toBe("x");
    }
  });

  test("⚑ O61: a `<page>` / `<theme>` body reports no keyword itself — both are refused whole (fail-closed, one code)", () => {
    expect(codes("<program>\n    <page>\n        let <x:int=0/>\n    </page>\n</program>")).toEqual([]);
    expect(codes("<program>\n    <theme>\n        export <brand:string=\"#000\"/>\n    </theme>\n</program>")).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
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

  test("F-C: `let <count:int = 0/>` — §66.2.2 says `=` IMMEDIATELY after the name / `name:Type`: one diagnostic each", () => {
    const r = parse("t.scrml", "<program>let <count:int = 0/><card title:string = \"x\"/></program>");
    expect(r.diags.map((d) => d.code)).toEqual(["E-PARSE-OPENER-EQ-SPACED", "E-PARSE-OPENER-EQ-SPACED"]);
    expect(parse("t.scrml", "<program>let <count:int=0/></program>").diags).toEqual([]);
  });
});
