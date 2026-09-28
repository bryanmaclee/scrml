// tables.test.js — M3 item 2: the analyze tables split by FACT FAMILY and
// indexed by NodeId (analyze.scrml, THE NODE FACTS). The refactor is inert —
// every Core and diagnostic is unchanged (the M2 / typer suites hold that) —
// so what is proved here is the TABLES' OWN shape:
//   - ONE FACT PER NODE: every recorded fact is reachable through its
//     family's index (a second fact about a node in the same family would
//     sit in the list unindexed — the count check catches it), the index
//     agrees with the key column (`nids[at[nid]] == nid`), and no node is
//     answered by two families (the binder resolves each node once; this is
//     what keeps a family lookup equal to the single first-match scan it
//     replaced);
//   - each family's facts are about the node KIND that family describes
//     (names on names / members, values on literals / operators, effects on
//     statement-position assignments / calls, binders on locals / fns /
//     params / `given`, elements on elements, attributes on attributes) —
//     which also catches an index that points one node off;
//   - `exprType` (the typer's indexed table) answers what a first-match scan
//     of `typing.exprs` answers, for every NodeId (and `Unknown` outside).

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadM2 } from "./harness.js";
import { frontEnd, readSlice, PROGRAMS } from "./lowered.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const LIB = () => ({ path: "lib/dropdown.scrml", src: readSlice("src/lib/dropdown.scrml") });

// A program that reaches every family and every fact shape the binder records.
const EVERY_FACT = {
  path: "app.scrml",
  src: [
    "${ import { dropdown, Openness } from \"./lib/dropdown.scrml\" }",
    "<program>",
    "    type Line:struct = { id: int, name: string }",
    "    type Pt:struct = { let x: int, let y: int }",
    "    <lines:Line[free, end, front]=([{ id: 1, name: \"Tea\" }])/>",
    "    <let p:Pt=({ x: 0, y: 0 })/>",
    "    <let n:int=0/>",
    "    <let show:bool=true/>",
    "    function bump(k: int) -> int {",
    "        let a = k + 1",
    "        a = a * 2",
    "        @n = a",
    "        @p = { ...@p, x: a }",
    "        @lines.push({ id: a, name: \"x\" })",
    "        reset(@n)",
    "        return @lines.length",
    "    }",
    "    function pick() { given c = @color :> { c.value = \"b\" } }",
    "    <main>",
    "        <p if=@show class=\"k\">${@n} ${!@show} ${@p.x} ${.Closed == .Closed}</p>",
    "        <div if=@show><dropdown as=color label=\"L\" options=([\"a\"])/></div>",
    "        <each in=@lines key=@.id as line><span>${@.name}</span></each>",
    "        <button onclick=bump(1)>go</button>",
    "    </main>",
    "</program>",
    "",
  ].join("\n"),
};

function programs() {
  const out = Object.entries(PROGRAMS).map(([name, fs]) => ({ name, files: fs.map((f) => ({ path: f.path, src: readSlice(f.rel) })) }));
  out.push({ name: "every-fact", files: [LIB(), EVERY_FACT] });
  const spec = readFileSync(join(import.meta.dir, "..", "..", "SPEC.md"), "utf8");
  const sec = spec.slice(spec.indexOf("### 66.19 Worked programs"), spec.indexOf("### 66.20 Diagnostics"));
  [...sec.matchAll(/```scrml\n([\s\S]*?)```/g)].forEach((m, i) => out.push({ name: `§66.19 block ${i}`, files: [{ path: "p.scrml", src: m[1] }] }));
  return out;
}

const EXPR = new Set(["Name", "At", "AtItem", "Num", "Str", "Bool", "NotLit", "Recovered", "Variant", "Member", "Call",
  "Unary", "Binary", "Ternary", "Assign", "ArrayLit", "ObjectLit"]);
const STMT = new Set(["Eval", "Local", "Return", "If", "Given"]);
const ATTR_VALUE = new Set(["Quoted", "Bare", "Paren", "Braced"]);
const tag = (x) => (typeof x === "string" ? x : x && x.variant);

// NodeId → what kind of node it is ("expr:Name", "stmt:Local", "elem", "attr", "param", "fn", …).
function nodeKinds(asts) {
  const kinds = new Map();
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n === null || typeof n !== "object") return;
    if (typeof n.nid === "number") {
      let kind = null;
      if (n.k && EXPR.has(tag(n.k))) kind = "expr:" + tag(n.k);
      else if (n.k && STMT.has(tag(n.k))) kind = "stmt:" + tag(n.k);
      else if (typeof n.tag === "string" && Array.isArray(n.attrs) && Array.isArray(n.kids)) kind = "elem";
      else if (typeof n.name === "string" && "value" in n && (n.value === "NoValue" || ATTR_VALUE.has(tag(n.value)))) kind = "attr";
      else if (Array.isArray(n.params) && n.body) kind = "fn";
      else if (typeof n.name === "string" && "ty" in n && Object.keys(n).length === 4) kind = "param";
      if (kind !== null) kinds.set(n.nid, kind);
    }
    Object.values(n).forEach(walk);
  })(asts);
  return kinds;
}

