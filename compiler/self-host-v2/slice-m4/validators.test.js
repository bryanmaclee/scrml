// validators.test.js — s444 Phase B: the dpa-058 build (RULED S442, user-voice
// "⭐⭐ RULED — dpa-058 (O25) = all PA recs"):
//   (1) "Always write the bind … with no implicit bind, ever."
//   (2) "Validators follow the bind" — the HTML-native subset (`required`,
//       `minlength`/`maxlength`, `min`/`max`, `pattern` only when exact) lands on
//       every native `input`/`textarea`/`select` whose `bind:` targets that
//       declaration's value, wherever the bind is written; no bind → validity
//       surface only.
//   (3) "the compiler adds `novalidate` to any form carrying lowered attributes."
//   (4) O54 = (a): `@email` inside `email`'s own `renders` is this instance.
//   (5) "Silently dead validators become errors" — validators on a top-level
//       scalar with no surface (§55.5 Edge A) or on a declaration nothing binds,
//       and `@x.isValid` on a no-surface cell → an error.
// The §55.5 validity surface itself is not in the bootstrap: a validator with no
// exact HTML form is refused (E-BOOTSTRAP-UNSUPPORTED), never kept inert.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd, readM4 } from "./harness.js";
import { loadProgram, click, expectNoPageErrors, instancesOf } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "v.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r.core;
};
const P = (decls, main) => `<program>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
// a declaration `f` with ONE validated child field `v` (validators `vals`, type `ty`, initial `init`) and a renders
const F = (vals, rendersV, rendersF, { ty = "string", init = '""' } = {}) =>
  `    <f note:string="n">\n        let <v:${ty}=${init} ${vals}/>\n        renders ${rendersV}\n    </>\n    renders ${rendersF}`;
const $ = (sel) => document.querySelector(sel);
const attrsOf = (el) => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]));
const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };

// ===========================================================================
describe("§66.19.2 — the VERBATIM program: compiles clean, validators land (behaviour)", () => {
  beforeAll(async () => {
    await loadProgram(clean(readM4("src/form/signup.scrml")), "v-signup");
  });
  test("email / password inputs carry their field's validators; the form carries `novalidate`", () => {
    const [email, pw, box] = document.querySelectorAll("main > form input");
    expect(attrsOf(email)).toEqual({ type: "email", required: "", minlength: "5" });
    expect(attrsOf(pw)).toEqual({ type: "password", required: "", minlength: "8" });
    expect(attrsOf(box)).toEqual({ type: "checkbox" });
    expect($("main > form").hasAttribute("novalidate")).toBe(true);
  });
  test("the binds still round-trip (the attributes are inert markup; the bind writes the field)", () => {
    const [email] = document.querySelectorAll("main > form input");
    type(email, "ab");
    expect(email.value).toBe("ab");
  });
});

// ===========================================================================
describe("(1) no implicit bind", () => {
  test("a validated field whose renders is an input WITHOUT `bind:` is not bound — its validators are dead (E-VALIDATOR-DEAD)", () => {
    const src = P(F("req", `<input type="email"/>`, `<form><*v/></form>`), `        <*f/>`);
    expect(codes(src)).toEqual(["E-VALIDATOR-DEAD"]);
  });
  test("…and the same without validators compiles: the input is plain markup (no bind, no attributes)", async () => {
    const core = clean(P(F("", `<input type="email"/>`, `<form><*v/></form>`), `        <*f/>`).replace(" />", "/>"));
    await loadProgram(core, "v-no-implicit");
    expect(attrsOf($("main input"))).toEqual({ type: "email" });
    expect($("main form").hasAttribute("novalidate")).toBe(false);
  });
});

// ===========================================================================
describe("(2) validators follow the bind — wherever it is written", () => {
  test("a bind in the PARENT's renders (`@f.v`) and one at program top level (the shared instance) both carry them", async () => {
    const src = P(F("req length(>=3)", `<input bind:value=@v/>`, `<div><*v/><input class="p" bind:value=@f.v/></div>`),
      `        <*f/>\n        <input class="top" bind:value=@f.v/>`);
    await loadProgram(clean(src), "v-wherever");
    for (const el of document.querySelectorAll("main input")) {
      expect(el.getAttribute("required")).toBe("");
      expect(el.getAttribute("minlength")).toBe("3");
    }
    expect(document.querySelectorAll("main input").length).toBe(3);
  });
  test("two controls, one value: BOTH carry the attributes", async () => {
    const src = P(F("req length(<=9)", `<span><input bind:value=@v/><input type="search" bind:value=@v/></span>`, `<form><*v/></form>`), `        <*f/>`);
    await loadProgram(clean(src), "v-two-controls");
    expect([...document.querySelectorAll("main input")].map((i) => [i.getAttribute("required"), i.getAttribute("maxlength")])).toEqual([["", "9"], ["", "9"]]);
  });
  // r2 F6 (S239 review): a hand-written attribute that DISAGREES with the
  // lowered one no longer silently overrides the declaration's contract.
  test("a hand-written attribute contradicting a lowered one (`minlength=\"1\"` vs `length(>=3)`) → refused at the attribute", () => {
    const d = run(P(F("req length(>=3)", `<input minlength="1" bind:value=@v/>`, `<form><*v/></form>`), `        <*f/>`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("`minlength` is written by hand");
    expect(d[0].message).toContain("lowers to `minlength=\"3\"`");
    // a computed value is not provably the same constraint — refused too
    expect(codes(P(F("req", `<input required=(true) bind:value=@v/>`, `<form><*v/></form>`), `        <*f/>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("a hand-written attribute SAYING THE SAME (`minlength=\"3\"`, bare `required`) is the same constraint: ONE attribute, the author's", async () => {
    const core = clean(P(F("req length(>=3)", `<input minlength="3" required bind:value=@v/>`, `<form><*v/></form>`), `        <*f/>`));
    const els = [];
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n === null || typeof n !== "object") return;
      if (n.variant === "El" && n.data.tag === "input") els.push(n.data);
      Object.values(n).forEach(walk);
    })(core);
    const mins = els[0].attrs.filter((a) => a.variant === "Static" && a.data.name === "minlength").map((a) => a.data.value);
    expect(mins).toEqual(["3"]);                                   // ONE minlength in Core
    await loadProgram(core, "v-hand-same");
    expect(attrsOf($("main input"))).toEqual({ minlength: "3", required: "" });
  });
  test("two `bind:` on one element → refused at the second (one element writes back to one place)", () => {
    const two = `    let <n:string=""/>\n    let <m:string=""/>`;
    const d = run(P(two, `        <input bind:value=@n bind:value=@m/>`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("a second `bind:`");
    expect(codes(P(`    let <ok:bool=false/>\n    let <n:string=""/>`, `        <input type="checkbox" bind:checked=@ok bind:value=@n/>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(two, `        <input bind:value=@n/>\n        <input bind:value=@m/>`))).toEqual([]);
  });
  test("the length comparisons, exactly: `>N` → minlength N+1, `<N` → maxlength N-1, `==N` → both", async () => {
    await loadProgram(clean(P(F("length(>2) length(<9) length(==4)", `<input bind:value=@v/>`, `<form><*v/></form>`), `        <*f/>`)), "v-lengths");
    expect(attrsOf($("main input"))).toEqual({ minlength: "3", maxlength: "8" });
  });
  test("a textarea takes `required` and the lengths; a select takes `required` only", async () => {
    await loadProgram(clean(P(F("req length(>=2)", `<textarea bind:value=@v></textarea>`, `<form><*v/></form>`), `        <*f/>`)), "v-textarea");
    expect(attrsOf($("main textarea"))).toEqual({ required: "", minlength: "2" });
    const sel = P(F("req", `<select bind:value=@v><option value="">-</option><option value="a">a</option></select>`, `<form><*v/></form>`), `        <*f/>`);
    await loadProgram(clean(sel), "v-select");
    expect(attrsOf($("main select"))).toEqual({ required: "" });
  });
  test("a validator with no HTML form on THIS element is refused (it would be inert there — no surface in the bootstrap)", () => {
    const sel = P(F("length(>=2)", `<select bind:value=@v><option value="a">a</option></select>`, `<form><*v/></form>`), `        <*f/>`);
    const d = run(sel).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("`minlength`");
  });
  test("`pattern` lands ONLY when exact: anchored, no flags, no top-level `|`, the plain subset", async () => {
    await loadProgram(clean(P(F("pattern(/^[a-z0-9_]+@x\\.io$/)", `<input bind:value=@v/>`, `<form><*v/></form>`), `        <*f/>`)), "v-pattern");
    expect($("main input").getAttribute("pattern")).toBe("^[a-z0-9_]+@x\\.io$");
    for (const re of ["/abc/", "/^abc$/i", "/^a|b$/", "/^a[.]$/", "/^(?=a)$/"]) {
      const d = run(P(F(`pattern(${re})`, `<input bind:value=@v/>`, `<form><*v/></form>`), `        <*f/>`)).diags;
      expect([re, d.map((x) => x.code)]).toEqual([re, ["E-BOOTSTRAP-UNSUPPORTED"]]);
    }
  });
});

// ===========================================================================
describe("(3) `novalidate` on any form carrying lowered attributes", () => {
  test("directly, through an inlined `<*f/>` child renders, and through a Star of another declaration", async () => {
    const src = P(F("req", `<input bind:value=@v/>`, `<div><*v/></div>`),
      `        <form class="outer"><*f/></form>\n        <form class="plain"><input name="q"/></form>\n        <form class="own" novalidate><*f/></form>`);
    const core = clean(src);
    await loadProgram(core, "v-novalidate");
    expect($("form.outer").hasAttribute("novalidate")).toBe(true);
    expect($("form.plain").hasAttribute("novalidate")).toBe(false);
    expect($("form.own").getAttributeNames().filter((n) => n === "novalidate").length).toBe(1);
  });
  test("through a USE of a declaration (its instances' inputs are in the form)", async () => {
    await loadProgram(clean(P(F("req", `<input bind:value=@v/>`, `<div><*v/></div>`), `        <form><f/></form>`)), "v-novalidate-use");
    expect($("main form").hasAttribute("novalidate")).toBe(true);
  });

  // r2 F1 (S239 review): a `<slot/>` inside a declaration's `<form>` is filled by
  // the children of its uses — a bound validated input there is in the form.
  const W = `    <wrap title:string="t">\n    </>\n    renders <form><slot/><button type="submit">go</button></form>`;
  const FV = F("req length(>=3)", `<input bind:value=@v/>`, `<div><*v/></div>`);
  test("through a `<slot/>` filled with a Star (`<wrap><*f/></wrap>`)", async () => {
    await loadProgram(clean(P(FV + "\n" + W, `        <wrap><*f/></wrap>`)), "v-novalidate-slot-star");
    expect(attrsOf($("main form input"))).toEqual({ required: "", minlength: "3" });
    expect($("main form").hasAttribute("novalidate")).toBe(true);
  });
  test("through a `<slot/>` filled with a bound input written at the use", async () => {
    await loadProgram(clean(P(FV + "\n" + W, `        <*f/>\n        <wrap><input bind:value=@f.v/></wrap>`)), "v-novalidate-slot-direct");
    expect(attrsOf($("main form input"))).toEqual({ required: "", minlength: "3" });
    expect($("main form").hasAttribute("novalidate")).toBe(true);
  });
  test("through a slot filled from ANOTHER declaration's slot (`<wrap2>` passes its children on to `<wrap>`)", async () => {
    const W2 = `    <wrap2 note:string="w">\n    </>\n    renders <section><wrap><slot/></wrap></section>`;
    await loadProgram(clean(P(FV + "\n" + W + "\n" + W2, `        <wrap2><*f/></wrap2>`)), "v-novalidate-slot-nested");
    expect($("main section form").hasAttribute("novalidate")).toBe(true);
  });
  test("a slot filled with plain markup only → no `novalidate`", async () => {
    await loadProgram(clean(P(W, `        <wrap><input name="q" required/></wrap>`)), "v-novalidate-slot-plain");
    expect($("main form").hasAttribute("novalidate")).toBe(false);
  });

  // r2 F5(a): the state-view look-through — a graph field's state-child body
  // inside the form holds the bound input.
  test("through a `<*st/>` state view whose arm body holds the bound input", async () => {
    const src = P(`    type S:enum = { A, B }
    <f note:string="n">
        let <v:string="" req/>
        renders <input bind:value=@v/>
        <st:S=.A>
            <A rule=.B>
                <*v/>
            </>
            <B rule=.A : "b">
        </>
    </>
    renders <form><*st/></form>`, `        <f/>`);
    await loadProgram(clean(src), "v-novalidate-state-arm");
    expect(attrsOf($("main form input"))).toEqual({ required: "" });
    expect($("main form").hasAttribute("novalidate")).toBe(true);
  });
});

// ===========================================================================
describe("(4) O54 = (a): `@v` inside `v`'s own renders is THIS instance", () => {
  test("two instances of the declaration each bind their own `v`", async () => {
    const src = P(F("req", `<input bind:value=@v/>`, `<p><*v/><b>\${v}</b></p>`), `        <f/>\n        <f/>`);
    const { rt } = await loadProgram(clean(src), "v-o54");
    expect(instancesOf(rt, "f").length).toBe(2);
    const [a, b] = document.querySelectorAll("main input");
    type(a, "one");
    type(b, "two");
    expect([...document.querySelectorAll("main b")].map((x) => x.textContent)).toEqual(["one", "two"]);
  });
});

// ===========================================================================
describe("(5) silently dead validators are errors; `@x.isValid` on a no-surface cell is an error", () => {
  test("validators on a top-level scalar (§55.5 Edge A) → E-VALIDATOR-DEAD — bound or not", () => {
    expect(codes(P(`    let <email:string="" req/>`, `        <input bind:value=@email/>`))).toEqual(["E-VALIDATOR-DEAD"]);
    expect(codes(P(`    let <email:string="" req length(>=2)/>`, `        <p>x</p>`))).toEqual(["E-VALIDATOR-DEAD"]);
  });
  test("validators on a child field NOTHING binds → E-VALIDATOR-DEAD at the field (even when logic writes it)", () => {
    const d = run(P(F("req", `<button onclick=(@f.v = "x")>set</button>`, `<div><*v/></div>`), `        <*f/>`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-VALIDATOR-DEAD"]);
    expect(d[0].message).toContain("no `bind:` targets `@v`");
  });
  test("`@cell.isValid` / `.errors` / `.touched` / `.submitted` on a top-level cell → E-VALIDITY-NO-SURFACE", () => {
    for (const prop of ["isValid", "errors", "touched", "submitted"]) {
      expect(codes(P(`    let <q:string=""/>`, `        <p>\${@q.${prop}}</p>`))).toEqual(["E-VALIDITY-NO-SURFACE"]);
    }
  });
  test("a declaration's surface (§55.5 / §55.6) exists but is not built in the bootstrap: refused, never read as a field", () => {
    const base = F("req", `<input bind:value=@v/>`, `<div><*v/></div>`);
    expect(codes(P(base, `        <*f/>\n        <p>\${@f.isValid}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(base, `        <*f/>\n        <p>\${@f.v.errors}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("writing a synthesized property → E-SYNTHESIZED-WRITE (§55.5: read-only)", () => {
    expect(codes(P(F("req", `<input bind:value=@v/>`, `<div><*v/></div>`) + `\n    function g() { @f.isValid = true }`, `        <*f/>`))).toEqual(["E-SYNTHESIZED-WRITE"]);
  });
});

// ===========================================================================
describe("the validator vocabulary the bootstrap honors (§55.1), and what it refuses", () => {
  const one = (vals, opts) => codes(P(F(vals, `<input bind:value=@v/>`, `<form><*v/></form>`, opts), `        <*f/>`));
  test("applicability (§55.1: a validator the value's type cannot take is a type error, E-TYPE-031)", () => {
    expect(one("length(>=2)", { ty: "int", init: "0" })).toContain("E-TYPE-031");
    expect(one("min(0)")).toEqual(["E-TYPE-031"]);
    expect(one("pattern(/^a$/)", { ty: "int", init: "0" })).toContain("E-TYPE-031");
  });
  test("no exact HTML form → refused: `req` on a boolean, a cross-field `eq(…)`, `oneOf`, a non-literal bound, a Level-1 message", () => {
    expect(codes(P(F("req", `<input type="checkbox" bind:checked=@v/>`, `<form><*v/></form>`, { ty: "bool", init: "false" }), `        <*f/>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(one(`eq("x")`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(one(`oneOf(["a", "b"])`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(one(`req("Please fill it in")`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("validators the bootstrap cannot place are refused, never dropped: a user declaration's own opener; a field below a child field", () => {
    const own = P(`    <f note:string="n" req>\n        let <v:string="" req/>\n        renders <input bind:value=@v/>\n    </>\n    renders <form><*v/></form>`, `        <*f/>`);
    const d = run(own).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("own opener");
    const deep = P(`    <f note:string="n">\n        <g:struct> let <k:int=0/>\n            let <w:string="" req/>\n        </>\n    </>\n    renders <p>x</p>`, `        <*f/>`);
    const d2 = run(deep).diags;
    expect(d2.map((x) => x.code)).toContain("E-BOOTSTRAP-UNSUPPORTED");
    expect(d2.some((x) => x.message.includes("nested below a child field"))).toBe(true);
  });
  test("a derived field with validators → E-DERIVED-WITH-VALIDATORS (§55.14)", () => {
    const src = P(`    let <a:string=""/>\n    <f note:string="n">\n        <d:string=(@a + "!") req/>\n        renders <b>\${d}</b>\n    </>\n    renders <div><*d/></div>`, `        <*f/>`);
    expect(codes(src)).toEqual(["E-DERIVED-WITH-VALIDATORS"]);
  });
  test("shape errors: a validator on an ELEMENT, a non-validator call in a tag, `length` / `pattern` without their argument shape", () => {
    expect(codes(P(`    let <s:string=""/>`, `        <input length(>=2) bind:value=@s/>`))).toEqual(["E-PARSE-ATTR"]);
    expect(codes(P(`    let <s:string=""/>`, `        <p foo(1)>x</p>`))).toEqual(["E-PARSE-ATTR"]);
    expect(one("length")).toEqual(["E-PARSE-ATTR"]);
    expect(one("length(3)")).toEqual(["E-PARSE-ATTR"]);
    expect(one("pattern(\"a\")")).toEqual(["E-PARSE-ATTR"]);
  });
});
