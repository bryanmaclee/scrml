/**
 * g-each-body-let-alias-silently-dropped — F2+F3 follow-ups (S340-peter, bryan #508
 * review). The E-EACH-BODY-DECL-UNSUPPORTED guard #508 added inspected only `body[0]`
 * and keyed on a three-name allowlist (let/const/function).
 *
 * F2: a name-binding decl in a NON-first body position (`${ @.id  let nm = @.name }`)
 *     slipped through → the exact silent miscompile #508 closed, one statement over.
 * F3: `lin nm = @.name` (a `lin-decl`) was not in the allowlist → same silent drop.
 *
 * FIX (by construction): scan EVERY body statement; key on the name-binding decl SET
 * {let, const, function, lin}. EXCLUDED: `type-decl` (compile-time-only, no runtime
 * local to dangle — stays clean) and `~`/`tilde-decl` (already fails loud via
 * E-CODEGEN-INVALID-LOGIC).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `each-decl-pos-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    return compileScrml({ inputFiles: [tmpInput], outDir: tmpDir, emitClient: true, emitServer: false });
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function codes(result) {
  return (result.errors ?? []).map((e) => e.code);
}

const HEAD = `<program><rows> = [{id:1,name:"a"}]\n<ul><each in=@rows key=@.id>`;
const TAIL = `<li>x</li></each></ul></program>\n`;

describe("g-each-body-let-alias — decl rejected at ANY position + full name-binding kind set", () => {
  // F2 — non-first position (body[1]).
  test("F2: `let` decl at a NON-first body position is rejected (was silently dropped)", () => {
    const r = compileSource(`${HEAD}\${ @.id\nlet nm = @.name }${TAIL}`);
    expect(codes(r)).toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });

  test("F2: `const` at body[1] is rejected", () => {
    const r = compileSource(`${HEAD}\${ @.id\nconst nm = @.name }${TAIL}`);
    expect(codes(r)).toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });

  test("F2: `function` at body[1] is rejected", () => {
    const r = compileSource(`${HEAD}\${ @.id\nfunction f() { return 1 } }${TAIL}`);
    expect(codes(r)).toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });

  // F3 — lin-decl (new kind), both positions.
  test("F3: `lin` decl at body[0] is rejected (was NOT in the old allowlist)", () => {
    const r = compileSource(`${HEAD}\${ lin nm = @.name }${TAIL}`);
    expect(codes(r)).toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });

  test("F3: `lin` decl at body[1] is rejected", () => {
    const r = compileSource(`${HEAD}\${ @.id\nlin nm = @.name }${TAIL}`);
    expect(codes(r)).toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });

  // §GATE — excluded kinds must NOT be newly rejected.
  test("GATE: `type` alias in an each body stays CLEAN (compile-time-only, no runtime binding)", () => {
    const r = compileSource(`${HEAD}\${ @.id\ntype T = number }${TAIL}`);
    expect(codes(r)).not.toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });

  test("GATE: a valid each body (`as x`, `${x.name}`, `${@.id}`) compiles clean — no over-fire", () => {
    const r = compileSource(`<program><rows> = [{id:1,name:"a"}]\n<ul><each in=@rows key=@.id as x>\${@.id}<li>\${x.name}</li></each></ul></program>\n`);
    expect(codes(r)).not.toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });
});
