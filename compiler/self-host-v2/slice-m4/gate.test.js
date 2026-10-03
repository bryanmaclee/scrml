// gate.test.js — s449: the compiler submit gate (SPEC §55.17.3) and the
// validity surface it runs on (§55.5–§55.7), run in happy-dom.
//
// The defect this closes (g-bootstrap-validated-form-fields-fail-open-no-
// surface-no-gate, HIGH): the bootstrap added `novalidate` to every form
// carrying lowered validator attributes (S442 (3)) but emitted no gate, so the
// browser's block was removed and nothing replaced it — `save()` ran on `""`.
//
// Governing text, §55.17.3: "On each gated form's `submit` event, the
// compiler-emitted gate SHALL run **before** any author handler and
// **synchronously** … 1. Touch … 2. Submitted … 3. Block if invalid. If
// **any** of those values has `isValid == false`, cancel the submission:
// prevent the event's default action … and do **not** run the author's
// `onsubmit`. 4. Otherwise proceed."

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "g.scrml", src }]);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r.core;
};
const $ = (sel) => document.querySelector(sel);
const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };

/** Dispatch a real submit event (as the browser does for a submit button / Enter); returns it. */
function submit(form, submitter = null) {
  expectNoPageErrors();
  const e = new window.SubmitEvent("submit", { bubbles: true, cancelable: true, submitter });
  form.dispatchEvent(e);
  expectNoPageErrors();
  return e;
}

/** The same Core with every submit gate removed — the bite: the gate is what blocks. */
function withoutGates(core) {
  const strip = (n) => {
    if (Array.isArray(n)) return n.filter((x) => !(x && x.variant === "Gate")).map(strip);
    if (n === null || typeof n !== "object") return n;
    return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, strip(v)]));
  };
  return strip(core);
}

// A declaration `signup` with one validated child field, bound inside a form
// whose submit handler counts its calls in a program cell.
const SIGNUP = `<program>
    <let calls:int=0/>
    <signup note:string="n">
        <let email:string="" req length(>=5)/>
        renders <input type="email" bind:value=@email/>
    </>
    renders <form onsubmit=save()>
        <*email/>
        <button type="submit">Create</button>
        <button type="submit" class="draft" formnovalidate>Draft</button>
    </form>

    function save() { @calls = @calls + 1 }

    <main>
        <*signup/>
        <p class="calls">\${@calls}</p>
    </main>
</program>
`;

const calls = () => $("p.calls").textContent;

describe("§55.17.3 — the gate is FAIL-CLOSED", () => {
  beforeAll(async () => { await loadProgram(clean(SIGNUP), "gate-signup"); });

  test("the form keeps `novalidate` (S442 (3)) and carries the §55.17.6 marker", () => {
    expect($("main form").hasAttribute("novalidate")).toBe(true);
    expect($("main form").getAttribute("data-scrml-gated")).toBe("signup.email");
  });
  test("an INVALID field → the submit handler is NOT called, and the native submission is cancelled", () => {
    const e = submit($("main form"));
    expect(calls()).toBe("0");
    expect(e.defaultPrevented).toBe(true);
  });
  test("still invalid after typing too little (`length(>=5)`) → not called", () => {
    type($("main input"), "ab");
    const e = submit($("main form"));
    expect(calls()).toBe("0");
    expect(e.defaultPrevented).toBe(true);
  });
  test("VALID → the handler runs, and the native submission is left to it", () => {
    type($("main input"), "a@b.io");
    const e = submit($("main form"));
    expect(calls()).toBe("1");
    expect(e.defaultPrevented).toBe(false);
  });
  test("invalid again → blocked again", () => {
    type($("main input"), "");
    submit($("main form"));
    expect(calls()).toBe("1");
  });
  test("§55.17.4: a submitter carrying `formnovalidate` bypasses the block — the handler runs on invalid data", () => {
    submit($("main form"), $("button.draft"));
    expect(calls()).toBe("2");
  });
  test("`requestSubmit()` with no argument (submitter null) is gated", () => {
    submit($("main form"), null);
    expect(calls()).toBe("2");
  });
});

