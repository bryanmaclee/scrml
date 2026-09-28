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
 * References are not calls: `onclick=risky`, `onclick=${risky}`, the arrow
 * `onclick=${() => risky()}` (a function VALUE) and the compiler's own
 * `<formFor onsubmit=fn/>` lowering never fire.
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

  test("inside <errorBoundary fallback=…> the boundary contains it (§19.4.3 item 4)", () => {
    const { errors } = compileBody(`<errorBoundary fallback="oops"><button id="eb" onclick=risky()>x</></errorBoundary>`);
    expect(errors).not.toContain("E-ERROR-002");
    expect(errors).toEqual([]);
  });

  test("inside <errorBoundary> with no fallback and no `renders` → E-ERROR-005, not E-ERROR-002 (§19.6.6)", () => {
    const { errors } = compileBody(`<errorBoundary><button id="eb" onclick={ risky() }>x</></errorBoundary>`);
    expect(errors).not.toContain("E-ERROR-002");
    expect(errors).toContain("E-ERROR-005");
  });
});

describe("§19.4.3 — handled calls and references stay legal", () => {
  const CLEAN = [
    ["reference, bare", `<button onclick=risky>x</>`],
    ["reference, ${}", `<button onclick=\${risky}>x</>`],
    ["arrow value (function value, not a call)", `<button onclick=\${() => risky()}>x</>`],
    ["braced !{} one statement", `<button onclick={ risky() !{ | .Empty :> @r = 1 } }>x</>`],
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
});
