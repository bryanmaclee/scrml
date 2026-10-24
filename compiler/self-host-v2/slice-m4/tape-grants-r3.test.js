// tape-grants-r3.test.js — s469-boot-tape-grants-2: the final-review
// follow-ups of #1528 (SPEC §66.12.6 "No position escapes the grants").
//
//   F1  an ENUM PAYLOAD is a tape position: a whole enum value (a write, a
//       transition, `reset`, `reset-on=`, `persist="local"`'s cross-tab value)
//       may replace a tape held in a variant payload — directly or inside a
//       payload struct. A `replace`-less one is refused E-BOOTSTRAP-UNSUPPORTED
//       (fresh value vs `replace` on a variant switch is an owner question); Core
//       C3 / C17 refuse the same on a planted Core.
//   F3  `@o = { ...@o, inner: { ys: @o.inner.ys } }` (and the instance form) is
//       accepted by the analyzer AND by Core: Core reads a read through the
//       spread's snapshot Local as the place it snapshots.
//   F4  identity overrides (`xs: @b.xs`, `inner: @o.inner`) are keeps, not
//       `replace`s.
// (F2, the structural scan, is in tape-write-forms.test.js.)

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src, files) => frontEnd(mods, files ?? [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const P = (decls, fn = "", main = `        <p>x</p>\n`) => `<program>\n${decls}${fn ? `    function go() {\n        ${fn}\n    }\n` : ""}    <main>\n${fn ? "        <button onclick=go()>go</button>\n" : ""}${main}    </main>\n</program>\n`;
const find = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const v of Object.values(n)) find(v, pred, out);
  }
  return out;
};
const clean = (src, files) => {
  const r = run(src, files);
  expect(r.diags.map((d) => d.code + ": " + d.message)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return structuredClone(r.core);
};
// a payload / field tape TYPE's SeqGrants in Core, by field name
const tapeTypeGrants = (core, name) => find(core.types, (n) => n.sym && n.sym.hint === name && n.ty && n.ty.data && n.ty.data.grants)[0].ty.data.grants;

const ENUM = (t, extra = "") => `    type E:enum = { Dot, A(xs: ${t}) }\n    let <e:E=.Dot${extra}/>\n    function mk()! E {\n        fail .A([1, 2, 3]);\n    }\n`;
const TRANS = (t) => `    type E:enum = { Dot, A(xs: ${t}) }\n    <e:E=.Dot>\n        <Dot rule=.A/>\n        <A rule=.Dot/>\n    </>\n    function mk()! E {\n        fail .A([1]);\n    }\n`;
const ENUM_IN_STRUCT =(t) => `    type Box:struct = { xs: ${t} }\n    type E:enum = { Dot, A(b: Box) }\n    let <e:E=.Dot/>\n`;

describe("F1 — an enum variant payload is a tape position (§66.12.6 rule 1)", () => {
  const UNGRANTED = "int[free, append]";
  const GRANTED = "int[free, append, replace]";
  // [form, decls(t), body]
  const FORMS = [
    ["a `fail` payload written whole (`!{ _ x :> @e = x }`)", (t) => ENUM(t), "mk() !{ _ x :> @e = x };"],
    ["a variant switch to a payload-free variant (`@e = .Dot`)", (t) => ENUM(t), "@e = .Dot;"],
    ["`reset(@e)`", (t) => ENUM(t), "reset(@e);"],
    ["a `rule=` transition (the enum is written whole along its graph)", (t) => TRANS(t), "@e = .Dot;"],
    ["a `rule=` transition to the payload variant", (t) => TRANS(t), "mk() !{ _ x :> @e = x };"],
    ["a payload STRUCT's tape (`@e = .Dot`)", (t) => ENUM_IN_STRUCT(t), "@e = .Dot;"],
    ["a struct field holding the enum, written whole", (t) => `    type E:enum = { Dot, A(xs: ${t}) }\n    type W:struct = { title: string, let e: E }\n    let <w:W=({ title: "t", e: .Dot })/>\n`, "@w.e = .Dot;"],
    ["a genuine replace of a struct whose enum field is not kept", (t) => `    type E:enum = { Dot, A(xs: ${t}) }\n    type W:struct = { title: string, e: E }\n    let <w:W=({ title: "t", e: .Dot })/>\n`, "@w = { title: \"u\", e: .Dot };"],
  ];
  for (const [form, decls, body] of FORMS) {
    test(`${form} — ungranted: refused E-BOOTSTRAP-UNSUPPORTED`, () => {
      const cs = codes(P(decls(UNGRANTED), body));
      expect(cs).toContain("E-BOOTSTRAP-UNSUPPORTED");
      expect(cs.every((c) => c === "E-BOOTSTRAP-UNSUPPORTED")).toBe(true);
    });
    test(`${form} — \`replace\` granted: clean (analyzer and Core)`, () => {
      clean(P(decls(GRANTED), body));
    });
  }
  test("the refusal names the payload tape and the owner question", () => {
    const m = run(P(ENUM(UNGRANTED), "mk() !{ _ x :> @e = x };")).diags[0].message;
    expect(m).toContain("`@e.A(xs)`");
    expect(m).toContain("owner question");
  });
  test("a kept enum field is not written (`@w = { title: t, e: @w.e }`)", () => {
    clean(P(`    type E:enum = { Dot, A(xs: ${UNGRANTED}) }\n    type W:struct = { title: string, e: E }\n    let <w:W=({ title: "t", e: .Dot })/>\n`, "@w = { title: \"u\", e: @w.e };"));
  });
  test("`persist=\"local\"`: refused (a cross-tab value is a whole enum write); `session` is not (Q5)", () => {
    expect(codes(P(ENUM(UNGRANTED, ` persist="local" key="r3.e"`), ""))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(ENUM_IN_STRUCT(UNGRANTED).replace("let <e:E=.Dot/>", "let <e:E=.Dot persist=\"local\" key=\"r3.s\"/>"), ""))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(ENUM(UNGRANTED, ` persist="session" key="r3.f"`), ""))).toEqual([]);
  });
  test("`reset-on=`: refused", () => {
    const src = P(`    let <n:int=0/>\n` + ENUM(UNGRANTED, " reset-on=[@n]"), "");
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("a local enum's rebinding: refused", () => {
    const src = (t) => P(`    type E:enum = { Dot, A(xs: ${t}) }\n`, "let e: E = .Dot;\n        e = .Dot;");
    expect(codes(src(UNGRANTED))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(src(GRANTED))).toEqual([]);
  });

  // Core (check.scrml) refuses the same on a Core that slipped past the analyzer.
  test("Core C3: a cell Replace of an enum whose payload tape grants no `replace`", () => {
    const core = clean(P(ENUM(GRANTED), "mk() !{ _ x :> @e = x };"));
    tapeTypeGrants(core, "xs").replace = false;
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C3:") && m.includes("`e.A(xs)`") && m.includes("variant payload"))).toBe(true);
  });
  test("Core C3: a Transition write of an enum whose payload tape grants no `replace`", () => {
    const core = clean(P(TRANS("int[free, append, replace]"), "@e = .Dot;"));
    expect(find(core.fns, (n) => n.variant === "Write" && (n.data.edit === "Transition" || n.data.edit?.variant === "Transition")).length).toBe(1);
    tapeTypeGrants(core, "xs").replace = false;
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C3:") && m.includes("`e.A(xs)`"))).toBe(true);
  });
  test("Core C3: a payload struct's tape", () => {
    const core = clean(P(ENUM_IN_STRUCT(GRANTED), "@e = .Dot;"));
    tapeTypeGrants(core, "xs").replace = false;
    const box = find(core.types, (n) => n.sym && n.sym.hint === "xs" && n.grants)[0];
    box.grants.replace = false;
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C3:") && m.includes("e.A(b).xs"))).toBe(true);
  });
  test("Core C17: `persist` in localStorage of an enum whose payload tape grants no `replace`", () => {
    const core = clean(P(ENUM(GRANTED, ` persist="local" key="r3.c17"`), ""));
    tapeTypeGrants(core, "xs").replace = false;
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C17:") && m.includes("variant payload"))).toBe(true);
  });
});

const NEST = `    type In:struct = { ys: int[free, append] }\n    type O:struct = { title: string, let inner: In }\n    let <o:O=({ title: "t", inner: { ys: [1] } })/>\n`;
const BOX = `    type Box:struct = { title: string, xs: int[free, append] }\n    let <b:Box=({ title: "t", xs: [1] })/>\n`;
const DOC = `type In:struct = { ys: int[free, append] }\n<doc title:string>\n    export let <inner:In=({ ys: [1] })/>\n</>\nrenders <p class="doc">\${title}</p>\n`;
const inst = (fn) => `${DOC}<program>\n    function go() { ${fn} }\n    <main>\n        <doc as=d title="x"/>\n        <button onclick=go()>go</button>\n    </main>\n</program>\n`;

describe("F3 — a spread override that keeps a nested tape: the analyzer and Core agree", () => {
  test("`@o = { ...@o, inner: { ys: @o.inner.ys } }` — clean in both (no raw C3)", () => {
    clean(P(NEST, "@o = { ...@o, inner: { ys: @o.inner.ys } };"));
  });
  test("with a call in another override (the Commit form: values bound to Locals first)", () => {
    clean(P(NEST, "@o = { ...@o, title: nm(), inner: { ys: @o.inner.ys } };\n    }\n    function nm() -> string {\n        return \"x\";"));
  });
  test("the declaration-instance form `@d = { ...@d, inner: { ys: @d.inner.ys } }` — clean in both", () => {
    clean(inst("@d = { ...@d, inner: { ys: @d.inner.ys } };"));
  });
  test("a tape REPLACED in the same shape is still refused (the analyzer first, with its own code)", () => {
    expect(codes(P(NEST, "@o = { ...@o, inner: { ys: [] } };"))).toEqual(["E-WRITE-NOT-GRANTED"]);
    expect(codes(inst("@d = { ...@d, inner: { ys: [] } };"))).toEqual(["E-WRITE-NOT-GRANTED"]);
  });
  // soundness controls for the snapshot reading (planted Core)
  const snapCore = () => {
    const core = clean(P(NEST, "@o = { ...@o, inner: { ys: @o.inner.ys } };"));
    const lets = find(core.fns, (n) => n.variant === "Let" && n.data.sym.hint === "before");
    expect(lets.length).toBe(1);
    return { core, before: lets[0] };
  };
  test("Core control: a snapshot Local that is ALSO Assigned is not a snapshot (C3)", () => {
    const { core, before } = snapCore();
    const go = core.fns.find((f) => f.sym.hint === "go");
    go.body.stmts.splice(1, 0, { variant: "Assign", data: { local: before.data.sym, value: { variant: "Lit", data: { lit: { variant: "Absent" } } } } });
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C3:") && m.includes("o.inner.ys"))).toBe(true);
  });
  test("Core control: a snapshot of ANOTHER place is not a keep (C3)", () => {
    const { core, before } = snapCore();
    before.data.init.data.place.data.path = [];          // `before` now snapshots nothing of `o`
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C3:") && m.includes("o.inner.ys"))).toBe(true);
  });
});

describe("F4 — an identity override is a keep, not a `replace`", () => {
  test("`@b = { ...@b, xs: @b.xs }` — clean in both", () => {
    clean(P(BOX, "@b = { ...@b, xs: @b.xs };"));
    clean(P(BOX, "@b = { ...@b, title: \"u\", xs: @b.xs };"));
  });
  test("`@o = { ...@o, inner: @o.inner }` — clean in both", () => {
    clean(P(NEST, "@o = { ...@o, inner: @o.inner };"));
  });
  test("the instance form `@d = { ...@d, inner: @d.inner }` — clean in both", () => {
    clean(inst("@d = { ...@d, inner: @d.inner };"));
  });
  test("Core: a Replace whose value reads the written place itself keeps every tape in it", () => {
    const core = clean(P(BOX, "@b = { title: \"u\", xs: @b.xs };"));
    const w = find(core.fns, (n) => n.variant === "Write")[0];
    w.data.value = w.data.value.data.fields[1];          // Read(@b.xs) …
    w.data.value = { variant: "Read", data: { place: { ...w.data.value.data.place, data: { ...w.data.value.data.place.data, path: w.data.value.data.place.data.path.slice(0, 1) } } } };   // … now Read(@b)
    expect(mods.check.checkCore(core)).toEqual([]);
  });
  test("a NON-identity override of an append-only tape is still refused", () => {
    expect(codes(P(BOX, "@b = { ...@b, xs: [] };"))).toEqual(["E-WRITE-NOT-GRANTED"]);
  });
});
