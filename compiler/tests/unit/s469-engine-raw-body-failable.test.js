// S469 (s469-engine-effect-failable, SECURITY) — engine / `<match>` bodies kept as raw text.
//
//   1. logic-block-extent: a raw-text `${ … }` block ends where acorn (both goals) ends it.
//   2. E-ERROR-002 over every engine raw-text body (state-child / opener `effect=`,
//      `<onTransition>` body and `if=` guard, message arm, `<onTimeout after=${…}>`,
//      `:`-shorthand state body) and `<match>` `:`-shorthand arm; the handled forms compile.
//   3. LOW-1: `await` in a template interpolation is E-AWAIT-NOT-IN-SCRML (not a codegen defect).
//
// The run-time floor (a wrong password never logs in) is the security-failable-pack, family n14.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileScrml } from "../../src/api.js";
import { logicBlockClose, braceBlockClose, soleLogicBlockPayload } from "../../src/logic-block-extent.ts";

let root;
let seq = 0;
beforeAll(() => { root = mkdtempSync(join(tmpdir(), "s469-engine-raw-")); });
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function codes(src) {
  const dir = join(root, String(seq++));
  const input = join(dir, "app.scrml");
  require("node:fs").mkdirSync(dir, { recursive: true });
  writeFileSync(input, src);
  const res = compileScrml({ inputFiles: [input], write: false, outputDir: join(dir, "out"), log: () => {} });
  return [...new Set((res.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? "")).map((e) => e.code))];
}

const HEAD = `type AuthErr:enum = { Denied }
type S:enum = { A, B }
type M:enum = { Go }
<msg> = "init"
<pw> = ""
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
<button id="go" onclick=\${ @s = .B }>go</button>
<p>\${@msg}</p>
`;
const ENG = (body, opener = "") => HEAD + `<engine for=S initial=.A${opener}>\n${body}\n</engine>\n`;
const EFF = (e) => ENG(`<A rule=.B effect=\${ ${e} }><p>a</p></A>\n<B rule=.A><p>b</p></B>`);
const TERN = `@msg = check(@pw) ? "IN" : "OUT"`;

describe("logic-block-extent — acorn bounds a raw-text ${…} block", () => {
  const close = (s) => { const i = s.indexOf("${"); const e = logicBlockClose(s, i); return e < 0 ? null : s.slice(i + 2, e); };
  test("a } in a string, comment, template or regex does not close it", () => {
    expect(close('x=${ a = "}" + b }>')).toBe(' a = "}" + b ');
    expect(close("x=${ a = /* } */ b }>")).toBe(" a = /* } */ b ");
    expect(close("x=${ a = `}${ {k:1}.k }` }>")).toBe(" a = `}${ {k:1}.k }` ");
    expect(close("x=${ a = /}/.test(b) }>")).toBe(" a = /}/.test(b) ");
  });
  test("a statement list in scrml syntax is bounded by its tokens", () => {
    expect(close('x=${ check(p) !{ .Denied :> @m = "r" }\n @n = 1 }>')).toBe(' check(p) !{ .Denied :> @m = "r" }\n @n = 1 ');
    expect(close("x=${ m = match y { .A :> 1  _ :> 2 } }>")).toBe(" m = match y { .A :> 1  _ :> 2 } ");
  });
  test("unreadable: unterminated, goal-dependent (`await /}/`), or an HTML-like comment", () => {
    expect(close('x=${ a = "open }>')).toBe(null);
    expect(close("x=${ await /}/g }>")).toBe(null);
    expect(close("x=${ a <!-- }\n }>")).toBe(null);
  });
  test("braceBlockClose / soleLogicBlockPayload", () => {
    const s = '{ @a = "}"; .B } rest';
    expect(s.slice(0, braceBlockClose(s, 0) + 1)).toBe('{ @a = "}"; .B }');
    expect(soleLogicBlockPayload(' ${ a("}") } ')).toBe(' a("}") ');
    expect(soleLogicBlockPayload("${ a }${ b }")).toBe(null);
  });
});

