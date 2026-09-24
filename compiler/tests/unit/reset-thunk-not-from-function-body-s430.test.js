/**
 * reset-thunk-not-from-function-body-s430.test.js — s430-emit-state-leak (§6.8).
 *
 * SPEC §6.8.1: "If `default=` is absent, `reset(@cell)` SHALL re-evaluate the
 * init expression at reset time and write the result to the cell." The init
 * expression is the cell's DECLARATION's. A write inside a function is a
 * reassignment and must never register a reset init-thunk: the runtime's init
 * registry is last-write-wins, so a thunk registered when the function runs
 * would make `reset(@cell)` re-run the reassignment instead of restoring the
 * declared initial.
 *
 * A guarded reassignment `@cell = f() !{ … }` dropped the function context
 * (`insideFunctionBody`): guarded-expr lowered its statement with no opts.
 * For a STRUCTURAL cell (`<cell> = …`) the in-function thunk was masked or not
 * depending on what the process had compiled before (the leaked module-level
 * structural-decl set). For an IMPLICIT cell (`@cell = …`) the in-function write
 * also consumed the file's first-write slot, so the top-level declaration LOST
 * its thunk.
 *
 * Every case below asserts: exactly ONE init thunk for the cell, carrying the
 * declared initial, and none emitted inside a function body.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileClient(source, suffix = "s430-reset-thunk") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false });
    const out = [...result.outputs.values()][0] ?? {};
    return { errors: (result.errors ?? []).filter((e) => e.severity !== "warning"), clientJs: out.clientJs ?? "" };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** All `init_set("<cell>", () => …)` lines (namespace-prefix agnostic). */
const initSets = (js, cell) =>
  js.split("\n").filter((l) => new RegExp(`init_set\\("${cell}"`).test(l)).map((l) => l.trim());

/** Body text of `function <prefix>…(…) { … }` (brace-balanced). */
function fnBody(js, namePart) {
  const m = new RegExp(`function _scrml_${namePart}_\\d+\\([^)]*\\) \\{`).exec(js);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < js.length; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}" && --depth === 0) return js.slice(m.index, i + 1);
  }
  return null;
}

const FAILABLE_PRELUDE = `
    type LoadError:enum = {
        NotFound(reason: string)
        Empty
    }

    function risky()! -> LoadError {
        fail LoadError.NotFound("was-zero")
    }
`;

const guardedSrc = (decl) => `\${${FAILABLE_PRELUDE}
    ${decl}

    function go() {
        @result = risky() !{
            | ::NotFound(reason) :> "recovered: " + reason
            | ::Empty            :> "was-empty"
        }
    }
}
<program>
    <button id="go" onclick=go()>Go</>
    <button id="r" onclick=reset(@result)>Reset</>
    <p id="out">\${@result}</p>
</program>
`;

describe("§6.8 — a write inside a function never registers a reset init-thunk", () => {
  for (const [label, decl] of [["structural <result>", `<result> = "init"`], ["implicit @result", `@result = "init"`]]) {
    test(`guarded reassignment \`@result = f() !{…}\` in a function — ${label}`, () => {
      const { errors, clientJs } = compileClient(guardedSrc(decl));
      expect(errors).toEqual([]);
      expect(initSets(clientJs, "result")).toEqual([`_scrml_cs_init_set("result", () => "init");`]);
      const body = fnBody(clientJs, "go");
      expect(body).not.toBeNull();
      expect(body).not.toContain("init_set");
    });
  }
});
