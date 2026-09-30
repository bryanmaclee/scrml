// form.test.js — SPEC §66.19.2 "A validated form (with a `single` save-status
// declaration)".
//
// s444: the VERBATIM program compiles clean and RUNS. Phase A — the three binds
// are Core binds (Attr.Bind), `@email` inside `email`'s own renders is this
// instance (O54 = (a), RULED S442), `<*signup/>` is a Core View.Star (the
// existing shared instance). Phase B (dpa-058, RULED S442) — the validators
// `req` / `length(…)` land on the bound inputs as `required` / `minlength`,
// and the form carries `novalidate` (validators.test.js pins the attributes).
// The fixture only appends probe markup to `<main>`.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd, compileClean, replaceLine, negativeLines, readM4 } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";
import { formFixture } from "./fixtures.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const SRC = () => readM4("src/form/signup.scrml");

const fixture = formFixture;

const run = (src) => frontEnd(mods, [{ path: "signup.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);

describe("§66.19.2 — the front end", () => {
  test("the VERBATIM program compiles clean (s444: binds, O54, Star, and the dpa-058 validators)", () => {
    const r = run(SRC());
    expect(r.diags).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
  });

  test("the fixture compiles clean and its Core is well-formed", () => {
    const r = compileClean(mods, [{ path: "signup.scrml", src: fixture() }], "§66.19.2 fixture");
    expect(mods.check.checkCore(r.core)).toEqual([]);
  });

  test("`signup` is a user declaration: attribute `agree` (let), child fields `email` / `password` (let)", () => {
    const core = compileClean(mods, [{ path: "signup.scrml", src: fixture() }], "§66.19.2 fixture").core;
    const signup = core.decls.find((d) => d.sym.hint === "signup");
    expect(signup.fields.map((f) => [f.sym.hint, f.role, f.mode])).toEqual([
      ["agree", "Attribute", "Let"], ["email", "Child", "Let"], ["password", "Child", "Let"],
    ]);
  });

  test("the binds are Core binds: `@email` / `@password` in their own renders are THIS instance's fields (O54 = (a)); `@signup.agree` too", () => {
    const core = compileClean(mods, [{ path: "signup.scrml", src: fixture() }], "§66.19.2 fixture").core;
    const binds = [];
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n === null || typeof n !== "object") return;
      if (n.variant === "Bind") binds.push(n.data);
      Object.values(n).forEach(walk);
    })(core.decls.find((d) => d.sym.hint === "signup").renders);
    // the form's own checkbox (the email / password binds are in their fields' renders, inlined at `<*email/>` / `<*password/>`)
    expect(binds.map((b) => [b.kind, b.read.data.place.data.path.map((r) => r.idx), b.read.data.place.data.inst])).toEqual([
      ["Value", [1], { variant: "Lexical", data: { depth: 0 } }],
      ["Value", [2], { variant: "Lexical", data: { depth: 0 } }],
      ["Checked", [0], { variant: "Lexical", data: { depth: 0 } }],
    ]);
  });

  test("`<*signup/>` is a View.Star of the shared instance (no inlining, nothing constructed)", () => {
    const core = compileClean(mods, [{ path: "signup.scrml", src: fixture() }], "§66.19.2 fixture").core;
    const prog = core.decls.find((d) => d.sym.id === core.program.id);
    const main = prog.renders.find((v) => v.variant === "El" && v.data.tag === "main");
    const star = main.data.kids.find((v) => v.variant === "Star");
    expect(star.data.decl.hint).toBe("signup");
    expect(star.data.inst.variant).toBe("Shared");
  });
});

