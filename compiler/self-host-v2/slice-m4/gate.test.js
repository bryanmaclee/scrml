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
