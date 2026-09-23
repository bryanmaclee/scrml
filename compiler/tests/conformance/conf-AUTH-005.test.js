/**
 * CONF-AUTH-005 | §34 / §52.11
 *
 * Catalog: E-AUTH-005 — `server @var` declared inside a client-only context
 * (no server context anywhere in the application).
 * Normative: SPEC §52.11. Server-authoritative variables require a server
 * context.
 *
 * Firing site: `type-system.ts`, the `state-decl` case of `annotateNodes`.
 * Triggered by a `state-decl` whose `isServer` flag is true when the
 * COMPILATION UNIT has no server context — `compilationUnitHasServerContext`,
 * computed once per `runTS` over `input.files`.
 *
 * ⚑ THE UNIT IS THE APPLICATION, NOT THE FILE, AND THE DOCSTRING USED TO SAY
 * OTHERWISE. It named `hasProgramDbAttr(fileAST)` — a file-local predicate that
 * §40.8 makes unsatisfiable for every non-entry file, since a `<program>` SHALL
 * NOT appear in one. The three cases below are all SINGLE-file, so their verdicts
 * are unchanged by the widening (the unit IS the file); the multi-file behaviour
 * this file cannot express lives in
 * `compiler/tests/unit/e-auth-005-application-scope.test.js`.
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    return { errors: result.errors ?? [] };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("CONF-AUTH-005: server @var in client-only context", () => {
  test("POS: `server @count = 0` in file with no <program db=...> fires E-AUTH-005", () => {
    const src = `\${
    server @count = 0
}
<p>x</>`;
    const { errors } = compile(src, "auth005-pos");
    expect(errors.some(e => e.code === "E-AUTH-005")).toBe(true);
  });

  test("NEG: `server @count = load()` in a file with <program db=...> does NOT fire E-AUTH-005", () => {
    const src = `<program db="postgres"></>
\${
    server @count = loadCount()
}
<p>x</>`;
    const { errors } = compile(src, "auth005-neg");
    expect(errors.some(e => e.code === "E-AUTH-005")).toBe(false);
  });

  test("NEG: a `<page>` whose own `<db src=>` supplies the server context does NOT fire E-AUTH-005", () => {
    // conformance/cases/auth/auth-005-db-context-neg. The file carries NO
    // `<program>` — §40.8 forbids one in a non-entry file — so the retired
    // `<program db=>`-only predicate refused this shape, which is the canonical
    // multi-file page form (`examples/23-trucking-dispatch` writes exactly it).
    // `<db src=>` is Form 2 of `collectDbScopes`: a database codegen connects.
    const src = `<page>
  <db src="./notes.db" tables="notes">
    \${
      <notes server> = 0

      function seedNotes() {
        return ?{\`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)\`}.run()
      }
    }
  </db>
  <h1>Notes</h1>
  <p>\${@notes}</p>
  <button onclick=\${seedNotes()}>Seed</button>
</page>`;
    const { errors } = compile(src, "auth005-dbctx-neg");
    expect(errors.some(e => e.code === "E-AUTH-005")).toBe(false);
  });
});
