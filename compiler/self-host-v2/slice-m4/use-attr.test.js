// use-attr.test.js — s462-decl-use-attr-refuse: O18 RULED (dpa-069), SPEC §66.6.9.
//
// Ruling (user-voice-scrml.md S462): "I really like X so I accept your rec as a ratified
// path to X" — an undeclared attribute on a plain use, or on a `<*x>` reference, of a §66
// declaration is E-DECL-USE-ATTR (fail-closed Error).
//
// §66.6.9 rule 1: a plain use carries the declaration's declared attributes and child
// fields (construction), `as=`, and `if=` / `else-if=` / `else` — nothing else.
// Rule 2: any other attribute on a plain use is E-DECL-USE-ATTR — `class`, `style`, `id`,
// `aria-*`, `data-*`, `on…`, `bind:…`, `show=`, URL attributes, `srcdoc`, `key=`, a typo.
// Rule 3: on a `<*x>` reference, an attribute naming a field is E-DECL-STAR-REF-ATTR-WRITE;
// `if=` / `else-if=` / `else` are the open residue O18-r (refused by the bootstrap as
// unsupported); anything else — `as=` included — is E-DECL-USE-ATTR.
// Rule 4: `key=` on a use is never a DOM attribute nor a reconciliation key.
//
// Before s462 the plain-use half already held (analyze.scrml `resolveUse`); the `<*x>`
// half did NOT: a non-field attribute on a reference was dropped silently (fail-open).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "u.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const CARD = `    <card title:string="t">
    </>
    renders <div class="card">\${title}</div>
`;
const prog = (markup, decl = CARD) =>
  `<program>\n    let <n:int=0/>\n    let <b:bool=true/>\n    let <s:string=""/>\n${decl}    <main>\n        ${markup}\n    </main>\n</program>\n`;

// Every kind of undeclared attribute the ruling names (dpa-069 §1, §3 pole R), plus the
// forms that are not plain names.
const UNDECLARED = [
  ["class", `class="wide"`],
  ["style", `style="padding:4px"`],
  ["id", `id="main"`],
  ["aria-label", `aria-label="Quarter summary"`],
  ["data-testid", `data-testid="q3-card"`],
  ["onclick", `onclick=(@n = @n + 1)`],
  ["onClick", `onClick=(@n = @n + 1)`],
  ["href", `href="/q3"`],
  ["src", `src=@s`],
  ["srcdoc", `srcdoc=@s`],
  ["key", `key="k"`],
  ["bind:value", `bind:value=@s`],
  ["class:on", `class:on=@b`],
  ["show", `show=@b`],
  ["titel", `titel="Q3"`],
  ["If", `If=@b`],
];

describe("§66.6.9 rule 2 — an undeclared attribute on a plain use is E-DECL-USE-ATTR", () => {
  for (const [name, attr] of UNDECLARED) {
    test(`<card ${attr}/> → exactly one E-DECL-USE-ATTR naming \`${name}\`, and no artifact`, () => {
      const r = run(prog(`<card title="Q3" ${attr}/>`));
      expect(r.diags.map((d) => d.code)).toEqual(["E-DECL-USE-ATTR"]);
      expect(r.diags[0].message).toContain(`\`${name}\``);
      expect(r.diags[0].message).toContain("§66.6.9");
      expect(r.diags[0].severity).toBe("Error");
      expect(r.core == null).toBe(true);
    });
  }
  test("several undeclared attributes → one E-DECL-USE-ATTR each", () => {
    expect(codes(prog(`<card class="w" id="m" style="x:1"/>`))).toEqual(["E-DECL-USE-ATTR", "E-DECL-USE-ATTR", "E-DECL-USE-ATTR"]);
  });
  test("rule 4: `key=` names the row key as the instance key, not a DOM attribute", () => {
    const d = run(prog(`<card key="k"/>`)).diags;
    expect(d[0].message).toContain("reconciliation key");
    expect(d[0].message).toContain("§66.7.3");
  });
  test("rule 4: `key=` on a use inside an `<each>` row is refused too (dpa-069 D-7)", () => {
    const src = prog(`<ul><each in=[1, 2] as k><li><card key=k/></li></each></ul>`);
    expect(codes(src)).toEqual(["E-DECL-USE-ATTR"]);
  });
  test("`show=` keeps the wrap hint", () => {
    expect(run(prog(`<card show=@b/>`)).diags[0].message).toContain(`<div show=`);
  });
  test("a use inside another declaration's renders is held to the same rule", () => {
    const decl = CARD + `    <shelf label:string="s">\n    </>\n    renders <section><card title=label class="x"/></section>\n`;
    expect(codes(prog(`<shelf/>`, decl))).toEqual(["E-DECL-USE-ATTR"]);
  });
});

