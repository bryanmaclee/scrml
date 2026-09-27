// lower.test.js — THE M2 PROOF (dpa-051 Fork A / R2): the bootstrap front end,
// run on §66.19.1 and §66.19.3 as written, produces EXACTLY the Core M1 built
// by hand — `lower(analyze(parse(lex(src))))` ≡ counterCore() / dropdownCore()
// modulo a Sym-id bijection (slice-m1/progress.md D11). Plus the same check for
// the M1 test fixtures written as source, and the comparator's own bite.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2 } from "./harness.js";
import { compareCore } from "./compare.js";
import { compileProgram } from "./lowered.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

describe("THE PROOF — the lowered Core equals M1's hand-built oracle", () => {
  test("§66.19.1 counter: lower(analyze(parse(lex(src)))) ≡ counterCore()", () => {
    const r = compileProgram(mods, "counter");
    expect(compareCore(r.core, mods["counter.core"].counterCore())).toBeNull();
    expect(mods.check.checkCore(r.core)).toEqual([]);
  });

  test("§66.19.3 dropdown (lib/dropdown.scrml + app.scrml): ≡ dropdownCore()", () => {
    const r = compileProgram(mods, "dropdown");
    expect(compareCore(r.core, mods["dropdown.core"].dropdownCore())).toBeNull();
    expect(mods.check.checkCore(r.core)).toEqual([]);
  });

  test("the M1 fixtures written as source lower to the hand-built fixture Cores", () => {
    expect(compareCore(compileProgram(mods, "dropdownReorder").core, mods["dropdown.core"].dropdownReorderCore())).toBeNull();
    expect(compareCore(compileProgram(mods, "dropdownEarlyRead").core, mods["dropdown.core"].dropdownEarlyReadCore())).toBeNull();
    expect(compareCore(compileProgram(mods, "valuesem").core, mods["valuesem.core"].valuesemCore())).toBeNull();
  });
});

describe("the comparator bites (it is an instrument, so it is tested too)", () => {
  test("a different program differs at the first differing path", () => {
    const d = compareCore(mods["counter.core"].counterCore(), mods["dropdown.core"].dropdownCore());
    expect(d).not.toBeNull();
    expect(d.path).toBe("decls");
  });

  test("one flipped check is found, with its path", () => {
    const core = mods["dropdown.core"].dropdownCore();
    const lowered = compileProgram(mods, "dropdown").core;
    const fn = lowered.fns[0];
    const w = fn.body.stmts[0];
    const flipped = { ...lowered, fns: [{ ...fn, body: { stmts: [{ ...w, data: { ...w.data, check: "Static" } }] } }, lowered.fns[1]] };
    const d = compareCore(flipped, core);
    expect(d.path).toBe("fns[0].body.stmts[0].data.check");
  });

  test("Sym ids must be a BIJECTION: reusing one Sym where the oracle has two is caught", () => {
    const core = mods["counter.core"].counterCore();
    const lowered = compileProgram(mods, "counter").core;
    // make `count`'s write capability the SAME Sym as its field (hints agree, identities do not)
    const f0 = lowered.decls[0].fields[0];
    const forged = { ...lowered, decls: [{ ...lowered.decls[0], fields: [{ ...f0, wcap: f0.sym }, ...lowered.decls[0].fields.slice(1)] }] };
    const d = compareCore(forged, core);
    expect(d).not.toBeNull();
    expect(d.why).toContain("bijection");
  });
});

describe("the lowered Core is CANONICAL (review INFO)", () => {
  test("a use's construction attributes are in field-index order, whatever the source order", async () => {
    const { frontEnd, readSlice } = await import("./lowered.js");
    const lib = { path: "lib/dropdown.scrml", src: readSlice("src/lib/dropdown.scrml") };
    const mk = (attrs) => ({ path: "app.scrml", src: `\${ import { dropdown } from "./lib/dropdown.scrml" }\n<program>\n    <main>\n        <dropdown ${attrs}/>\n    </main>\n</program>\n` });
    const a = frontEnd(mods, [lib, mk(`value="1" options=(["x"]) label="L"`)]);
    const b = frontEnd(mods, [lib, mk(`label="L" options=(["x"]) value="1"`)]);
    expect(a.diags).toEqual([]);
    const inst = (r) => r.core.decls.find((d) => d.sym.hint === "program").renders[0].data.kids[0];
    expect(inst(a).data.attrs.map((x) => x.field)).toEqual([0, 1, 2]);
    expect(compareCore(a.core, b.core)).toBeNull();
  });
});

describe("measurements are recorded (not asserted): Core size, phase times", () => {
  test("print them", () => {
    for (const name of ["counter", "dropdown"]) {
      const r = compileProgram(mods, name);
      const counts = mods.measure.countNodes(r.core);
      const total = counts.reduce((n, k) => n + k.count, 0);
      console.log(`[m2] ${name}: AST nodes ${r.nodes}, Core nodes ${total}, ms parse ${r.ms.parse.toFixed(1)} analyze ${r.ms.analyze.toFixed(1)} lower ${r.ms.lower.toFixed(1)}`);
      expect(total).toBeGreaterThan(0);
    }
  });
});
