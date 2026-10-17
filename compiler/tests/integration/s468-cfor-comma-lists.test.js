/**
 * s468-cfor-comma-lists — ruling S464 cfor-comma "b" (user-voice-scrml.md §S464):
 * "comma lists are legal in a C-style `for` header's init and update parts, on both
 * client and server; the comma operator stays refused in every value position".
 * SPEC §40.8 (the S441 bullet's comma-sequence sub-bullet, S468 sentence).
 *
 * Before (origin/main 5c43c3b8e, executed):
 *   - `for (let i = 0, j = n; i < j; i++, j--) { s = s + j - i }` — E-SCOPE-001 "`j`"
 *     on client AND server: the type-system bound only the FIRST declarator of the
 *     init (a regex over the init text matched `let i`, never `, j`).
 *   - a header with an EMPTY clause (`for (; i < j, j > 0; i++)`) carried no
 *     `cStyleParts`, so its clauses were emitted as raw text: the comma operator in
 *     the CONDITION compiled at exit 0 on both sides (`i < j` silently dropped).
 *
 * Executed: the server function is called over HTTP and its result checked; the
 * client and server `for (…)` headers are compared textually (same lowering).
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const T = 30_000;
const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// The same body is compiled as a client function `c(n)` and a server function `s(n)`.
async function compileBoth(tag, body) {
  const dir = mkdtempSync(join(tmpdir(), `s468-cfor-${tag}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "app.scrml"), `<program>
\${
  <out> = ""
  function c(n) {
    ${body}
  }
  server function s(n) {
    ${body}
  }
  function h() { @out = String(c(5)) }
  function g() { @out = String(s(5)) }
}
<button onclick=h()>c</button>
<button onclick=g()>s</button>
<p>\${@out}</p>
</program>
`);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const sp = join(outDir, "app.server.js");
  const cp = join(outDir, "app.client.js");
  if (errors.length > 0 || !existsSync(sp)) return { errors };
  const serverJs = readFileSync(sp, "utf8");
  const clientJs = readFileSync(cp, "utf8");
  const mod = await import(`file://${sp}?v=${Date.now()}-${Math.random()}`);
  const route = mod.routes.find((r) => /__ri_route_s_\d+$/.test(r.path));
  return { errors, mod, path: route?.path, serverJs, clientJs };
}

async function callS(unit, n) {
  const res = await unit.mod.fetch(new Request(`http://localhost${unit.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify({ n }),
  }));
  return { status: res.status, body: await res.text() };
}

const forHeaders = (js) => [...js.matchAll(/for \(([^)]*;[^)]*;[^)]*)\) \{/g)].map((m) => m[1]);

// name -> [body, expected s(5), expected header]
const ACCEPT = {
  declaratorInitAndStepUpdate: [`let t = 0
    for (let i = 0, j = n; i < j; i++, j--) { t = t + j - i }
    return t`, 9, "let i = 0, j = n; i < j; i++, j--"],
  assignmentInitList: [`let t = 0
    let i = 0
    let j = 0
    for (i = 0, j = n; i < j; i++, j--) { t = t + 1 }
    return t`, 3, "i = 0, j = n; i < j; i++, j--"],
  emptyInitUpdateList: [`let t = 0
    let i = 0
    let j = n
    for (; i < j; i++, j--) { t = t + 1 }
    return t`, 3, "; i < j; i++, j--"],
  threeStepUpdate: [`let t = 0
    let k = 0
    for (let i = 0, j = n; i < j; i++, j--, k = k + 10) { t = t + 1 }
    return t + k`, 33, "let i = 0, j = n; i < j; i++, j--, k = k + 10"],
  declaratorUsesEarlierDeclarator: [`let t = 0
    for (let i = 1, j = i + n; i < j; i = i + 2, j = j - 1) { t = t + j }
    return t`, 11, "let i = 1, j = i + n; i < j; i = i + 2, j = j - 1"],
};

describe("s468 — a C-style `for` header comma list compiles identically on client and server (executed)", () => {
  for (const [name, [body, want, header]] of Object.entries(ACCEPT)) {
    test(name, async () => {
      const u = await compileBoth(name, body);
      expect(u.errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
      const sh = forHeaders(u.serverJs);
      const ch = forHeaders(u.clientJs);
      expect(sh).toContain(header);
      expect(ch).toContain(header);
      expect(await callS(u, 5)).toEqual({ status: 200, body: JSON.stringify(want) });
    }, T);
  }
});

// Every VALUE position still refuses the comma operator, on both sides.
const REFUSE = {
  conditionFullHeader: `let t = 0
    let j = n
    for (let i = 0; i < j, j > 0; i++) { j = j - 1 }
    return t`,
  conditionEmptyInit: `let i = 0
    let j = n
    for (; i < j, j > 0; i++) { j = j - 1 }
    return i`,
  conditionEmptyInitAndUpdate: `let i = 0
    for (; i < n, i < 2;) { i = i + 1 }
    return i`,
  assignmentRhs: `let a = 0
    a = (n, n + 1)
    return a`,
  declarationInitializer: `const a = (n, n + 1)
    return a`,
  argument: `return Math.max((n, 2), 1)`,
  returnValue: `return (n, n + 1)`,
  forDeclaratorValue: `let t = 0
    for (let i = (0, 1); i < n; i++) { t = t + 1 }
    return t`,
  parenthesizedSequenceInUpdate: `let t = 0
    let j = n
    let k = n
    for (let i = 0; i < j; i++, (j--, k--)) { t = t + 1 }
    return t`,
};

describe("s468 — the comma operator in a value position is still refused (client and server)", () => {
  for (const [name, body] of Object.entries(REFUSE)) {
    test(name, async () => {
      const u = await compileBoth(name, body);
      expect(u.errors.map((e) => e.code)).toContain("E-CODEGEN-INVALID-LOGIC");
    }, T);
  }
  // Each side refuses on its own (a client-only and a server-only function).
  for (const side of ["function", "server function"]) {
    test(`condition comma refused in a ${side} alone`, () => {
      const dir = mkdtempSync(join(tmpdir(), "s468-cfor-side-"));
      dirs.push(dir);
      writeFileSync(join(dir, "app.scrml"), `<program>
\${
  <out> = ""
  ${side} f(n) {
    let i = 0
    for (; i < n, i < 2; i++) { }
    return i
  }
  function h() { @out = String(f(5)) }
}
<button onclick=h()>go</button>
<p>\${@out}</p>
</program>
`);
      const r = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: false, gather: true, log: () => {} });
      expect((r.errors ?? []).map((e) => e.code)).toContain("E-CODEGEN-INVALID-LOGIC");
    });
  }
});