describe("E-ERROR-002 — an engine body kept as raw text is walked for failable calls", () => {
  const refused = [
    ["state-child effect=", EFF(TERN)],
    ["state-child effect= comma", EFF(`@msg = (1, check(@pw)) ? "IN" : "OUT"`)],
    ["state-child effect= statement", EFF(`check(@pw)\n    @msg = "IN"`)],
    ["state-child effect= behind a comment `}`", EFF(`@msg = /* } */ check(@pw) ? "IN" : "OUT"`)],
    ["opener effect=", HEAD + `<engine for=S initial=.A effect=\${ ${TERN} }>\n<A rule=.B><p>a</p></A>\n<B rule=.A><p>b</p></B>\n</engine>\n`],
    ["<onTransition> body", ENG(`<A rule=.B>\n<p>a</p>\n<onTransition to=.B>\${ ${TERN} }</>\n</A>\n<B rule=.A><p>b</p></B>`)],
    ["engine-direct <onTransition>", ENG(`<onTransition from=.A to=.B>\${ ${TERN} }</>\n<A rule=.B><p>a</p></A>\n<B rule=.A><p>b</p></B>`)],
    ["<onTransition if=> guard", ENG(`<A rule=.B>\n<p>a</p>\n<onTransition to=.B if=check(@pw)>\${ @msg = "IN" }</>\n</A>\n<B rule=.A><p>b</p></B>`)],
    ["message arm", ENG(`<A rule=.B>\n.Go :> { ${TERN}; .B }\n</A>\n<B rule=.A>\n_ :> @s\n</B>`, " accepts=M")],
    ["<onTimeout after=${…}>", ENG(`<A rule=.B><p>a</p></A>\n<B rule=.A>\n<p>b</p>\n<onTimeout after=\${ (check(@pw), 1) }ms to=.A/>\n</B>`)],
    [":-shorthand state body", HEAD + `<div><engine for=S initial=.A><A rule=.B : "x"><B rule=.A : check(@pw) ? "IN" : "OUT"></engine></div>\n`],
    ["<match> :-shorthand arm", HEAD + `<st> = S.A\n<div><match for=S on=@st><A : "x"><B : check(@pw) ? "IN" : "OUT"></match></div>\n`],
  ];
  for (const [name, src] of refused) {
    test(name, () => { expect(codes(src)).toContain("E-ERROR-002"); });
  }

  const accepted = [
    ["effect= handled by !{}", EFF(`check(@pw) !{ .Denied :> @msg = "OUT" }`)],
    ["effect= match on the call", EFF(`@msg = match check(@pw) { .Denied :> "OUT"  _ :> "IN" }`)],
    ["<onTransition> handled", ENG(`<A rule=.B>\n<p>a</p>\n<onTransition to=.B>\${ @msg = (check(@pw) !{ _ :> false }) ? "IN" : "OUT" }</>\n</A>\n<B rule=.A><p>b</p></B>`)],
    ["no failable call", EFF(`@msg = "x" + @pw`)],
  ];
  for (const [name, src] of accepted) {
    test(`accepted: ${name}`, () => { expect(codes(src)).toEqual([]); });
  }
});

describe("route-inference — a `}` in a string inside a SQL `${…}` slot hides no name", () => {
  // `/\$\{([^}]*)\}/` read `${ "}" + k }` as ` "`: `k` was missed, the INSERT batch was split off
  // without it, and its server half read an unbound `k` (ReferenceError at run time).
  const page = (decl, slot) => `<program db="sqlite:./ri.db">
\${
  function flow(x) {
    ${decl}
    @msg = "step"
    ?{\`INSERT INTO audit (v) VALUES (\${ ${slot} })\`}.run() !{ _ :> not }
  }
}
<msg> = ""
<button id="go" onclick=\${ flow("a") }>go</button>
<p>\${@msg}</p>
</program>
`;
  const shape = (src) => {
    const dir = join(root, String(seq++));
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app.scrml"), src);
    compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: join(dir, "out"), log: () => {} });
    const fs = require("node:fs");
    const sj = fs.readFileSync(join(dir, "out", "app.server.js"), "utf8");
    const reads = [...new Set([...sj.matchAll(/_scrml_body\[\s*"([^"]+)"\s*\]/g)].map((m) => m[1]))].sort();
    const routes = [...new Set([...sj.matchAll(/export const (__ri_route_[A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort();
    return { reads, routes };
  };
  for (const [name, decl] of [
    ["a client local", 'const k = x + "!"'],
    ["a server value", "const k = ?{`SELECT value FROM secrets`}.get() !{ _ :> not }"],
  ]) {
    test(name, () => {
      expect(shape(page(decl, '"}" + k'))).toEqual(shape(page(decl, "k")));
    });
  }
});

describe("LOW-1 — `await` in a template interpolation is E-AWAIT-NOT-IN-SCRML", () => {
  test("quoted attribute interpolation", () => {
    const c = codes(`<p data-v="\${ await /qq,window.__inj = 1,qq/g }">x</p>\n`);
    expect(c).toContain("E-AWAIT-NOT-IN-SCRML");
    expect(c).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });
  test("template literal interpolation", () => {
    expect(codes("${ function g() { return 1 }\n   function f() { return `v ${ await g() }` } }\n<p>${f()}</p>\n")).toContain("E-AWAIT-NOT-IN-SCRML");
  });
  test("the word in a string is not an await", () => {
    expect(codes(`<x> = "a"\n<p data-v="\${ 'await' + @x }">x</p>\n`)).toEqual([]);
  });
});