describe("§66.19.2 — behaviour (the verbatim program + a probe line, run)", () => {
  beforeAll(async () => {
    const core = compileClean(mods, [{ path: "signup.scrml", src: fixture(`\n        <p class="probe">\${@signup.email}|\${@signup.password}</p>`) }], "§66.19.2 fixture").core;
    await loadProgram(core, "form");
  });

  const form = () => document.querySelector("main > form");
  const hint = () => document.querySelector("main > form > p").textContent;
  const status = () => document.querySelector("main > p:not(.probe)").textContent;
  const probe = () => document.querySelector("main > p.probe").textContent;
  const button = (text) => [...document.querySelectorAll("main button")].find((b) => b.textContent === text);
  const inputs = () => [...form().querySelectorAll("input")];
  const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };
  const check = (el) => { el.checked = !el.checked; el.dispatchEvent(new window.Event("change", { bubbles: true })); };

  test("`<*signup/>` renders the shared instance's form; `<*email/>` / `<*password/>` render its child fields' own markup", () => {
    expect(form()).not.toBeNull();
    const inputs = [...form().querySelectorAll("input")].map((i) => i.getAttribute("type"));
    expect(inputs).toEqual(["email", "password", "checkbox"]);
    expect([...form().querySelectorAll("label")].map((l) => l.textContent.trim())).toEqual(["Email", "Password", "I agree"]);
    expect(hint()).toBe("Please agree to continue.");
  });

  test("`<*saveState/>` shows .Idle's body (the empty string)", () => {
    expect(status()).toBe("");
  });

  test("Save with `agree` false returns early — the status stays .Idle", () => {
    click(button("Save"));
    expect(status()).toBe("");
  });

  test("typing into the email / password inputs writes THIS signup's child fields (the bind round trip)", () => {
    type(inputs()[0], "a@b.co");
    type(inputs()[1], "hunter22");
    expect(probe()).toBe("a@b.co|hunter22");
  });

  test("checking the box writes `@signup.agree` (bind:checked); the bare `agree` projection in its renders follows", () => {
    check(inputs()[2]);
    expect(inputs()[2].checked).toBe(true);
    expect(hint()).toBe("");
  });

  test("Save with `agree` true moves .Idle → .Saving → .Saved along the graph", () => {
    click(button("Save"));
    expect(status()).toBe("Saved");
  });

  test("Save again: .Saved → .Saving → .Saved is along the graph too; unchecking restores the hint", () => {
    click(button("Save"));
    expect(status()).toBe("Saved");
    check(inputs()[2]);
    expect(hint()).toBe("Please agree to continue.");
  });
});

describe("§66.19.2 — behaviour: `<*signup/>` twice is ONE instance shown twice (§66.6.2)", () => {
  beforeAll(async () => {
    const core = compileClean(mods, [{ path: "signup.scrml", src: fixture("\n        <*signup/>") }], "§66.19.2 fixture ×2").core;
    await loadProgram(core, "form2");
  });

  test("both forms read the same `agree`; a bind in one updates the other's input", () => {
    const hints = () => [...document.querySelectorAll("main > form > p")].map((p) => p.textContent);
    const boxes = () => [...document.querySelectorAll("main > form input[type=checkbox]")];
    const emails = () => [...document.querySelectorAll("main > form input[type=email]")];
    expect(hints()).toEqual(["Please agree to continue.", "Please agree to continue."]);
    const b0 = boxes()[0];
    b0.checked = true;
    b0.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(hints()).toEqual(["", ""]);
    expect(boxes()[1].checked).toBe(true);
    emails()[1].value = "x@y.z";
    emails()[1].dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(emails()[0].value).toBe("x@y.z");
  });
});

describe("§66.19.2 — negative lines", () => {
  test("the table covers every `→ E-…` line of the source", () => {
    const lines = negativeLines(SRC());
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("E-DECL-FIELD-TAG-NEEDS-STAR");
  });

  test("a bare `<password/>` inside signup's renders → E-DECL-FIELD-TAG-NEEDS-STAR (§66.6.6)", () => {
    const src = fixture().replace("<label>Password <*password/></label>", "<label>Password <password/></label>");
    expect(src).not.toBe(fixture());
    expect(codes(src)).toEqual(["E-DECL-FIELD-TAG-NEEDS-STAR"]);
  });
});
