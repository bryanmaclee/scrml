// tape-write-forms.test.js — s469-boot-tape-grants: NO WRITE FORM BYPASSES THE
// TAPE GRANTS (SPEC §66.12.3 "Permissions live on the TYPE"; §66.12.6 "No
// position escapes the grants", rules 1 and 4; O63 RULED S469).
//
// The bootstrap judges every write to a tape-typed place with ONE predicate,
// `grantsAdmit` over a GrantSet read off the TYPE (`tapeGrants`, analyze.scrml
// "THE TAPE GRANT READER"). This file is the structural proof:
//   1. FORMS enumerates every way the bootstrap's surface can write a tape — a
//      cell, a struct field, a whole struct (genuine / spread / opaque / nested),
//      an element field, a reset, a local rebinding, a local's edit / part write,
//      a parameter, a call argument, the JS mutators. Each form's UNGRANTED
//      spelling must be refused (pinned codes), and its GRANTED spelling (where
//      the bootstrap can lower one) must be clean — so the refusal is the grant
//      check, not an accident of the form.
//   2. The source of analyze.scrml is scanned by grant-scan.js (s469 F2:
//      structural, on tokens): outside the reader no GrantSet is named, held or
//      read — every spelling the round-2 review planted is a must-fail control,
//      run through the REAL scan function.
// A new write form added to the bootstrap belongs in FORMS.

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadM2, frontEnd } from "./harness.js";
import { grantReadsOutsideReader, READER_START, READER_END } from "./grant-scan.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const prog = (decls, body) => `<program>\n${decls}    let <shown:string=""/>\n    function go() {\n        ${body}\n    }\n    <main><button onclick=go()>go</button><p>\${@shown}</p></main>\n</program>\n`;
const codes = (decls, body) => frontEnd(mods, [{ path: "w.scrml", src: prog(decls, body) }]).diags.map((d) => d.code);

const cell = (t) => `    <xs:${t}=([])/>\n`;
const box = (t) => `    type Box:struct = { title: string, xs: ${t} }\n    let <b:Box=({ title: "t", xs: [] })/>\n`;
const nested = (t) => `    type Inner:struct = { ys: ${t} }\n    type Outer:struct = { name: string, inner: Inner }\n    let <o:Outer=({ name: "o", inner: { ys: [] } })/>\n`;
const elems = (t) => `    type K:struct = { name: string, kids: ${t} }\n    <ks:K[free, append]=([])/>\n`;
const param = (t) => `    <src:${t}=([])/>\n    function size(xs: int[free, append]) -> int {\n        return xs.length;\n    }\n`;