// s462 merge re-check (the sink-guards branch's NIT): `attrCaseDiags` refuses a case-variant
// `ON…=(…)` (handler text from data, §5.2 rule 2) but returns early for a component USE. A use
// must not carry one past BOTH checks: E-DECL-USE-ATTR refuses it there, and no artifact is built.
describe("a case-variant `ON…=(…)` on a use or a reference cannot slip past both checks", () => {
  for (const [label, markup] of [
    ["plain use", `<card title="a" ONCLICK=(@s)/>`],
    ["plain use, mixed case", `<card title="a" OnClick=(@s)/>`],
    ["plain use, bare reference", `<card title="a" ONCLICK=@s/>`],
    ["`<*x>` reference", `<*card ONCLICK=(@s)/>`],
  ]) {
    test(`${label}: ${markup} → E-DECL-USE-ATTR, no Core`, () => {
      const r = run(prog(markup));
      expect(r.diags.map((d) => d.code)).toEqual(["E-DECL-USE-ATTR"]);
      expect(r.core == null).toBe(true);
    });
  }
  test("the same attribute on a plain element is the sink refusal (control)", () => {
    expect(codes(prog(`<button ONCLICK=(@s)>b</button>`))).toEqual(["E-ATTR-INTERP-EXECUTABLE"]);
  });
});

describe("§66.6.9 rule 1 — what a plain use may carry", () => {
  test("declared attributes, `as=` and `if=` / `else` → clean", () => {
    expect(codes(prog(`<card title="a" as=c if=@b/><card else title="z"/>`))).toEqual([]);
  });
  test("a declared field named like a structural word is construction (`show`, s451)", () => {
    const decl = `    <card show:boolean=false>\n        let <x:int=0/>\n    </>\n    renders <b class="card">card</b>\n`;
    expect(codes(prog(`<card show=true/>`, decl))).toEqual([]);
  });
});

describe("§66.6.9 rule 3 — a `<*x>` reference (was: a non-field attribute dropped silently)", () => {
  for (const [name, attr] of UNDECLARED.filter(([n]) => n !== "titel")) {
    test(`<*card ${attr}/> → E-DECL-USE-ATTR naming \`${name}\``, () => {
      const d = run(prog(`<*card ${attr}/>`)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-DECL-USE-ATTR"]);
      expect(d[0].message).toContain(`\`${name}\``);
    });
  }
  test("`as=` on a reference → E-DECL-USE-ATTR (a reference binds no handle)", () => {
    const d = run(prog(`<*card as=c/>`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-DECL-USE-ATTR"]);
    expect(d[0].message).toContain("binds no handle");
  });
  test("an attribute naming a field still writes → E-DECL-STAR-REF-ATTR-WRITE (§66.6.7)", () => {
    expect(codes(prog(`<*card title="a"/>`))).toEqual(["E-DECL-STAR-REF-ATTR-WRITE"]);
  });
  test("a field write and an undeclared attribute together → one of each", () => {
    expect(codes(prog(`<*card title="a" class="w"/>`))).toEqual(["E-DECL-STAR-REF-ATTR-WRITE", "E-DECL-USE-ATTR"]);
  });
  test("O18-r (open): `if=` on a reference stays refused as unsupported, not decided", () => {
    expect(codes(prog(`<*card if=@b/>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("a bare reference → clean", () => {
    expect(codes(prog(`<*card/>`))).toEqual([]);
  });
  test("`<*f/>` of a child field: its own attribute writes, anything else is undeclared", () => {
    const decl = `    <box title:string="b">\n        <inner tone:string="red"/>\n        renders <i>x</i>\n    </>\n    renders <div><*inner tone="blue"/><*inner class="x"/></div>\n`;
    const c = codes(prog(`<box/>`, decl));
    expect(c).toContain("E-DECL-STAR-REF-ATTR-WRITE");
    expect(c).toContain("E-DECL-USE-ATTR");
  });
});

describe("§66.6.9 rule 5 — the worked example (verbatim) compiles and renders", () => {
  const SRC = `<program>
    <card title:string wide:bool=false testid:string=""/>
    renders <div class=(wide ? "card wide" : "card") data-testid=testid>\${title}</div>
    <main>
        <card title="Q3" wide=true testid="q3-card"/>
    </main>
</program>
`;
  test("declared fields placed by the renders → the element carries them; nothing else", async () => {
    const r = run(SRC);
    expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    await loadProgram(r.core, "use-attr-worked");
    const el = document.querySelector("[data-testid]");
    expect(el.getAttribute("class")).toBe("card wide");
    expect(el.getAttribute("data-testid")).toBe("q3-card");
    expect(el.textContent).toBe("Q3");
    expect(el.hasAttribute("title")).toBe(false);
    expect(el.hasAttribute("wide")).toBe(false);
  });
  test("the same use with an undeclared `class` → E-DECL-USE-ATTR", () => {
    expect(codes(SRC.replace(`testid="q3-card"/>`, `testid="q3-card" class="wide"/>`))).toEqual(["E-DECL-USE-ATTR"]);
  });
});
