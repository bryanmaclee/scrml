/**
 * is-given-member-is-s462.test.js — S462 fix round F1.
 *
 * The S462 `is given` continuation (ast-builder.js `givenContinuesIsOperator`)
 * keeps `given` in an expression only when the token before it is the `is`
 * INFIX operator. A member named `is` (`o.is`, `o?.is`) followed on the next
 * line by a `given o :> { … }` guard is a member read and then a guard
 * statement — the first cut of S462 fused the two and silently dropped the guard
 * (exit 0, no diagnostic). Each shape below must emit the guard.
 *
 * FULL-PIPELINE (compileScrml).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const RUN_DIR = join(tmpdir(), `scrml-is-given-member-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
function compileSrc(src) {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(join(RUN_DIR, "dist"), { recursive: true });
  const file = join(RUN_DIR, "h.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], outputDir: join(RUN_DIR, "dist"), log: () => {} });
  const p = join(RUN_DIR, "dist", "h.client.js");
  const clientJs = existsSync(p) ? readFileSync(p, "utf8") : "";
  rmSync(RUN_DIR, { recursive: true, force: true });
  return { result, clientJs };
}
const D = "$";
const prog = (body) => [
  "<program>",
  "<n>: number = 0",
  `${D}{`,
  "    function f(o) {",
  ...body.map((l) => "        " + l),
  "    }",
  "}",
  `<p onclick=f({is: 1})>${D}{@n}</p>`,
  "</program>",
  "",
].join("\n");
const GUARD = "if (o !== null && o !== undefined) {";

describe("S462 F1 — a member named `is` before a `given` guard line", () => {
  const cases = {
    "`@n = o.is` then a guard": ["@n = o.is", "given o :> { @n = 5 }"],
    "`const k = o.is` then a guard on k": ["const k = o.is", "given k :> { @n = 5 }"],
    "`q = o.is` (a local) then a guard": ["let q = 0", "q = o.is", "given o :> { @n = q }"],
    "`@n = o?.is` then a guard": ["@n = o?.is", "given o :> { @n = 5 }"],
    "an object key `is` on the line before a guard": ["const z = { is: 1 }", "given o :> { @n = z.is }"],
  };
  for (const [name, body] of Object.entries(cases)) {
    test(name, () => {
      const { result, clientJs } = compileSrc(prog(body));
      expect((result.errors ?? []).map((e) => e.code)).toEqual([]);
      const guardVar = body.some((l) => l.startsWith("given k")) ? "k" : "o";
      expect(clientJs).toContain(`if (${guardVar} !== null && ${guardVar} !== undefined) {`);
    });
  }

  test("the operator form still continues: `@n = o is given` on one line is one expression", () => {
    const { result, clientJs } = compileSrc(prog(["const ok = o is given", "@n = ok ? 1 : 0"]));
    expect((result.errors ?? []).map((e) => e.code)).toEqual([]);
    expect(clientJs).not.toContain(GUARD);
    expect(clientJs).toContain("!== null");
  });
});