describe("the bite — the same program with the gate removed from Core is fail-open", () => {
  test("no gate → `save()` runs on the empty value (what the bootstrap did before s449)", async () => {
    const core = clean(SIGNUP);
    await loadProgram(withoutGates(core), "gate-signup-nogate");
    expect($("main form").hasAttribute("data-scrml-gated")).toBe(false);
    submit($("main form"));
    expect(calls()).toBe("1");
  });
});

// ===========================================================================
// Top-level validated values (§55.5.1, S447 Edge A reversed) — the §55.17.8
// worked example's shape, run.
// ===========================================================================
const TOP = `<program>
    <let email:string="" req length(>=5)/>
    <let calls:int=0/>

    function register() { @calls = @calls + 1 }

    <main>
        <form onsubmit=register()>
            <label>Email <input type="email" bind:value=@email/></label>
            <errors of=@email/>
            <button type="submit">Create account</button>
        </form>
        <p class="s">\${@email.isValid}|\${@email.touched}|\${@email.submitted}</p>
        <p class="calls">\${@calls}</p>
        <button class="r" onclick=reset(@email)>reset</button>
    </main>
</program>
`;
const surf = () => $("p.s").textContent;
const errs = () => [...document.querySelectorAll("main p.scrml-error")].map((p) => p.textContent);
const clickEl = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

describe("§55.5.1 / §55.17 — a validated TOP-LEVEL value: lowered, surfaced, gated", () => {
  beforeAll(async () => { await loadProgram(clean(TOP), "gate-top"); });

  test("its validators lower onto the bound control (§55.17.1); the form is gated + `novalidate`", () => {
    expect($("main input").getAttribute("required")).toBe("");
    expect($("main input").getAttribute("minlength")).toBe("5");
    expect($("main form").hasAttribute("novalidate")).toBe(true);
    expect($("main form").getAttribute("data-scrml-gated")).toBe("email");
  });
  test("§55.5.1 rule 4: the surface exists at construction — `\"\"` with `req` reads isValid false before any interaction", () => {
    expect(surf()).toBe("false|false|false");
  });
  test("§55.8: `<errors of=@email/>` renders the first error as <p class=\"scrml-error\"> — the Level-3 default message", () => {
    expect(errs()).toEqual(["email is required."]);
  });
  test("§55.17.3 steps 1-3: an invalid submit marks touched + submitted, and does NOT call the handler", () => {
    const e = submit($("main form"));
    expect(calls()).toBe("0");
    expect(e.defaultPrevented).toBe(true);
    expect(surf()).toBe("false|true|true");
  });
  test("§55.12: `req` short-circuits; once non-empty the next validator reports (`length(>=5)`)", () => {
    type($("main input"), "ab");
    expect(errs()).toEqual(["email length must satisfy >=5."]);
  });
  test("valid → no `<errors>` DOM at all (§55.8: \"literally nothing rendered\"), and the submit runs the handler", () => {
    type($("main input"), "a@b.io");
    expect(errs()).toEqual([]);
    expect(surf()).toBe("true|true|true");
    submit($("main form"));
    expect(calls()).toBe("1");
  });
  test("§55.13 `reset(@email)`: the value is restored, touched AND submitted revert (S447 call 6 (ii)); errors recompute", () => {
    clickEl($("button.r"));
    expect($("main input").value).toBe("");
    expect(surf()).toBe("false|false|false");
    expect(errs()).toEqual(["email is required."]);
  });
  test("§55.7: the first focus-out marks touched (no change needed)", () => {
    $("main input").dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    expect(surf()).toBe("false|true|false");
  });
});

