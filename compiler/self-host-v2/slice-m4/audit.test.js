// audit.test.js — SPEC §66.19.5 "An append-only audit log".
//
// s444: RUNS FROM SOURCE. The verbatim program compiles clean — `Date.now()`
// is a Core host call (Expr.Host, the closed host-call surface) and
// `<input bind:value=@actor/>` a Core bind (Attr.Bind, the event-value round
// trip) — and it is loaded and driven as written: typing into the bound input,
// clicking "Log in", calling recordBySpread. The clock is stubbed per test so
// the timestamps are exact. Its negative lines are uncommented one at a time
// into the verbatim source; the `let snapshot = @audit` line (§66.10) becomes
// a probe function (the one derived edit — it is a comment in the SPEC).

import { describe, test, expect, beforeAll, afterEach, afterAll } from "bun:test";
import { loadM2, frontEnd, compileClean, replaceLine, negativeLines, readM4 } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";
import { auditShapesFixture } from "./fixtures.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const SRC = () => readM4("src/audit/audit.scrml");
const run = (src) => frontEnd(mods, [{ path: "audit.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const rows = () => [...document.querySelectorAll("main > ul > li")].map((li) => li.textContent);
const button = (text) => [...document.querySelectorAll("main > button")].find((b) => b.textContent === text);
const input = () => document.querySelector("main > input");
const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };

// A stubbed clock: `Date.now()` in the program is the host's, so the test owns it.
const realNow = Date.now;
let clock = 0;
afterAll(() => { Date.now = realNow; });

// The log's current value (the program cell `audit`), read from the runtime registry.
const auditValue = (rt) => {
  const prog = [...rt.devtools.instances.values()].find((i) => i.decl.fields.includes("audit"));
  return prog.fields[prog.decl.fields.indexOf("audit")].peek();
};

describe("§66.19.5 — the front end (the VERBATIM program)", () => {
  test("compiles clean, and its Core is well-formed", () => {
    const r = run(SRC());
    expect(r.diags).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
  });

  test("`audit` grants end-appends and no replace; `actor` is a let cell", () => {
    const core = compileClean(mods, [{ path: "audit.scrml", src: SRC() }], "§66.19.5").core;
    const prog = core.decls.find((d) => d.sym.id === core.program.id);
    const audit = prog.fields.find((f) => f.sym.hint === "audit");
    expect(audit.grants.replace).toBe(false);
    expect(audit.grants.edits).toEqual(["Append"]);
  });

  test("`push` and the spread `[...@audit, e]` are the SAME edit: an end-append Write whose `at` is the host clock", () => {
    const core = compileClean(mods, [{ path: "audit.scrml", src: SRC() }], "§66.19.5").core;
    const fn = (name) => core.fns.find((f) => f.sym.hint === name);
    for (const name of ["record", "recordBySpread"]) {
      const stmts = fn(name).body.stmts;
      expect(stmts.length).toBe(1);
      expect(stmts[0].variant).toBe("Write");
      expect(stmts[0].data.edit).toBe("Append");
      const entry = stmts[0].data.value;
      expect(entry.variant).toBe("StructOf");
      expect(entry.data.fields[0]).toEqual({ variant: "Host", data: { call: "DateNow" } });
    }
  });

  test("the bound input is ONE Attr.Bind: it reads `@actor` and writes it back through `actor`'s capability", () => {
    const core = compileClean(mods, [{ path: "audit.scrml", src: SRC() }], "§66.19.5").core;
    const prog = core.decls.find((d) => d.sym.id === core.program.id);
    const main = prog.renders.find((v) => v.variant === "El" && v.data.tag === "main");
    const inputEl = main.data.kids.find((v) => v.variant === "El" && v.data.tag === "input");
    expect(inputEl.data.attrs.map((a) => a.variant)).toEqual(["Bind"]);
    const b = inputEl.data.attrs[0].data;
    expect(b.kind).toBe("Value");
    expect(b.write.stmts.length).toBe(1);
    expect(b.write.stmts[0].data.edit).toBe("Replace");
    expect(b.write.stmts[0].data.value).toEqual({ variant: "Local", data: { sym: b.sink } });
  });
});

describe("§66.19.5 — behaviour (the VERBATIM program, run)", () => {
  let program, rt;
  beforeAll(async () => {
    Date.now = () => clock;
    const core = compileClean(mods, [{ path: "audit.scrml", src: SRC() }], "§66.19.5").core;
    ({ program, rt } = await loadProgram(core, "audit-src", ["record", "recordBySpread"]));
  });

  test("the log starts empty; the bound input shows `@actor`'s initial value", () => {
    expect(rows()).toEqual([]);
    expect(input().value).toBe("ops");
  });

  test("Log in appends one entry, as the current actor, stamped by the clock", () => {
    clock = 1000;
    click(button("Log in"));
    expect(rows()).toEqual(["ops: login"]);
    expect(auditValue(rt)).toEqual([{ at: 1000, actor: "ops", action: "login" }]);
  });

  test("typing into the bound input writes `@actor` (the event-value round trip); the next entry carries it", () => {
    type(input(), "alice");
    clock = 2000;
    click(button("Log in"));
    expect(rows()).toEqual(["ops: login", "alice: login"]);
    expect(auditValue(rt)[1]).toEqual({ at: 2000, actor: "alice", action: "login" });
  });

  test("recordBySpread appends at the END, the same edit as push", () => {
    clock = 3000;
    program.recordBySpread("x");
    expect(rows()).toEqual(["ops: login", "alice: login", "alice: x"]);
    expect(auditValue(rt)[2].at).toBe(3000);
  });

  test("record() and recordBySpread() interleave in call order", () => {
    program.record("a");
    program.recordBySpread("b");
    expect(rows().slice(3)).toEqual(["alice: a", "alice: b"]);
  });

  test("the input keeps what the user typed (a write of the value it shows changes nothing)", () => {
    expect(input().value).toBe("alice");
  });
});

describe("§66.19.5 — a snapshot is a value (§66.10), on the verbatim source + the probe line", () => {
  let program;
  beforeAll(async () => {
    Date.now = () => 7;
    const src = replaceLine(SRC(), "let snapshot = @audit", "function probe() -> int {\n        let snapshot = @audit\n        record(\"probe\")\n        return snapshot.length\n    }");
    const core = compileClean(mods, [{ path: "audit.scrml", src }], "§66.19.5 + probe").core;
    ({ program } = await loadProgram(core, "audit-probe", ["record", "probe"]));
  });
  test("a later record() does not change the snapshot", () => {
    program.record("a");
    expect(program.probe()).toBe(1);
    expect(rows()).toEqual(["ops: a", "ops: probe"]);
  });
});

// The recognized shapes past what §66.19.5 itself writes: several elements,
// and the front-prepend shape on a type that grants `prepend`.
describe("§66.19.5 — behaviour: the recognized shapes keep element order", () => {
  let program;
  beforeAll(async () => {
    const core = compileClean(mods, [{ path: "audit.scrml", src: auditShapesFixture() }], "§66.19.5 shapes").core;
    ({ program } = await loadProgram(core, "audit-shapes", ["record", "recordTwo", "recordFirst"]));
  });

  test("`[...@x, a, b]` appends a then b; `[a, b, ...@x]` prepends so the log reads a, b first", () => {
    program.record("mid");
    program.recordTwo("e1", "e2");
    expect(rows()).toEqual(["ops: mid", "ops: e1", "ops: e2"]);
    program.recordFirst("f1", "f2");
    expect(rows()).toEqual(["ops: f1", "ops: f2", "ops: mid", "ops: e1", "ops: e2"]);
  });
});

// ---------------------------------------------------------------------------
// The negative lines: each `→ E-…` comment, uncommented as a function body of
// the VERBATIM program.
// ---------------------------------------------------------------------------
const NEGATIVE = [
  { marker: "@audit = []  ", body: "@audit = []" },
  { marker: "reset(@audit)", body: "reset(@audit)" },
  { marker: "@audit.shift()", body: "@audit.shift()" },
  { marker: "@audit = @audit.filter(", body: "@audit = @audit.filter(e => e.actor != \"x\")" },
  { marker: "@audit[0].action = \"edited\"", body: "@audit[0].action = \"edited\"" },
  { marker: "@audit.pop()", body: "@audit.pop()" }, // S442: `[free, append]` grants no shrink
];

describe("§66.19.5 — negative lines (each → E-WRITE-NOT-GRANTED)", () => {
  test("the table covers every `→ E-…` line, and each names E-WRITE-NOT-GRANTED", () => {
    const lines = negativeLines(SRC());
    expect(lines.length).toBe(NEGATIVE.length);
    for (const n of NEGATIVE) {
      const hit = lines.filter((l) => l.includes(n.marker));
      expect(hit.length).toBe(1);
      expect(hit[0]).toContain("E-WRITE-NOT-GRANTED");
    }
  });

  NEGATIVE.forEach((n, i) => {
    test(`${n.body} → E-WRITE-NOT-GRANTED`, () => {
      const src = replaceLine(SRC(), n.marker, `function neg${i}() { ${n.body} }`);
      expect(codes(src)).toEqual(["E-WRITE-NOT-GRANTED"]);
    });
  });

  test("the messages name the classified edit (the one axis, §66.11.2)", () => {
    const msg = (i) => run(replaceLine(SRC(), NEGATIVE[i].marker, `function neg() { ${NEGATIVE[i].body} }`)).diags[0].message;
    expect(msg(0)).toContain("whole-value replace");
    expect(msg(2)).toContain("removal at the front");
    expect(msg(3)).toContain("shrink-anywhere");
    expect(msg(4)).toContain("fixed");
    expect(msg(5)).toContain("removal at the end");
  });

  test("a wrong-typed element in the spread shape is E-TYPE-031 (§66.1 rule 5 — the element is the written value)", () => {
    const src = replaceLine(SRC(), NEGATIVE[0].marker, "function neg() { @audit = [...@audit, 5] }");
    expect(codes(src)).toEqual(["E-TYPE-031"]);
    const src2 = replaceLine(SRC(), NEGATIVE[0].marker, "function neg() { @audit = [...@audit, { at: 1, actor: 2, action: \"a\" }] }");
    expect(codes(src2)).toEqual(["E-TYPE-031"]);
  });

  test("the same shapes are GRANTED — and lowered (s444) — on a type that grants them (the classifier, not a blanket refusal)", () => {
    const granted = SRC().replace("<audit:Entry[free, append]=[]/>", "<audit:Entry[free, append, prepend, shift, remove, writable]=[]/>");
    for (const i of [2, 3, 5]) {
      const r = run(replaceLine(granted, NEGATIVE[i].marker, `function neg() { ${NEGATIVE[i].body} }`));
      expect(r.diags).toEqual([]);
      expect(mods.check.checkCore(r.core)).toEqual([]);
    }
    const src3 = replaceLine(granted, NEGATIVE[0].marker, `function neg() { @audit = [{ at: 0, actor: "z", action: "first" }, ...@audit] }`);
    expect(codes(src3)).toEqual([]);
  });

  test("the element-field write is granted when the ELEMENT field grants it (dpa-052 Q3) — and lowered", () => {
    const src = SRC().replace("type Entry:struct = { at: number, actor: string, action: string }", "type Entry:struct = { at: number, actor: string, let action: string }");
    const r = run(replaceLine(src, NEGATIVE[4].marker, `function neg() { ${NEGATIVE[4].body} }`));
    expect(r.diags).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
  });
});