// Which node kinds each family may describe.
const FAMILY_KINDS = {
  names: (k) => ["expr:Name", "expr:At", "expr:AtItem", "expr:Member"].includes(k),
  values: (k) => ["expr:Num", "expr:Str", "expr:Bool", "expr:NotLit", "expr:Variant", "expr:Unary", "expr:Binary", "expr:ObjectLit"].includes(k),
  effects: (k) => ["expr:Assign", "expr:Call"].includes(k),
  binds: (k) => ["stmt:Local", "stmt:Given", "fn", "param"].includes(k),
  elems: (k) => k === "elem",
  attrs: (k) => k === "attr",
};
const FAMILIES = Object.keys(FAMILY_KINDS);

describe("the node facts — one family per node, indexed by NodeId", () => {
  const seen = Object.fromEntries(FAMILIES.map((f) => [f, new Set()]));
  for (const p of programs()) {
    test(`${p.name}: every fact indexed once, on a node of its family's kind`, () => {
      const r = frontEnd(mods, p.files);
      const t = r.typed.tables;
      const kinds = nodeKinds(r.asts);
      const owner = new Map();
      for (const fam of FAMILIES) {
        const tbl = t[fam];
        const positions = new Set();
        tbl.at.forEach((pos, nid) => {
          if (pos < 0) return;
          expect(pos).toBeLessThan(tbl.facts.length);
          expect(tbl.nids[pos]).toBe(nid);                  // the index agrees with the key column
          expect(positions.has(pos)).toBe(false);          // injective: one node per fact
          positions.add(pos);
          expect(owner.has(nid) ? `${nid} in ${owner.get(nid)} and ${fam}` : "").toBe("");
          owner.set(nid, fam);
          const kind = kinds.get(nid) ?? "(no node)";
          expect(`${fam} → ${kind}: ${FAMILY_KINDS[fam](kind)}`).toBe(`${fam} → ${kind}: true`);
          seen[fam].add(tag(tbl.facts[pos]));
        });
        expect(positions.size).toBe(tbl.facts.length);     // every recorded fact is reachable
      }
    });
    test(`${p.name}: no NodeId appears twice in any family's key column`, () => {
      // The index answers a node's FIRST entry; that is only the old
      // first-match scan's answer if there is never a second one to choose.
      const t = frontEnd(mods, p.files).typed.tables;
      for (const fam of FAMILIES) {
        const nids = t[fam].nids;
        const dups = nids.filter((n, i) => nids.indexOf(n) !== i);
        expect(`${fam}: ${dups.join(",")}`).toBe(`${fam}: `);
      }
    });
  }
  test("the programs above reach every fact variant of every family", () => {
    expect(Object.fromEntries(FAMILIES.map((f) => [f, [...seen[f]].sort()]))).toEqual({
      names: ["NField", "NFn", "NInst", "NLength", "NLocal", "NStruct"],
      values: ["VLit", "VOp", "VStructOf", "VVariant"],
      effects: ["EAssignLocal", "EReset", "ESpread", "EWrite"],
      binds: ["BBind", "BGiven", "BParam"],
      elems: ["MEach", "MHtml", "MSlot", "MUse"],
      attrs: ["AAs", "ABound", "AConstruct", "AEachAs", "AEachIn", "AEachKey", "AIf", "AOn", "AStatic"],
    });
  });
  test("the every-fact program is a legal program (no diagnostic)", () => {
    expect(frontEnd(mods, [LIB(), EVERY_FACT]).diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  });
  test("a lookup outside the index — a negative or unrecorded NodeId — answers `not`", () => {
    const t = frontEnd(mods, [LIB(), EVERY_FACT]).typed.tables;
    for (const nid of [-1, -7, 1e6]) {
      expect(mods.analyze.nameFact(t.names, nid)).toBeNull();
      expect(mods.analyze.valueFact(t.values, nid)).toBeNull();
      expect(mods.analyze.effectFact(t.effects, nid)).toBeNull();
      expect(mods.analyze.bindFact(t.binds, nid)).toBeNull();
      expect(mods.analyze.elemFact(t.elems, nid)).toBeNull();
      expect(mods.analyze.attrFact(t.attrs, nid)).toBeNull();
    }
  });
});

describe("the typer's table — exprType is an O(1) index over typing.exprs", () => {
  for (const p of programs()) {
    test(`${p.name}: no NodeId appears twice in typing.exprs`, () => {
      // Same reason as the families: first-wins in typingOf is unobservable
      // (and so unguarded) unless no node is typed twice.
      const nids = frontEnd(mods, p.files).typed.tables.typing.exprs.map((x) => x.nid);
      expect(nids.filter((n, i) => nids.indexOf(n) !== i)).toEqual([]);
    });
    test(`${p.name}: exprType(nid) = the first typing entry for nid, for every NodeId`, () => {
      const r = frontEnd(mods, p.files);
      const t = r.typed.tables;
      const first = new Map();
      for (const x of t.typing.exprs) if (!first.has(x.nid)) first.set(x.nid, x.vt);
      for (let nid = -2; nid < r.nodes + 2; nid++) {
        expect(mods.analyze.exprType(t, nid)).toEqual(first.has(nid) ? first.get(nid) : "Unknown");
      }
    });
  }
});