// ===========================================================================
// The compound surface (§55.5) and per-field surface (§55.6) of a declaration.
// ===========================================================================
const COMPOUND = `<program>
    <let calls:int=0/>
    <signup note:string="n">
        <let email:string="" req/>
        renders <input class="e" bind:value=@email/>
        <let password:string="" req length(>=8)/>
        renders <input class="p" type="password" bind:value=@password/>
    </>
    renders <form onsubmit=save()>
        <*email/>
        <*password/>
        <button type="submit">Go</button>
        <button type="submit" class="draft" formnovalidate>Draft</button>
    </form>

    function save() { @calls = @calls + 1 }

    <main>
        <*signup/>
        <p class="c">\${@signup.isValid}|\${@signup.submitted}|\${@signup.email.isValid}|\${@signup.email.touched}|\${@signup.password.touched}</p>
        <errors of=@signup all/>
        <p class="calls">\${@calls}</p>
        <button class="r" onclick=reset(@signup.email)>reset email</button>
    </main>
</program>
`;
const comp = () => $("p.c").textContent;

describe("§55.5 / §55.6 — a declaration's compound and per-field surface", () => {
  beforeAll(async () => { await loadProgram(clean(COMPOUND), "gate-compound"); });

  test("`data-scrml-gated` names the child fields by compound path, in source order (§55.17.6)", () => {
    expect($("main form").getAttribute("data-scrml-gated")).toBe("signup.email signup.password");
  });
  test("§55.8 `<errors of=@signup all/>`: the compound rollup, every error of every field", () => {
    expect(errs()).toEqual(["email is required.", "password is required."]);
    expect(comp()).toBe("false|false|false|false|false");
  });
  test("§55.17.4: a `formnovalidate` submit runs the handler and sets the COMPOUND's submitted — but not touched", () => {
    submit($("main form"), $("button.draft"));
    expect(calls()).toBe("1");
    expect(comp()).toBe("false|true|false|false|false");
  });
  test("an invalid gated submit touches every bound validated field; blocked while one is invalid", () => {
    type($("input.e"), "a@b");
    submit($("main form"));
    expect(calls()).toBe("1");
    expect(comp()).toBe("false|true|true|true|true");
    expect(errs()).toEqual(["password is required."]);
  });
  test("every field valid → the compound is valid; the submit runs", () => {
    type($("input.p"), "longenough");
    expect(comp()).toBe("true|true|true|true|true");
    submit($("main form"));
    expect(calls()).toBe("2");
  });
  test("§55.13 `reset(@signup.email)`: that field's touched reverts; the compound's submitted is UNCHANGED", () => {
    clickEl($("button.r"));
    expect(comp()).toBe("false|true|false|false|true");
  });
});

// ===========================================================================
// Which forms are gated, and which instance a submit judges.
// ===========================================================================
describe("§55.17.3 — the gate set and the instance it judges", () => {
  test("a form the AUTHOR wrote `novalidate` on is gated all the same (S447 gate-calls item 1)", async () => {
    const src = TOP.replace("<form onsubmit=register()>", "<form novalidate onsubmit=register()>");
    await loadProgram(clean(src), "gate-own-novalidate");
    expect($("main form").getAttribute("data-scrml-gated")).toBe("email");
    submit($("main form"));
    expect(calls()).toBe("0");
  });
  test("an unrelated form (binds nothing validated) is not gated, its submit is not blocked, and it sets no `submitted`", async () => {
    const src = TOP.replace(`<p class="calls">`, `<form class="other" onsubmit=register()><input name="q"/></form>\n        <p class="calls">`);
    await loadProgram(clean(src), "gate-other-form");
    expect($("form.other").hasAttribute("data-scrml-gated")).toBe(false);
    submit($("form.other"));
    expect(calls()).toBe("1");
    expect(surf()).toBe("false|false|false");
  });
  test("two USES of one declaration in a form: each instance gates by its own value", async () => {
    const src = `<program>
    <let calls:int=0/>
    <f note:string="n">
        <let v:string="" req/>
        renders <input bind:value=@v/>
    </>
    renders <span><*v/></span>
    function save() { @calls = @calls + 1 }
    <main>
        <form onsubmit=save()><f/><f/><button type="submit">go</button></form>
        <p class="calls">\${@calls}</p>
    </main>
</program>
`;
    await loadProgram(clean(src), "gate-two-uses");
    const [a, b] = document.querySelectorAll("main input");
    type(a, "x");
    submit($("main form"));
    expect(calls()).toBe("0");
    type(b, "y");
    submit($("main form"));
    expect(calls()).toBe("1");
  });
});

