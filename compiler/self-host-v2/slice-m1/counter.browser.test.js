// counter.browser.test.js — SPEC §66.19.1 run end to end:
//   hand-built Core → bootstrap printer (scrml, compiled by impl#1) → JS + HTML
//   → slice-M1 runtime in happy-dom.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadSuite } from "./cores.js";
import { loadProgram, expectNoPageErrors, click } from "./load-program.js";

let mods, cores;
afterEach(() => expectNoPageErrors());
beforeAll(() => { ({ mods, cores } = loadSuite()); }, { timeout: 120000 }); // one impl#1 compile of the bootstrap

const p = () => document.querySelector("main > p");
const buttons = () => [...document.querySelectorAll("main > button")];

describe("§66.19.1 counter — behaviour", () => {
  let rt;
  beforeAll(async () => { ({ rt } = await loadProgram(cores.counter(), "counter")); });

  test("renders the initial state", () => {
    expect(p().textContent).toBe("Count 0 (doubled 0)");
    expect(buttons().map((b) => b.textContent)).toEqual(["+1", "Reset"]);
  });

  test("+step increments count; doubled tracks it", () => {
    click(buttons()[0]);
    expect(p().textContent).toBe("Count 1 (doubled 2)");
    click(buttons()[0]);
    click(buttons()[0]);
    expect(p().textContent).toBe("Count 3 (doubled 6)");
  });

  test("reset restores count (and doubled follows)", () => {
    click(buttons()[1]);
    expect(p().textContent).toBe("Count 0 (doubled 0)");
  });

  test("the program is its own `single` declaration, instance id 0, with 3 field signals", () => {
    const prog = [...rt.devtools.instances.values()].find((i) => i.decl.name === "program");
    expect(prog.id).toBe(0);
    expect(prog.decl.fields).toEqual(["count", "step", "doubled"]);
    expect(prog.fields.length).toBe(3);
  });
});

describe("§66.19.1 counter — a missing grant is a Core-level fact", () => {
  test("only `count` has a write capability; `step` and `doubled` have none", () => {
    const core = cores.counter();
    const fields = core.decls[0].fields;
    expect(fields.map((f) => [f.sym.hint, f.wcap === null ? null : f.wcap.hint])).toEqual([
      ["count", "count"],
      ["step", null],
      ["doubled", null],
    ]);
    // The Core is well-formed: every capability matches a grant, every Write names one.
    expect(mods.check.checkCore(core)).toEqual([]);
  });

  test("a Write cannot name `doubled` or `step`: there is no capability symbol to name", () => {
    const core = cores.counter();
    const { Stmt, InstRef, EditKind, Check, litInt } = mods.core;
    const fields = core.decls[0].fields;
    // The only symbols a forger could reach for are the FIELD symbols. They are
    // read symbols, not write capabilities: the write does not resolve (C2).
    for (const f of [fields[1], fields[2]]) {
      const forged = Stmt.Write(f.sym, InstRef.Shared(core.program), EditKind.Replace, litInt(2), Check.Static);
      const bad = { ...core, fns: [{ ...core.fns[0], body: { stmts: [forged] } }] };
      const diags = mods.check.checkCore(bad);
      expect(diags.length).toBe(1);
      expect(diags[0]).toStartWith("C2: a write names sym");
      // …and the printer has no field to target: it emits a visibly dangling
      // reference instead of a `set` on the field.
      const js = mods.print.printProgram(bad, "bad.client.js", "scrml-runtime.js").js;
      expect(js).toContain(`danglingWriteCapability$${f.sym.id}`);
    }
  });

  test("giving `doubled` a capability without a grant is itself ill-formed (C1)", () => {
    const core = cores.counter();
    const fields = core.decls[0].fields.slice();
    fields[2] = { ...fields[2], wcap: mods.core.mkSym(99, "doubled") };
    const bad = { ...core, decls: [{ ...core.decls[0], fields }] };
    expect(mods.check.checkCore(bad)).toEqual(["C1: <program>.doubled has a write capability but grants no write"]);
  });

  test("the runtime shadow: a field without a capability is emitted as a read-only Derived", async () => {
    const { rt } = await loadProgram(cores.counter(), "counter");
    const prog = [...rt.devtools.instances.values()].find((i) => i.decl.name === "program");
    expect(prog.fields[0]).toBeInstanceOf(rt.Cell);
    expect(prog.fields[1]).toBeInstanceOf(rt.Derived);
    expect(prog.fields[2]).toBeInstanceOf(rt.Derived);
    expect(typeof prog.fields[1].set).toBe("undefined");
    expect(typeof prog.fields[2].set).toBe("undefined");
  });
});
