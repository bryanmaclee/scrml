/**
 * issue-165-batch-hoist-across-control-flow.test.js — regression for adopter
 * #165 (pjoliver11): a `const`-bound server call was hoisted INTO the
 * Promise.all binding-batch ABOVE an intervening guard that `return`s.
 *
 * Root cause: `compiler/src/codegen/scheduling.ts:scheduleStatements`. The
 * independent-statement grouping loop, on encountering a statement-shape
 * statement (the `if (...) return` guard), used `continue` — intending only
 * "don't put the if-stmt ITSELF into the Promise.all array" (S138 Bug 55).
 * But `continue` kept scanning FORWARD, so a later `const r = bump()` decl
 * jumped OVER the guard and joined the batch seeded before it. The batch
 * emits at the seed's position → the server call ran unconditionally, above
 * the guard that was supposed to prevent it:
 *
 *   const [one, two, r] = await Promise.all([1, 2, _scrml_fetch_bump("A")]);
 *   if ((one + two === 3)) { return; }        // <- guard, now inert
 *   _scrml_reactive_set("log", "..." + r);
 *
 * In real adopter code the guard is a `window.confirm()` in front of a
 * destructive write, so the row was deleted and THEN the user was asked — a
 * silent destructive-write reorder, clean build, no warning.
 *
 * Fix: a statement-shape (control-flow) statement is a HARD group boundary —
 * `break`, not `continue`. Reordering any statement across a control-transfer
 * point is unsound, so nothing after a guard may be hoisted into a batch
 * seeded before it.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as acornParse } from "acorn";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/issue-165");

beforeAll(() => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compileSource(name, src) {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  const inputPath = join(FIXTURE_DIR, name);
  writeFileSync(inputPath, src);
  const outDir = join(FIXTURE_DIR, "dist-" + name.replace(/\W/g, ""));
  compileScrml({ inputFiles: [inputPath], outputDir: outDir, write: true, log: () => {} });
  let clientJs = "";
  (function find(dir) {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) find(p);
      else if (ent.name.endsWith(".client.js")) clientJs = readFileSync(p, "utf-8");
    }
  })(outDir);
  return clientJs;
}

/** Slice one `async function _scrml_<fnName>_<n>(...) { ... }` body out of the emit. */
function fnBody(code, fnName) {
  const m = new RegExp(`async function _scrml_${fnName}_\\d+\\(`).exec(code);
  if (!m) return "";
  // From the fn header, walk to the balanced closing brace.
  const start = code.indexOf("{", m.index);
  let depth = 0;
  for (let k = start; k < code.length; k++) {
    if (code[k] === "{") depth++;
    else if (code[k] === "}") { depth--; if (depth === 0) return code.slice(start, k + 1); }
  }
  return code.slice(start);
}

const REPRO = `<program>
\${
  function bump(tag) {
    ?{\`INSERT INTO hits (tag) VALUES (\${tag})\`}.run()
    const n = ?{\`SELECT count(*) AS c FROM hits WHERE tag = \${tag}\`}.get()
    return n.c
  }

  function caseA() {
    const one = 1
    const two = 2
    if (one + two == 3) return
    const r = bump("A")
    @log = "caseA reached the call: " + r
  }

  function caseB() {
    if (1 + 2 == 3) return
    const r = bump("B")
    @log = "caseB reached the call: " + r
  }

  function caseC() {
    let one = 1
    let two = 2
    one = one + 0
    two = two + 0
    if (one + two == 3) return
    const r = bump("C")
    @log = "caseC reached the call: " + r
  }

  @log = ""
}
<div>\${@log}</div>
<button onclick=\${caseA()}>a</button>
<button onclick=\${caseB()}>b</button>
<button onclick=\${caseC()}>c</button>
</program>
`;

describe("#165 §1: server call is NOT hoisted above a returning guard", () => {
  const code = compileSource("repro.scrml", REPRO);

  test("emit is syntactically valid JS", () => {
    expect(() => acornParse(code, { ecmaVersion: 2024, sourceType: "module", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })).not.toThrow();
  });

  test("caseA — the guard precedes the server call (the bug: it did not)", () => {
    const fn = fnBody(code, "caseA");
    expect(fn).toBeTruthy();
    const guardIdx = fn.indexOf("if (");
    const callIdx = fn.indexOf("_scrml_fetch_bump");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(-1);
    // The whole bug: callIdx < guardIdx (call hoisted above the guard).
    expect(callIdx).toBeGreaterThan(guardIdx);
  });

  test("caseA — the server call is NOT a Promise.all batch member", () => {
    const fn = fnBody(code, "caseA");
    // No Promise.all array entry contains the fetch stub (`]` can't appear
    // inside the entry list, so `[^\\]]*` stays within the brackets).
    expect(fn).not.toMatch(/Promise\.all\(\[[^\]]*_scrml_fetch_bump/);
  });

  test("caseB / caseC controls — guard still precedes the call", () => {
    for (const name of ["caseB", "caseC"]) {
      const fn = fnBody(code, name);
      const guardIdx = fn.indexOf("if (");
      const callIdx = fn.indexOf("_scrml_fetch_bump");
      expect(callIdx).toBeGreaterThan(guardIdx);
    }
  });
});

describe("#165 §2: no regression — consecutive server calls with no control flow still batch", () => {
  test("two independent server-call decls coalesce into one Promise.all", () => {
    const src = `<program>
\${
  function bump(tag) {
    ?{\`INSERT INTO hits (tag) VALUES (\${tag})\`}.run()
    const n = ?{\`SELECT count(*) AS c FROM hits WHERE tag = \${tag}\`}.get()
    return n.c
  }
  function caseD() {
    const a = bump("D1")
    const b = bump("D2")
    @log = "D: " + a + b
  }
  @log = ""
}
<div>\${@log}</div>
<button onclick=\${caseD()}>d</button>
</program>
`;
    const code = compileSource("batch.scrml", src);
    const fn = fnBody(code, "caseD");
    expect(fn).toMatch(/const \[a, b\] = await Promise\.all\(\[/);
    expect(fn).toMatch(/_scrml_fetch_bump_\d+\("D1"\)/);
    expect(fn).toMatch(/_scrml_fetch_bump_\d+\("D2"\)/);
  });
});
