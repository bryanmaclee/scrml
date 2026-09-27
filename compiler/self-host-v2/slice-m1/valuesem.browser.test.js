// valuesem.browser.test.js — SPEC §66.10 value semantics: an alias snapshot does
// not change when its source is later written. Program-level (the §66.10 item-1
// example, valuesem.core.scrml) and instance-level (`@x` of a declaration).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadSuite } from "./cores.js";
import { loadProgram, expectNoPageErrors, click, instancesOf } from "./load-program.js";

let mods, cores;
afterEach(() => expectNoPageErrors());
beforeAll(() => { ({ mods, cores } = loadSuite()); }, { timeout: 120000 });

describe("§66.10 — `let before = @audit` then `@audit.push(\"x\")`", () => {
  let rt;
  beforeAll(async () => { ({ rt } = await loadProgram(cores.valuesem(), "valuesem")); });

  const p = () => document.querySelector("main > p").textContent;

  test("the snapshot taken before the append does not grow", () => {
    expect(p()).toBe("0 / 0");
    click(document.querySelector("main > button"));
    expect(p()).toBe("0 / 1");      // seen = before.length = 0, though audit now has 1
    click(document.querySelector("main > button"));
    expect(p()).toBe("1 / 2");
  });

  test("an append makes a NEW array; the old value is untouched", () => {
    const program = instancesOf(rt, "program")[0];
    const old = program.fields[0].peek();
    click(document.querySelector("main > button"));
    const now = program.fields[0].peek();
    expect(now).not.toBe(old);
    expect(old).toEqual(["x", "x"]);
    expect(now).toEqual(["x", "x", "x"]);
    // No runtime freeze (S437 PA decision): immutability is a Core fact — every
    // write is a classified Write that builds a new value.
    expect(Object.isFrozen(old)).toBe(false);
  });

  test("the Core classifies the push as an Append edit, granted by the type's [end] axis", () => {
    const core = cores.valuesem();
    expect(mods.check.checkCore(core)).toEqual([]);
    const audit = core.decls[0].fields[0];
    expect(audit.grants.replace).toBe(false);          // append-only: no replace (§66.11.3)
    expect(audit.grants.edits.map((e) => e)).toEqual(["Append"]);
  });
});

describe("§66.10 at the instance level — `@country` is a struct snapshot", () => {
  let rt;
  beforeAll(async () => { ({ rt } = await loadProgram(cores.dropdown(), "dropdown")); });

  test("a snapshot of an instance does not change when a field is later written", () => {
    const country = instancesOf(rt, "program")[0].handles[0].peek();
    const snap = rt.snapshot(country);
    expect(snap).toEqual({ label: "Country", options: ["US", "CA", "MX"], value: "US", open: "Closed" });
    country.fields[2].set("CA");
    expect(snap.value).toBe("US");
    expect(rt.snapshot(country).value).toBe("CA");
    expect(rt.snapshot(country)).not.toBe(snap);     // each `@x` read is a new value
  });
});
