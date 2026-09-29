/**
 * e-error-002-handler-forms.test.js
 *
 * SPEC §19.4.3 / §19.4.4 — "Failing to handle the result of a `!` function call
 * ... SHALL be a compile error: E-ERROR-002" and "An unhandled `!` function call
 * SHALL be a compile error (E-ERROR-002)". Neither sentence exempts event-handler
 * values.
 *
 * S439 ruling #14 + S440 ("all recs" — restore conformance): the answer for an
 * unhandled `!` call in an event-handler value follows the CALL, not the number of
 * statements or the form. Before this change impl#1 fired E-ERROR-002 only for a
 * multi-statement braced handler (`onclick={ risky(); @r = 1 }`); the one-statement
 * forms (`onclick=risky()`, `onclick={ risky() }`, `onclick=${risky()}`, a multi-line
 * `{ risky() }`) compiled at exit 0 — impl#1's handler exemption.
 *
 * Also pinned: a `!{}`-guarded one-statement handler takes the statement view
 * (`handlerBlock`), so its guard is EMITTED (it was silently dropped before — the
 * expression view stops at the call) and the call counts as handled.
 *
 * References are not calls: `onclick=risky`, `onclick=${risky}` and the compiler's
 * own `<formFor onsubmit=fn/>` lowering never fire.
 *
 * S440 fix round (review of cd6089168):
 *   F1 — the count split survived for control flow: a one-statement
 *        `{ if (c) risky() }` / `{ for (…) risky() }` compiled at exit 0 while the
 *        same statement plus a second one errored. One-statement values are now
 *        parsed as a statement list for checking and walked like `handlerBlock`.
 *   F2/F4 — component bodies (native re-parse) carried no statement lists: the
 *        multi-statement form was unchecked and `{ f() !{…} }` emitted a raw `!{`.
 *   F3 — a `<match>` arm's handler statement parse THREW (null parent block) and
 *        was swallowed: the guard and every later statement were silently dropped.
 *   F5 — a handler runs after render; an `<errorBoundary>` does not contain it, so
 *        E-ERROR-002 fires inside one and the render-time E-ERROR-005 does not.
 *   F7 — the handler callee resolves through scope (an `<each … as risky>` alias
 *        is not the failable `risky`).
 * Arrow-valued handlers (S440 ruling, all recs #2 item 1): "check arrow bodies. An
 * arrow body runs on the event exactly like `{ risky() }`, so check it the same way
 * and emit its guard."
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const HEADER = `type LoadError:enum = { Empty }
type Phase:enum = { Idle, Loading }

\${
    function risky()! -> LoadError { fail LoadError.Empty }
    function plain(x) { return x }
}

<r> = 0
<ph>: Phase = .Idle
<items> = [{ id: 1, name: "a" }, { id: 2, name: "b" }]
`;

function compileBody(body, { emit = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "e-error-002-handler-"));
  try {
    const file = join(dir, "case.scrml");
    writeFileSync(file, HEADER + "\n" + body + "\n");
    const outDir = join(dir, "out");
    const r = compileScrml({ inputFiles: [file], write: emit, outputDir: outDir, log: () => {} });
    const errors = (r.errors ?? []).map((d) => d.code);
    let clientJs = "";
    if (emit && errors.length === 0) {
      for (const f of readdirSync(outDir)) if (f.endsWith(".client.js")) clientJs += readFileSync(join(outDir, f), "utf8");
    }
    return { errors, clientJs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const count = (codes, c) => codes.filter((x) => x === c).length;

describe("§19.4.3 — every handler form with an unhandled `!` call is E-ERROR-002", () => {
  const FIRES = [
    ["bare call", `<button onclick=risky()>x</>`],
    ["braced one statement", `<button onclick={ risky() }>x</>`],
    ["${} expression", `<button onclick=\${risky()}>x</>`],
    ["braced multi-line one statement", `<button onclick={\n    risky()\n}>x</>`],
    ["braced multi-statement (already fired)", `<button onclick={ risky(); @r = 1 }>x</>`],
    ["braced multi-statement, call last", `<button onclick={ @r = 1; risky() }>x</>`],
    ["namespaced on:click", `<button on:click=risky()>x</>`],
    ["non-click event", `<input onkeydown=risky()>`],
    // F1 — control flow in a ONE-statement handler (was exit 0)
    ["one-statement unbraced if", `<button onclick={ if (@r > 0) risky() }>x</>`],
    ["one-statement braced if", `<button onclick={ if (@r > 0) { risky() } }>x</>`],
    ["one-statement if/else, call in else", `<button onclick={ if (@r > 0) { @r = 1 } else { risky() } }>x</>`],
    ["one-statement for", `<button onclick={ for (const i of [1, 2]) risky() }>x</>`],
    ["one-statement if in ${}", `<button onclick=\${ if (@r > 0) risky() }>x</>`],
    ["if + second statement (already fired)", `<button onclick={ if (@r > 0) risky(); @r = 1 }>x</>`],
    ["multi-line one-statement if", `<button onclick={\n    if (@r > 0) {\n        risky()\n    }\n}>x</>`],
  ];
  for (const [label, body] of FIRES) {
    test(label, () => {
      const { errors } = compileBody(body);
      expect(count(errors, "E-ERROR-002")).toBe(1);
    });
  }
});

describe("§19.4.3 — handler positions", () => {
  test("inside an <each> row (bare + braced)", () => {
    const a = compileBody(`<ul><each in=@items key=@.id><li><button class="row" onclick=risky()>x</></></each></>`);
    const b = compileBody(`<ul><each in=@items key=@.id><li><button class="row" onclick={ risky() }>x</></></each></>`);
    expect(a.errors).toContain("E-ERROR-002");
    expect(b.errors).toContain("E-ERROR-002");
  });

  test("inside an engine state-child", () => {
    const { errors } = compileBody(`<engine for=Phase initial=.Idle>\n<Idle>\n<button id="go" onclick=risky()>Begin</>\n</>\n<Loading : "Loading">\n</>`);
    expect(errors).toContain("E-ERROR-002");
  });

  test("inside a <match> arm", () => {
    const { errors } = compileBody(`<match on=@ph>\n<Idle>\n<button id="mc" onclick={ risky() }>x</button>\n</>\n<Loading><p>L</p></>\n</>`);
    expect(errors).toContain("E-ERROR-002");
  });

  // F5 — a handler runs on an event, after render; an enclosing boundary does not
  // contain its failure, so it is NOT exempt, and the render-time E-ERROR-005 does
  // not apply to it.
  for (const [label, body] of [
    ["bare, boundary with fallback", `<errorBoundary fallback="oops"><button id="eb" onclick=risky()>x</></errorBoundary>`],
    ["braced, boundary without fallback", `<errorBoundary><button id="eb" onclick={ risky() }>x</></errorBoundary>`],
    ["multi-statement, boundary without fallback", `<errorBoundary><button id="eb" onclick={ risky(); @r = 1 }>x</></errorBoundary>`],
  ]) {
    test(`inside <errorBoundary> is NOT exempt — ${label}`, () => {
      const { errors } = compileBody(body);
      expect(count(errors, "E-ERROR-002")).toBe(1);
      expect(errors).not.toContain("E-ERROR-005");
    });
  }

  test("a RENDER-time call inside <errorBoundary fallback=…> is still contained (unchanged)", () => {
    const { errors } = compileBody(`<errorBoundary fallback="oops"><p>\${risky()}</p></errorBoundary>`);
    expect(errors).toEqual([]);
  });

  // F2 — component bodies: every form errors (the span is component-relative).
  for (const [label, handler] of [
    ["bare", `onclick=risky()`],
    ["braced one statement", `onclick={ risky() }`],
    ["braced multi-statement", `onclick={ risky(); @r = 1 }`],
    ["one-statement if", `onclick={ if (@r > 0) risky() }`],
  ]) {
    test(`inside a component body — ${label}`, () => {
      const { errors } = compileBody(`\${ const Btn = <button ${handler}>go</> }\n<Btn/>`);
      expect(count(errors, "E-ERROR-002")).toBe(1);
    });
  }

  // The statement list attached to a component-body handler must carry the prop
  // substitution — every statement, and a control-flow statement too.
  test("component multi-statement handler substitutes props into EVERY statement", () => {
    const { errors, clientJs } = compileBody(
      `\${ const B = <button props={ label: string } onclick={ @r = 1; @r = label.length }>\${label}</> }\n<B label="xy"/>`,
      { emit: true },
    );
    expect(errors).toEqual([]);
    const handler = clientJs.slice(clientJs.indexOf('"_scrml_attr_onclick_'));
    expect(handler).toMatch(/_reactive_set\("r", 1\)/);
    expect(handler).toMatch(/"xy"\.length/);
  });

  test("component one-statement `if` handler still substitutes the prop (no raw prop name emitted)", () => {
    const { errors, clientJs } = compileBody(
      `\${ const B = <button props={ act: fn } onclick={ if (@r > 0) act() }>go</> }\n<B act=plain/>`,
      { emit: true },
    );
    expect(errors).toEqual([]);
    const handler = clientJs.slice(clientJs.indexOf('"_scrml_attr_onclick_'), clientJs.indexOf('"_scrml_attr_onclick_') + 200);
    expect(handler).not.toMatch(/\bact\(\)/);
  });

  // N2 — a `!{}` guard's ARMS are prop-substituted in a component body.
  test("component handler guard arm reading a prop is substituted (was E-SCOPE-001)", () => {
    const { errors, clientJs } = compileBody(
      `\${ const B = <button props={ n: number } onclick={ risky() !{ | .Empty :> @r = n } }>go</> }\n<B n=\${9}/>`,
      { emit: true },
    );
    expect(errors).toEqual([]);
    const handler = clientJs.slice(clientJs.indexOf('"_scrml_attr_onclick_'));
    expect(handler).toMatch(/_reactive_set\("r", 9\)/);
  });

  // N4 — inside a handler, `event` is the DOM event in BOTH lowering paths.
  for (const [label, handler] of [
    ["one statement", `onclick={ @msg = event }`],
    ["two statements", `onclick={ @msg = event; @r = 1 }`],
  ]) {
    test(`a prop named \`event\` is shadowed by the DOM event — ${label}`, () => {
      const { errors, clientJs } = compileBody(
        `<msg> = ""\n\${ const B = <button props={ event: string } ${handler}>go</> }\n<B event="hi"/>`,
        { emit: true },
      );
      expect(errors).toEqual([]);
      const h = clientJs.slice(clientJs.indexOf('"_scrml_attr_onclick_'), clientJs.indexOf('"_scrml_attr_onclick_') + 160);
      expect(h).toMatch(/_reactive_set\("msg", event\)/);
      expect(h).not.toMatch(/"hi"/);
    });
  }

  // F7 — the callee resolves through scope.
  for (const [label, body] of [
    ["bare", `<ul><each in=@items as risky><li><button onclick=risky()>x</></></each></>`],
    ["braced", `<ul><each in=@items as risky><li><button onclick={ risky() }>x</></></each></>`],
    ["multi-statement", `<ul><each in=@items as risky><li><button onclick={ risky(); @r = 1 }>x</></></each></>`],
  ]) {
    test(`an <each> alias shadowing the failable name is not the failable call — ${label}`, () => {
      const { errors } = compileBody(body);
      expect(errors).not.toContain("E-ERROR-002");
    });
  }
});

describe("§19.4.3 — handled calls and references stay legal", () => {
  const CLEAN = [
    ["reference, bare", `<button onclick=risky>x</>`],
    ["reference, ${}", `<button onclick=\${risky}>x</>`],
    ["braced !{} one statement", `<button onclick={ risky() !{ | .Empty :> @r = 1 } }>x</>`],
    ["component body, braced !{}", `\${ const Btn = <button onclick={ risky() !{ | .Empty :> @r = 1 } }>go</> }\n<Btn/>`],
    ["${} !{} one statement", `<button onclick=\${risky() !{ | .Empty :> @r = 2 }}>x</>`],
    ["braced !{} multi-line", `<button onclick={\n    risky() !{ | .Empty :> @r = 1 }\n}>x</>`],
    ["braced !{} multi-statement", `<button onclick={ risky() !{ | .Empty :> @r = 1 }; @r = 5 }>x</>`],
    ["non-failable call, bare", `<button onclick=plain(1)>x</>`],
    ["non-failable call, braced", `<button onclick={ plain(1) }>x</>`],
  ];
  for (const [label, body] of CLEAN) {
    test(label, () => {
      const { errors } = compileBody(body);
      expect(errors).toEqual([]);
    });
  }

  // A `!{}` guard inside a ONE-LINE single-statement `if`/`for` handler. The CHECK
  // accepts it (the call is handled — no E-ERROR-002), but codegen emits a raw `!{`
  // and the full pipeline fails E-CODEGEN-INVALID-LOGIC (pre-existing on main;
  // fails closed). This used to sit in CLEAN above and passed only because
  // compileBody defaults to write:false, which skips codegen validation (S441
  // review). It now runs the FULL pipeline.
  //   - the `test.failing` states the target (a clean full compile); when
  //     g-guard-in-one-line-if-for-emits-raw-bang-brace is fixed it starts
  //     passing, `test.failing` reports that as a failure, and the fixer flips it
  //     to a plain `test`.
  //   - the positive pin below asserts the CURRENT failure exactly, so the
  //     `test.failing` cannot be kept green by an unrelated break.
  const GUARD_IN_ONE_LINE_IF = `<button onclick={ if (@r > 0) { risky() !{ | .Empty :> @r = 1 } } }>x</>`;
  test.failing("braced !{} inside a one-statement if — full compile is clean [xfail: g-guard-in-one-line-if-for-emits-raw-bang-brace]", () => {
    const { errors } = compileBody(GUARD_IN_ONE_LINE_IF, { emit: true });
    expect(errors).toEqual([]);
  });
  test("braced !{} inside a one-statement if — pin: no E-ERROR-002, codegen fails closed (g-guard-in-one-line-if-for-emits-raw-bang-brace)", () => {
    expect(compileBody(GUARD_IN_ONE_LINE_IF).errors).toEqual([]);
    expect(compileBody(GUARD_IN_ONE_LINE_IF, { emit: true }).errors).toEqual(["E-CODEGEN-INVALID-LOGIC"]);
  });

  test("a call handled inside a non-failable wrapper function", () => {
    const { errors } = compileBody(
      `\${ function go() { risky() !{ | .Empty :> @r = 1 } } }\n<button onclick=go()>x</>`,
    );
    expect(errors).toEqual([]);
  });

  test("the compiler's <formFor onsubmit=fn/> lowering is not an author call (§41.14.3)", () => {
    const src = readFileSync(
      resolve(import.meta.dir, "../../../conformance/cases/form-for/formfor-typing-errors/case.scrml"),
      "utf8",
    );
    const dir = mkdtempSync(join(tmpdir(), "e-error-002-formfor-"));
    try {
      const file = join(dir, "case.scrml");
      writeFileSync(file, src);
      const r = compileScrml({ inputFiles: [file], write: false, outputDir: join(dir, "out"), log: () => {} });
      expect((r.errors ?? []).map((d) => d.code)).not.toContain("E-ERROR-002");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scope: CPS-implicit failability is NOT escalated on one-statement handlers", () => {
  // A server-escalated fn NOT declared `!` is CPS-implicit-failable; its
  // W-CPS-NEEDS-FAILABLE deprecation warning is a separate cycle. The S440 ruling
  // covers functions DECLARED `!` only, so `onclick=save()` stays as it was.
  test("onclick=save() on a CPS-implicit server fn — no E-ERROR-002, no new W-CPS-NEEDS-FAILABLE", () => {
    const dir = mkdtempSync(join(tmpdir(), "e-error-002-cps-"));
    try {
      const file = join(dir, "case.scrml");
      writeFileSync(file, `\${
    <out> = ""
    function save() {
        ?{\`CREATE TABLE IF NOT EXISTS t (x text)\`}.run()
        @out = "saved"
    }
}
<button onclick=save()>go</>
`);
      const r = compileScrml({ inputFiles: [file], write: false, outputDir: join(dir, "out"), log: () => {} });
      const all = [...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d.code);
      expect(all).not.toContain("E-ERROR-002");
      expect(all).not.toContain("W-CPS-NEEDS-FAILABLE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a `!{}`-guarded one-statement handler emits its guard", () => {
  test("braced form — the variant arm is in the handler, not dropped", () => {
    const { errors, clientJs } = compileBody(`<button onclick={ risky() !{ | .Empty :> @r = 7 } }>x</>`, { emit: true });
    expect(errors).toEqual([]);
    const handler = clientJs.slice(clientJs.indexOf('"_scrml_attr_onclick_'));
    expect(handler).toMatch(/\.variant === "Empty"/);
    expect(handler).toMatch(/_reactive_set\("r", 7\)/);
  });

  test("a non-exhaustive guard is now checked like any other (was dropped unchecked)", () => {
    const { errors } = compileBody(`<button onclick={ risky() !{ | .Other :> @r = 1 } }>x</>`);
    expect(errors).not.toContain("E-ERROR-002");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("F3 — in a <match> arm, the guard AND the following statement are emitted", () => {
    const { errors, clientJs } = compileBody(
      `<match on=@ph>\n<Idle>\n<button id="mc" onclick={ risky() !{ | .Empty :> @r = 7 }; @r = @r + 1 }>x</button>\n</>\n<Loading><p>L</p></>\n</>`,
      { emit: true },
    );
    expect(errors).toEqual([]);
    const handler = clientJs.slice(clientJs.indexOf('"_scrml_attr_onclick_'));
    expect(handler).toMatch(/\.variant === "Empty"/);
    expect(handler).toMatch(/_reactive_set\("r", 7\)/);
  });

  test("F4 — in a component body, the guard emits (was a raw `!{` → E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors, clientJs } = compileBody(
      `\${ const Btn = <button onclick={ risky() !{ | .Empty :> @r = 7 } }>go</> }\n<Btn/>`,
      { emit: true },
    );
    expect(errors).toEqual([]);
    const handler = clientJs.slice(clientJs.indexOf('"_scrml_attr_onclick_'));
    expect(handler).toMatch(/\.variant === "Empty"/);
    expect(handler).not.toMatch(/!\{/);
  });
});

describe("arrow-valued handlers — S440 ruling: checked like `{ … }`, guard emitted", () => {
  for (const [label, body] of [
    ["expression body, one param", `<button onclick=\${(e) => risky()}>x</>`],
    ["expression body, bare param", `<button onclick=\${e => risky()}>x</>`],
    ["expression body, no params", `<button onclick=\${() => risky()}>x</>`],
    ["block body", `<button onclick=\${() => { risky() }}>x</>`],
    ["block body, call after another statement", `<button onclick=\${() => { @r = 1; risky() }}>x</>`],
    ["block body, call under if", `<button onclick=\${(e) => { if (@r > 0) risky() }}>x</>`],
    ["braced arrow", `<button onclick={ () => risky() }>x</>`],
    ["in an <each> row", `<ul><each in=@items key=@.id><li><button onclick=\${() => risky()}>x</></></each></>`],
  ]) {
    test(`unhandled call in an arrow body is E-ERROR-002 — ${label}`, () => {
      const { errors } = compileBody(body);
      expect(count(errors, "E-ERROR-002")).toBe(1);
    });
  }

  for (const [label, body] of [
    ["guard, expression body", `<button onclick=\${(e) => risky() !{ | .Empty :> @r = 1 }}>x</>`],
    ["guard, block body + param use", `<button onclick=\${(e) => { risky() !{ | .Empty :> @r = 1 }; @r = e.detail }}>x</>`],
    ["non-failable call reading the param", `<button onclick=\${(e) => plain(e)}>x</>`],
    ["arrow that is only the first statement of a sequence stays the regular path", `<button onclick={ () => plain(1); @r = 2 }>x</>`],
  ]) {
    test(`clean — ${label}`, () => {
      const { errors } = compileBody(body);
      expect(errors).not.toContain("E-ERROR-002");
    });
  }

  test("the guard in an arrow body is EMITTED (was `(e) => _scrml_risky()`)", () => {
    const { errors, clientJs } = compileBody(`<button onclick=\${(e) => risky() !{ | .Empty :> @r = 7 }}>x</>`, { emit: true });
    expect(errors).toEqual([]);
    const handler = clientJs.slice(clientJs.indexOf('"_scrml_attr_onclick_'));
    expect(handler).toMatch(/const e = event;/);
    expect(handler).toMatch(/\.variant === "Empty"/);
    expect(handler).toMatch(/_reactive_set\("r", 7\)/);
  });

  // N5 — non-simple params are not modelled: unchecked and emitted as before.
  for (const [label, param] of [["default", "(e = 1)"], ["rest", "(...a)"]]) {
    test(`an arrow with a ${label} parameter is emitted as before (no E-CODEGEN-INVALID-LOGIC)`, () => {
      const { errors, clientJs } = compileBody(
        `<button onclick=\${${param} => risky() !{ | .Empty :> @r = 1 }}>x</>`,
        { emit: true },
      );
      expect(errors).toEqual([]);
      expect(clientJs).not.toMatch(/= event =/);
    });
  }

  test("the handler-site E-ERROR-002 message does not advise <errorBoundary> (S440 #22)", () => {
    const dir = mkdtempSync(join(tmpdir(), "e-error-002-msg-"));
    try {
      const file = join(dir, "case.scrml");
      writeFileSync(file, HEADER + "\n<button onclick={ risky() }>x</>\n");
      const r = compileScrml({ inputFiles: [file], write: false, outputDir: join(dir, "out"), log: () => {} });
      const e = (r.errors ?? []).find((d) => d.code === "E-ERROR-002");
      expect(e).toBeDefined();
      expect(e.message).toMatch(/does not catch errors raised in event handlers/);
      expect(e.message).not.toMatch(/or wrap in '<errorBoundary>'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an arrow WITHOUT a guard keeps its as-is emission", () => {
    const { errors, clientJs } = compileBody(`<button onclick=\${(e) => plain(e)}>x</>`, { emit: true });
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/\(e\) => _scrml_plain_\d+\(e\)/);
  });
});