// [form, refused: [decls, body, codes], granted: [decls, body, codes] | null]
const FORMS = [
  // ---- a cell / declaration field (resolveEditCall, resolveRemoveCall, resolveSeqShape, wholeFieldWrite, resolveReset)
  ["cell: `.append(v)`", [cell("int[]"), "@xs.append(1);", ["E-WRITE-NOT-GRANTED"]], [cell("int[free, append]"), "@xs.append(1);", []]],
  ["cell: `.prepend(v)`", [cell("int[free, append]"), "@xs.prepend(1);", ["E-WRITE-NOT-GRANTED"]], [cell("int[free, prepend]"), "@xs.prepend(1);", []]],
  ["cell: `.pop()`", [cell("int[free, append]"), "@xs.pop();", ["E-WRITE-NOT-GRANTED"]], [cell("int[free, pop]"), "@xs.pop();", []]],
  ["cell: `.shift()`", [cell("int[free, pop]"), "@xs.shift();", ["E-WRITE-NOT-GRANTED"]], [cell("int[free, remove]"), "@xs.shift();", []]],
  ["cell: `@xs = [...@xs, v]` (end-append shape)", [cell("int[free, prepend]"), "@xs = [...@xs, 1];", ["E-WRITE-NOT-GRANTED"]], [cell("int[free, append]"), "@xs = [...@xs, 1];", []]],
  ["cell: `@xs = [v, ...@xs]` (front-prepend shape)", [cell("int[free, append]"), "@xs = [1, ...@xs];", ["E-WRITE-NOT-GRANTED"]], [cell("int[free, prepend]"), "@xs = [1, ...@xs];", []]],
  ["cell: `@xs = @xs.filter(…)` (shrink-anywhere)", [cell("int[free, append, pop]"), "@xs = @xs.filter(x => x > 0);", ["E-WRITE-NOT-GRANTED"]], [cell("int[free, remove]"), "@xs = @xs.filter(x => x > 0);", []]],
  ["cell: `@xs = @xs.map(…)` (position write)", [cell("int[free, append]"), "@xs = @xs.map(x => x + 1);", ["E-WRITE-NOT-GRANTED"]], [cell("int[write]"), "@xs = @xs.map(x => x + 1);", []]],
  ["cell: `@xs = @xs.sort()` (position write)", [cell("int[free, append]"), "@xs = @xs.sort();", ["E-WRITE-NOT-GRANTED"]], [cell("int[write]"), "@xs = @xs.sort();", []]],
  ["cell: `@xs = v` (replace)", [cell("int[free, append]"), "@xs = [1];", ["E-WRITE-NOT-GRANTED"]], [cell("int[replace]"), "@xs = [1];", []]],
  ["cell: `reset(@xs)` (replace)", [cell("int[free, append]"), "reset(@xs);", ["E-WRITE-NOT-GRANTED"]], [cell("int[replace]"), "reset(@xs);", []]],
  ["cell: JS `push` / `unshift` / `splice` (refused by name)", [cell("int[free, insert, remove]"), "@xs.push(1);", ["E-TAPE-JS-METHOD"]], null],
  ["cell: `@xs[i] = v` (position write)", [cell("int[free, append]"), "@xs[0] = 1;", ["E-BOOTSTRAP-UNSUPPORTED"]], null],

  // ---- a struct field whose type is a tape (fieldAtWrite) — its OWN grants, never the owner's `let`
  ["struct field: `@b.xs = v`", [box("int[free, append]"), "@b.xs = [1];", ["E-WRITE-NOT-GRANTED"]], [box("int[free, append, replace]"), "@b.xs = [1];", []]],
  ["struct field: `@b.xs = v` on an UNGRANTED tape", [box("int[]"), "@b.xs = [1];", ["E-WRITE-NOT-GRANTED"]], null],
  ["struct field: `let xs: T[]` (let on a sequence)", [`    type L:struct = { title: string, let xs: int[] }\n    let <l:L=({ title: "t", xs: [] })/>\n`, "@l.title = \"u\";", ["E-GRANT-LET-ON-SEQUENCE"]], null],
  ["struct field: an edit of a sub-field tape (`.append`)", [box("int[free, append]"), "@b.xs.append(1);", ["E-BOOTSTRAP-UNSUPPORTED"]], null],
  ["struct field: an edit shape of a sub-field tape", [box("int[free, append]"), "@b.xs = [...@b.xs, 1];", ["E-BOOTSTRAP-UNSUPPORTED"]], null],

  // ---- a WHOLE-STRUCT write replaces its tape fields (structTapeWrites, §66.12.6 rule 4)
  ["whole struct: genuine replace changing `xs`", [box("int[free, append]"), "@b = { title: \"u\", xs: [] };", ["E-WRITE-NOT-GRANTED"]], [box("int[free, append]"), "@b = { title: \"u\", xs: @b.xs };", []]],
  ["whole struct: spread override of `xs`", [box("int[free, append]"), "@b = { ...@b, xs: [] };", ["E-WRITE-NOT-GRANTED"]], [box("int[free, append]"), "@b = { ...@b, title: \"u\" };", []]],
  ["whole struct: an opaque value (a name)", [box("int[free, append]"), "const nb: Box = { title: \"u\", xs: [] };\n        @b = nb;", ["E-WRITE-NOT-GRANTED"]], [box("int[free, append, replace]"), "const nb: Box = { title: \"u\", xs: [] };\n        @b = nb;", []]],
  ["whole struct: a tape in a NESTED struct field", [nested("int[free, append]"), "@o = { name: \"n\", inner: { ys: [] } };", ["E-WRITE-NOT-GRANTED"]], [nested("int[free, append]"), "@o = { name: \"n\", inner: @o.inner };", []]],
  ["whole struct: a struct-typed FIELD written whole", [nested("int[free, append]"), "@o.inner = { ys: [] };", ["E-WRITE-NOT-GRANTED"]], [nested("int[free, append, replace]"), "@o.inner = { ys: [] };", []]],
  ["whole struct: `reset(@b)` (refused: run-time dependent)", [box("int[free, append]"), "reset(@b);", ["E-BOOTSTRAP-UNSUPPORTED"]], [box("int[free, append, replace]"), "reset(@b);", []]],

  // ---- an element field (resolveElemFieldWrite)
  ["element field: `@ks[i].kids = v`", [elems("int[]"), "@ks[0].kids = [1];", ["E-WRITE-NOT-GRANTED"]], [elems("int[replace]"), "@ks[0].kids = [1];", []]],

  // ---- a LOCAL (localTapeProblems, run by the typer): `let` grants the tape nothing (O63)
  ["local: rebinding (replace)", ["", "let out: string[] = [\"a\"];\n        out = [];\n        @shown = out.join(\",\");", ["E-WRITE-NOT-GRANTED"]], ["", "let out: string[replace] = [\"a\"];\n        out = [\"b\"];\n        @shown = out.join(\",\");", []]],
  ["local: `out = out.sort()` (position write)", ["", "let out: string[] = [\"b\", \"a\"];\n        out = out.sort();\n        @shown = out.join(\",\");", ["E-WRITE-NOT-GRANTED"]], ["", "let out: string[write] = [\"b\", \"a\"];\n        out = out.sort();\n        @shown = out.join(\",\");", []]],
  ["local: `out = out.filter(…)` (shrink-anywhere)", ["", "let out: string[free, append] = [\"a\"];\n        out = out.filter(x => x != \"a\");\n        @shown = out.join(\",\");", ["E-WRITE-NOT-GRANTED"]], ["", "let out: string[free, remove] = [\"a\"];\n        out = out.filter(x => x != \"a\");\n        @shown = out.join(\",\");", []]],
  ["local: an inferred (un-annotated) tape", ["", "let out = [\"a\"];\n        out = [\"b\"];", ["E-WRITE-NOT-GRANTED"]], null],
  ["local: an inferred tape from a granted cell (`let s = @xs`)", [cell("int[free, append, remove]"), "let s = @xs;\n        s = s.filter(x => x > 0);", ["E-WRITE-NOT-GRANTED"]], [cell("int[free, append, remove]"), "let s: int[free, remove] = @xs;\n        s = s.filter(x => x > 0);", []]],
  ["local: a struct local rebound whole", [box("int[free, append]"), "let q: Box = @b;\n        q = { title: \"u\", xs: [] };", ["E-WRITE-NOT-GRANTED"]], [box("int[free, append]"), "let q: Box = @b;\n        q = { title: \"u\", xs: q.xs };", []]],
  ["local: an in-place edit (`.append`)", ["", "let out: int[free, append] = [];\n        out.append(1);", ["E-BOOTSTRAP-UNSUPPORTED"]], null],
  ["local: a part write (`q.xs = v`)", [box("int[free, append, replace]"), "let q: Box = @b;\n        q.xs = [];", ["E-BOOTSTRAP-UNSUPPORTED"]], null],
  ["local: a `const` tape rebound", ["", "const out: int[replace] = [1];\n        out = [2];", ["E-ASSIGN-CONST"]], null],
  ["local: a `for … of` binder rebound (inferred: no grants)", ["", "for (let x of [[1], [2]]) {\n            x = [3];\n        }", ["E-WRITE-NOT-GRANTED"]], null],
  ["parameter: rebound — §50 refuses the rebinding; the tape write is judged by the WRITTEN type",
    ["    function h(xs: int[]) -> int {\n        xs = [1];\n        return 1;\n    }\n", "const n = h([]);", ["E-ASSIGN-CONST", "E-WRITE-NOT-GRANTED"]],
    ["    function h(xs: int[replace]) -> int {\n        xs = [1];\n        return 1;\n    }\n", "const n = h([]);", ["E-ASSIGN-CONST"]]],
  ["whole struct: a self-spread overridden by a later spread (not kept)", [box("int[free, append]"), "const nb: Box = { title: \"u\", xs: [] };\n        @b = { ...@b, ...nb };", ["E-WRITE-NOT-GRANTED"]], null],

  // ---- a call argument (checkArgTape, §66.12.3 subset) — the code is unruled: fail closed
  ["call: a place granting less than the parameter", [param("int[]"), "const n = size(@src);", ["E-BOOTSTRAP-UNSUPPORTED"]], [param("int[free, append, pop]"), "const n = size(@src);", []]],
];

