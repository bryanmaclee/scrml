/**
 * markup-statement-contexts-s464 — SPEC §17.6.10.1, one row per logic-body context.
 *
 * §17.6.10.1: statement-position markup "renders only as the single element of an `if` /
 * `given` branch (§17.6.10), or named by a `lift` (§10.1)"; anywhere else it "SHALL be a
 * compile error, E-MARKUP-STATEMENT-NOT-RENDERED". The S239 review of a0d464f1f (S464 fix
 * round 1) found contexts the first build missed — `<each>` rows, engine state-children
 * and `effect=`, a bare nested block, an arrow block body, an element after a postfix
 * `++` / a regex — and one where a bare `${ <p/> }` RENDERED (a `<match>` markup arm)
 * while the same text is an error elsewhere. Each context below has a REFUSED row and a
 * RENDERS row (executed in happy-dom), so the rule is checked where it is lowered.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const CODE = "E-MARKUP-STATEMENT-NOT-RENDERED";
const tmpRoot = resolve(tmpdir(), "scrml-markup-statement-contexts-s464");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  if (errors.length > 0) return { codes: errors.map((e) => e.code), errors };
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  new Function("window", "document", `${runtimeJs}\n` + captureInsideChunkScope(clientJs, ""))(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { codes: [], errors: [] };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const hostText = () => (document.querySelector("#host")?.textContent ?? "").replace(/\s+/g, " ").trim();

const D = "$" + "{";
const prog = (decls, body) => `<program>\n${decls}\n<div id="host">${body}</div>\n</program>\n`;
const ENUM = `type M:enum = { A, B }\n<m>: M = .A\n<n> = 3\n<rows> = [{ id: 1 }, { id: 2 }]`;
const ENG = `type S:enum = { A, B }\n<n> = 3\n<note> = ""`;
const USER = `type U:struct = { name: string }\n<u>: U | not = { name: "bob" }`;

// [context, refused source, renders source, expected rendered text]
const ROWS = [
  ["top-level `${}`", [ENUM, `${D} <p>bare</p> }`], [ENUM, `${D} if (@n > 1) { <p>one</p> } }`], "one"],
  ["`given` arm", [USER, `${D} given @u :> { <p>a</p>\n<p>b</p> } }`], [USER, `${D} given @u :> { <p>${D}@u.name}</p> } }`], "bob"],
  ["`for` loop body", [ENUM, `${D} for (const r of @rows) { <li>row</li> } }`], [ENUM, `${D} for (const r of @rows) { lift <li>row</li> } }`], "rowrow"],
  ["`while` loop body", [ENUM, `${D} let i = 0\nwhile (i < 1) { i = i + 1\n<p>w</p> } }`], [ENUM, `${D} let i = 0\nwhile (i < 1) { i = i + 1\nlift <p>w</p> } }`], "w"],
  ["bare nested block", [ENUM, `${D} { <p>blk</p> } }`], [ENUM, `${D} if (@n > 1) { lift <p>blk</p> } }`], "blk"],
  ["logic `match` arm", [ENUM, `${D} match @m { .A :> { <p>a</p> } .B :> { <p>b</p> } } }`], [ENUM, `${D} match @m { .A :> { lift <p>a</p> } .B :> { lift <p>b</p> } } }`], "a"],
  ["`<each>` row", [ENUM, `<ul><each in=@rows key=@.id><li>${D} <b>bare</b> }</li></each></ul>`], [ENUM, `<ul><each in=@rows key=@.id><li>${D} if (@.id > 0) { <b>one</b> } }</li></each></ul>`], "oneone"],
  ["`<each>` row, two elements in an arm", [ENUM, `<ul><each in=@rows key=@.id><li>${D} if (@.id > 0) { <b>a</b>\n<b>b</b> } }</li></each></ul>`], [ENUM, `<ul><each in=@rows key=@.id><li>${D} if (@.id > 0) { lift <b>a</b>\nlift <b>b</b> } }</li></each></ul>`], "abab"],
  ["`<match>` markup arm", [ENUM, `<match for=M on=@m>\n<A><div>${D} <p>bare</p> }</div></>\n<B><p>b</p></>\n</>`], [ENUM, `<match for=M on=@m>\n<A><div>${D} if (@n > 1) { <p>x</p> } }</div></>\n<B><p>b</p></>\n</>`], "x"],
  ["engine state-child", [ENG, `<engine for=S initial=.A>\n<A rule=.B><div>${D} <p>bare</p> }</div></A>\n<B rule=.A><p>b</p></B>\n</engine>`], [ENG, `<engine for=S initial=.A>\n<A rule=.B><div>${D} if (@n > 1) { <p>x</p> } }</div></A>\n<B rule=.A><p>b</p></B>\n</engine>`], "x"],
  ["engine state-child, two elements in an arm", [ENG, `<engine for=S initial=.A>\n<A rule=.B><div>${D} if (@n > 0) { <p>x</p>\n<p>y</p> } }</div></A>\n<B rule=.A><p>b</p></B>\n</engine>`], [ENG, `<engine for=S initial=.A>\n<A rule=.B><div>${D} if (@n > 0) { lift <p>x</p>\nlift <p>y</p> } }</div></A>\n<B rule=.A><p>b</p></B>\n</engine>`], "xy"],
  ["engine `effect=`", [ENG, `<engine for=S initial=.A effect=${D} @note = "x"\n<p>eff</p> }>\n<A rule=.B><p>a ${D}@note}</p></A>\n<B rule=.A><p>b</p></B>\n</engine>`], [ENG, `<engine for=S initial=.A effect=${D} @note = "x" }>\n<A rule=.B><p>a ${D}@note}</p></A>\n<B rule=.A><p>b</p></B>\n</engine>`], "a x"],
  ["component body", [ENUM + `\nconst Card = <div class="c">${D} <b>card</b> }</div>`, `<Card/>`], [ENUM + `\nconst Card = <div class="c">${D} if (@n > 1) { <b>card</b> } }</div>`, `<Card/>`], "card"],
  ["`function` body", [ENUM, `${D} function f() { <p>infn</p>\nreturn 1 } }<p>${D}f()}</p>`], [ENUM, `${D} function mk() { return <p>fn</p> } }<p>${D}mk()}</p>`], "fn"],
  ["`server function` body", [ENUM, `${D} server function s() { <p>srv</p>\nreturn 1 } }<button onclick=s()>x</button>`], null, null],
  ["arrow function block body", [ENUM, `${D} const g = () => { <p>arrow</p> } }<button onclick=g()>x</button>`], [ENUM, `${D} const g = () => <p>arrow</p> }<p>${D}g()}</p>`], "arrow"], // (a markup value RETURNED from an arrow block body is E-CODEGEN-INVALID-LOGIC on base too — filed)
  ["`defer` in a function", [ENUM, `${D} function f() { defer { <p>def</p> }\nreturn 1 } }<p>${D}f()}</p>`], null, null],
];

describe("§17.6.10.1 — every logic-body context: refused, or renders (S464 fix round 1)", () => {
  for (const [ctx, bad, good, want] of ROWS) {
    test(`${ctx}: unrendered markup is refused`, () => {
      const { codes } = compileAndMount(prog(...bad), "bad");
      expect(codes).toContain(CODE);
    });
    if (good) {
      test(`${ctx}: the single-element arm / lift / returned value renders`, async () => {
        const { codes } = compileAndMount(prog(...good), "good");
        expect(codes).toEqual([]);
        await flush();
        expect(hostText().replace(/\s+/g, "")).toContain(want.replace(/\s+/g, ""));
      });
    }
  }
});

describe("§17.6.10.1 — the message names the fix that works in the context (r1 #8)", () => {
  const messageOf = (decls, body) => compileAndMount(prog(decls, body), "msg").errors.find((e) => e.code === CODE)?.message ?? "";
  test("in a `${}` logic body: `lift`", () => {
    const m = messageOf(ENUM, `${D} <section>x</section> }`);
    expect(m).toContain("this markup is in statement position and is not rendered — write `lift <section>…</section>`");
  });
  test("in a `function` body: return it and render the call (lift there is E-SYNTAX-002)", () => {
    const m = messageOf(ENUM, `${D} function f() { <b>x</b>\nreturn 1 } }<p>${D}f()}</p>`);
    expect(m).toContain("this markup is in statement position and is not rendered");
    expect(m).toContain("`return <b>…</b>`");
    expect(m).not.toContain("write `lift");
  });
  test("an element a function-body statement read in as code: return it", () => {
    const m = messageOf(ENUM, `${D} function f() { let a = 1\na++\n<b>q</b>\nreturn a } }<p>${D}f()}</p>`);
    expect(m).toContain("`return <b>…</b>`");
  });
  test("in an `fn` body `lift` is valid (§48.5), so the `lift` fix stands", () => {
    const m = messageOf(ENUM, `${D} fn mk() { <b>x</b>\nreturn ~ } }`);
    expect(m).toContain("write `lift <b>…</b>`");
  });
});
