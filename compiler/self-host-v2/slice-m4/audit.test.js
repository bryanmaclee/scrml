// audit.test.js — SPEC §66.19.5 "An append-only audit log".
//
// PARTIAL: the verbatim program uses two constructs Core cannot express —
// `Date.now()` (a host call: Core's Expr has no host-call form) and
// `<input bind:value=@actor/>` (a two-way bind: Core's Attr has no event-value
// form). core.scrml is outside this slice's remit (brief §4), so the front end
// reports both (E-BOOTSTRAP-UNSUPPORTED) and nothing else — pinned below.
//
// Everything else runs, on a fixture DERIVED from the verbatim source by three
// textual edits (so a SPEC change reaches it): `Date.now()` → `0`, the bound
// input → a button that sets `@actor`, and the `let snapshot = @audit` comment
// line → a probe function. Its negative lines are uncommented one at a time.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd, compileClean, replaceLine, negativeLines, readM4 } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";
import { auditFixture, auditShapesFixture } from "./fixtures.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const SRC = () => readM4("src/audit/audit.scrml");

const fixture = auditFixture;

const run = (src) => frontEnd(mods, [{ path: "audit.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const rows = () => [...document.querySelectorAll("main > ul > li")].map((li) => li.textContent);
const button = (text) => [...document.querySelectorAll("main > button")].find((b) => b.textContent === text);

describe("§66.19.5 — the front end", () => {
  test("the VERBATIM program: exactly the two Core-blocked constructs are reported, nothing else", () => {
    const r = run(SRC());
    const got = r.diags.map((d) => [d.code, SRC().slice(d.span.start, d.span.start + 10)]);
    expect(got).toEqual([
      ["E-BOOTSTRAP-UNSUPPORTED", "bind:value"],
      ["E-BOOTSTRAP-UNSUPPORTED", "Date.now()"],
      ["E-BOOTSTRAP-UNSUPPORTED", "Date.now()"],
    ]);
  });

  test("the fixture compiles clean; `audit` grants end-appends and no replace", () => {
    const core = compileClean(mods, [{ path: "audit.scrml", src: fixture() }], "§66.19.5 fixture").core;
    expect(mods.check.checkCore(core)).toEqual([]);
    const prog = core.decls.find((d) => d.sym.id === core.program.id);
    const audit = prog.fields.find((f) => f.sym.hint === "audit");
    expect(audit.grants.replace).toBe(false);
    expect(audit.grants.edits).toEqual(["Append"]);
  });

  test("`push` and the spread `[...@audit, e]` are the SAME edit: an end-append Write (§66.11.2)", () => {
    const core = compileClean(mods, [{ path: "audit.scrml", src: fixture() }], "§66.19.5 fixture").core;
    const fn = (name) => core.fns.find((f) => f.sym.hint === name);
    for (const name of ["record", "recordBySpread"]) {
      const stmts = fn(name).body.stmts;
      expect(stmts.length).toBe(1);
      expect(stmts[0].variant).toBe("Write");
      expect(stmts[0].data.edit).toBe("Append");
    }
  });
});

describe("§66.19.5 — behaviour (the fixture, run)", () => {
  let program;
  beforeAll(async () => {
    const core = compileClean(mods, [{ path: "audit.scrml", src: fixture() }], "§66.19.5 fixture").core;
    ({ program } = await loadProgram(core, "audit", ["record", "recordBySpread", "probe"]));
  });

  test("the log starts empty", () => {
    expect(rows()).toEqual([]);
  });

  test("Log in appends one entry, as the current actor", () => {
    click(button("Log in"));
    expect(rows()).toEqual(["ops: login"]);
  });

  test("recordBySpread appends at the END, with the actor at that moment", () => {
    click(button("As alice"));
    program.recordBySpread("x");
    expect(rows()).toEqual(["ops: login", "alice: x"]);
  });

  test("a snapshot is a value (§66.10): a later record() does not change it", () => {
    expect(program.probe()).toBe(2);
    expect(rows()).toEqual(["ops: login", "alice: x", "alice: probe"]);
  });

  test("record() and recordBySpread() interleave in call order", () => {
    program.record("a");
    program.recordBySpread("b");
    expect(rows().slice(3)).toEqual(["alice: a", "alice: b"]);
  });
});

// The recognized shapes past what §66.19.5 itself writes: several elements,
// and the front-prepend shape on a type that grants `front`.
const shapesFixture = auditShapesFixture;

describe("§66.19.5 — behaviour: the recognized shapes keep element order", () => {
  let program;
  beforeAll(async () => {
    const core = compileClean(mods, [{ path: "audit.scrml", src: shapesFixture() }], "§66.19.5 shapes").core;
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
// The negative lines: each `→ E-…` comment, uncommented as a function body.
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
      const src = replaceLine(fixture(), n.marker, `function neg${i}() { ${n.body} }`);
      expect(codes(src)).toEqual(["E-WRITE-NOT-GRANTED"]);
    });
  });

  test("the messages name the classified edit (the one axis, §66.11.2)", () => {
    const msg = (i) => run(replaceLine(fixture(), NEGATIVE[i].marker, `function neg() { ${NEGATIVE[i].body} }`)).diags[0].message;
    expect(msg(0)).toContain("whole-value replace");
    expect(msg(2)).toContain("removal at the front");
    expect(msg(3)).toContain("shrink-anywhere");
    expect(msg(4)).toContain("fixed");
    expect(msg(5)).toContain("removal at the end");
  });

  test("a wrong-typed element in the spread shape is E-TYPE-031 (§66.1 rule 5 — the element is the written value)", () => {
    const src = replaceLine(fixture(), NEGATIVE[0].marker, "function neg() { @audit = [...@audit, 5] }");
    expect(codes(src)).toEqual(["E-TYPE-031"]);
    const src2 = replaceLine(fixture(), NEGATIVE[0].marker, "function neg() { @audit = [...@audit, { at: 1, actor: 2, action: \"a\" }] }");
    expect(codes(src2)).toEqual(["E-TYPE-031"]);
  });

  test("the same shapes are GRANTED on a type that grants them (the classifier, not a blanket refusal)", () => {
    const granted = fixture().replace("<audit:Entry[free, append]=[]/>", "<audit:Entry[free, append, prepend, shift, remove, writable]=[]/>");
    // granted, but Core cannot lower a removal / a lambda: reported as outside the bootstrap, never as a grant error
    const src = replaceLine(granted, NEGATIVE[2].marker, `function neg() { ${NEGATIVE[2].body} }`);
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    const src2 = replaceLine(granted, NEGATIVE[3].marker, `function neg() { ${NEGATIVE[3].body} }`);
    expect(codes(src2)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    // a front-prepend by spread is granted and lowers
    const src3 = replaceLine(granted, NEGATIVE[0].marker, `function neg() { @audit = [{ at: 0, actor: "z", action: "first" }, ...@audit] }`);
    expect(codes(src3)).toEqual([]);
  });
});