describe("every tape write form is judged by the grant reader (§66.12.6)", () => {
  for (const [form, refused, granted] of FORMS) {
    test(`${form} — ungranted: refused`, () => {
      const [d, b, want] = refused;
      const got = codes(d, b);
      expect(got.length).toBeGreaterThan(0);
      expect(got.filter((c) => want.includes(c))).toEqual(want);
    });
    if (granted) {
      test(`${form} — granted: no grant refusal`, () => {
        const [d, b, want] = granted;
        expect(codes(d, b)).toEqual(want);
      });
    }
  }
});

// review r2 L1: the Core checker (check.scrml C3) judges rule 4 as the analyzer does, so
// a Core that slips past analyze is still refused. Each case starts from a clean lowered
// Core and plants the bypass by hand.
describe("Core check C3 judges a tape field's grants (the defence in depth, §66.12.6 rule 4)", () => {
  const coreOf = (decls, body) => {
    const r = frontEnd(mods, [{ path: "w.scrml", src: prog(decls, body) }]);
    expect(r.diags.map((d) => d.code)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    return structuredClone(r.core);
  };
  const find = (n, pred, out = []) => {
    if (n && typeof n === "object") {
      if (pred(n)) out.push(n);
      for (const v of Object.values(n)) find(v, pred, out);
    }
    return out;
  };
  const writes = (core) => find(core.fns, (n) => n.variant === "Write");
  const boxField = (core, name) => find(core.types, (n) => n.sym && n.sym.hint === name && n.grants)[0];
  test("a whole-struct Replace whose value replaces an append-only tape field", () => {
    const core = coreOf(box("int[free, append]"), "@b = { title: \"u\", xs: @b.xs };");
    const w = writes(core).find((x) => x.data.edit === "Replace" || x.data.edit?.variant === "Replace");
    w.data.value.data.fields[1] = { variant: "ArrayOf", data: { elems: [] } };
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C3:") && m.includes("tape field `b.xs`"))).toBe(true);
  });
  test("a Replace with an opaque value (a reset's InitOf, a Local) replaces every tape field", () => {
    const core = coreOf(box("int[free, append]"), "@b = { title: \"u\", xs: @b.xs };");
    const w = writes(core).find((x) => x.data.edit === "Replace" || x.data.edit?.variant === "Replace");
    w.data.value = { variant: "Lit", data: { lit: { variant: "Absent" } } };
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C3:") && m.includes("tape field `b.xs`"))).toBe(true);
  });
  test("a FieldAt write of an UNGRANTED tape under the owner's `replace` (fieldAtProblem: a tape is a contract)", () => {
    const core = coreOf(box("int[replace]"), "@b.xs = [1];");
    boxField(core, "xs").grants.replace = false;            // now `xs: int[]` — no grant, no edits
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C3:") && m.includes("non-replace contract"))).toBe(true);
  });
  test("a FieldAt write of a struct-typed field replaces the tape inside it", () => {
    const core = coreOf(nested("int[free, append, replace]"), "@o.inner = { ys: [] };");
    boxField(core, "ys").grants.replace = false;
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C3:") && m.includes("tape field `o.inner.ys`"))).toBe(true);
  });
});

describe("no write path reads a grant outside the reader (analyze.scrml source; s469 F2: structural)", () => {
  const src = readFileSync(join(import.meta.dir, "..", "analyze.scrml"), "utf8");
  const core = readFileSync(join(import.meta.dir, "..", "core.scrml"), "utf8");
  const scan = (s) => grantReadsOutsideReader(s, [core]);
  const AT = "fn persistCellProblem(";
  const plant = (code) => {
    expect(src.includes(AT)).toBe(true);
    return src.replace(AT, code + "\n    " + AT);
  };
  test("the reader's range is marked", () => {
    expect(src.indexOf(READER_START)).toBeGreaterThan(0);
    expect(src.indexOf(READER_END)).toBeGreaterThan(src.indexOf(READER_START));
  });
  test("a second copy of a range marker (a comment quoting it) fails the scan instead of widening the range", () => {
    const early = src.replace("fn ", `// see ${READER_START}) below\n    fn `);
    expect(scan(early).some((v) => v.rule === "range")).toBe(true);
  });
  test("outside the reader, no GrantSet is named, held or read (no allow-list)", () => {
    expect(scan(src).map((v) => `${v.line} ${v.rule}: ${v.text}`)).toEqual([]);
  });
  test("the retired `shrinkGranted` / `grantsEdit` readers are gone", () => {
    expect(src.includes("fn shrinkGranted")).toBe(false);
    expect(src.includes("fn grantsEdit(")).toBe(false);
  });
  test("the one predicate exists and is the reader the write paths call", () => {
    expect(src).toContain("fn grantsAdmit(gs: GrantSet, edit: EditKind) -> boolean");
    expect((src.match(/grantsAdmit\(/g) || []).length).toBeGreaterThanOrEqual(15);
  });
  // Must-fail controls: each spelling the round-2 review planted (and scored 0
  // hits against the old regex) must be reported by the REAL scan function.
  const PLANTS = {
    "member read": "fn plantedRead(f: FieldInfo) -> boolean { return f.grants.replace }",
    "typed alias": "fn plantedRead(f: FieldInfo) -> boolean {\n        const g: GrantSet = f.grants\n        return g.replace\n    }",
    "untyped alias": "fn plantedRead(f: FieldInfo) -> boolean {\n        const g = f.grants\n        return g.replace\n    }",
    "helper outside the range": "fn isRep(x: GrantSet) -> boolean { return x.replace }\n    fn plantedRead(f: FieldInfo) -> boolean { return isRep(f.grants) }",
    "untyped helper outside the range": "fn isRep(x) -> boolean { return x.replace }\n    fn plantedRead(f: FieldInfo) -> boolean { return isRep(f.grants) }",
    "destructure `{ replace } = f.grants`": "fn plantedRead(f: FieldInfo) -> boolean {\n        const { replace } = f.grants\n        return replace\n    }",
    "destructure `{ grants } = f`": "fn plantedRead(f: FieldInfo) -> boolean {\n        const { grants } = f\n        return grants.replace\n    }",
    "destructure `{ grants: q } = f`": "fn plantedRead(f: FieldInfo) -> boolean {\n        const { grants: q } = f\n        return q.replace\n    }",
    "bracket `f[\"grants\"][\"replace\"]`": "fn plantedRead(f: FieldInfo) -> boolean { return f[\"grants\"][\"replace\"] }",
    "spaced `f.grants .replace`": "fn plantedRead(f: FieldInfo) -> boolean { return f.grants .replace }",
    "`g.edits.length`": "fn plantedRead(f: FieldInfo) -> boolean {\n        const g: GrantSet = f.grants\n        return g.edits.length > 0\n    }",
    "hasEditKind over an alias": "fn plantedRead(f: FieldInfo) -> boolean {\n        const gg: GrantSet = f.grants\n        return gg.replace || hasEditKind(gg.edits, EditKind.Append)\n    }",
    "a reader's GrantSet result held": "fn plantedRead(f: FieldInfo) -> boolean {\n        const tg = tapeGrants(f.ty)\n        if (tg is not) return false\n        return grantsAdmit(tg, EditKind.Replace)\n    }",
    "a reader's GrantSet result read": "fn plantedRead(f: FieldInfo) -> boolean { return noGrants().replace }",
    "a SeqGrants `replace` read off the type": "fn plantedRead(t: Type) -> boolean {\n        return match t {\n            .Seq(elem: e, grants: g) :> g.replace\n            .Int :> false\n        }\n    }",
    "a GrantSet-returning helper outside the range": "fn myGrants(f: FieldInfo) -> GrantSet { return noGrants() }",
  };
  for (const [name, code] of Object.entries(PLANTS)) {
    test(`must-fail control: ${name}`, () => {
      expect(scan(plant(code)).length).toBeGreaterThan(0);
    });
  }
  test("must-fail control, END TO END: a helper outside the reader decides the `persist=\"local\"` admission (the round-2 hole)", () => {
    const decide = "(f.graph is given || !grantsAdmit(f.grants, EditKind.Replace))) {";
    expect(src.includes(decide)).toBe(true);
    const s = plant("fn plantedRep(x: GrantSet) -> boolean { return x.replace || true }")
      .replace(decide, "(f.graph is given || !plantedRep(f.grants))) {");
    const hits = scan(s);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.some((h) => h.text.includes("plantedRep(f.grants)"))).toBe(true);
  });
  test("a construction outside the reader is not a read (copy into a `grants:` slot; a reader call's argument)", () => {
    const ok = plant("fn plantedCopy(f: FieldInfo) -> FieldDef { return { sym: f.sym, ty: f.ty, grants: f.grants } }\n    fn plantedAsk(f: FieldInfo) -> boolean { return grantsAdmit(f.grants, EditKind.Replace) }\n    fn plantedNew(f: FieldInfo) -> FieldDef { return { sym: f.sym, ty: f.ty, grants: noGrants() } }");
    expect(scan(ok)).toEqual([]);
  });
});