// ===========================================================================
// Diagnostics.
// ===========================================================================
describe("diagnostics — the surface is read-only; `<errors>` takes a surface", () => {
  const codes = (src) => run(src).diags.map((d) => d.code);
  const P = (decls, main) => `<program>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
  const F = `    <f note:string="n">\n        <let v:string="" req/>\n        renders <input bind:value=@v/>\n    </>\n    renders <div><*v/></div>`;
  test("E-SYNTHESIZED-WRITE: writing a top-level value's or a field's surface property (§55.5.1 rule 7, §55.7)", () => {
    expect(codes(P(`    <let e:string="" req/>\n    function g() { @e.isValid = true }`, `        <input bind:value=@e/>`))).toEqual(["E-SYNTHESIZED-WRITE"]);
    expect(codes(P(F + `\n    function g() { @f.v.touched = true }`, `        <*f/>`))).toEqual(["E-SYNTHESIZED-WRITE"]);
  });
  test("E-VALIDITY-NO-SURFACE: a top-level value with no validators — read or `<errors of=…/>` (§55.5.1 rule 2, §55.8)", () => {
    expect(codes(P(`    <let q:string=""/>`, `        <p>\${@q.isValid}</p>`))).toEqual(["E-VALIDITY-NO-SURFACE"]);
    expect(codes(P(`    <let q:string=""/>`, `        <errors of=@q/>`))).toEqual(["E-VALIDITY-NO-SURFACE"]);
  });
  test("E-ERRORS-001 (no `of=`), E-ERRORS-002 (not a `@`-rooted surface)", () => {
    expect(codes(P(`    <let e:string="" req/>`, `        <input bind:value=@e/>\n        <errors/>`))).toEqual(["E-ERRORS-001"]);
    expect(codes(P(`    <let e:string="" req/>`, `        <input bind:value=@e/>\n        <errors of="e"/>`))).toEqual(["E-ERRORS-002"]);
  });
  test("refused, never dropped: an `<errors>` body override; an unknown attribute; `errors` read as a value", () => {
    expect(codes(P(`    <let e:string="" req/>`, `        <input bind:value=@e/>\n        <errors of=@e><b>x</b></errors>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(`    <let e:string="" req/>`, `        <input bind:value=@e/>\n        <errors of=@e max="2"/>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(`    <let e:string="" req/>`, `        <input bind:value=@e/>\n        <p>\${@e.errors}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("I-FORM-SUBMIT-GATED (§55.17.6): one per gated form, at its opener, naming the values in source order — non-fatal (the infos stream)", () => {
    const r = run(COMPOUND);
    expect(r.diags).toEqual([]);
    expect(r.infos.map((i) => i.code)).toEqual(["I-FORM-SUBMIT-GATED"]);
    expect(r.infos[0].message).toContain("this form's submit is gated by: signup.email, signup.password");
    expect(COMPOUND.slice(r.infos[0].span.start, r.infos[0].span.start + 5)).toBe("<form");
    const top = run(TOP);
    expect(top.infos.map((i) => i.message.split(" — ")[0])).toEqual(["this form's submit is gated by: email"]);
    expect(run(P(`    <let q:string=""/>`, `        <form><input bind:value=@q/></form>`)).infos).toEqual([]);
  });
  test("a field of a declaration has no `submitted` of its own (§55.6) — its compound does", () => {
    const d = run(P(F, `        <*f/>\n        <p>\${@f.v.submitted}</p>`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-SCOPE-001"]);
    expect(d[0].message).toContain("@f.submitted");
  });
});
