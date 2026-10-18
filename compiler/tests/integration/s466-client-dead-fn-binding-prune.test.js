/**
 * S466 (s462-p0-cps fix round 3, merge integration) — a top-level FUNCTION-VALUED
 * binding whose body reaches a stdlib read and that no client code names is dead
 * on the client, and is dropped from the client bundle together with the read it
 * kept alive (emit-client.ts pruneUnusedClientImports, region 3).
 *
 * Before: `const w = (a, b) => verifyPassword(a, b)` used only from a server
 * function was emitted into the client bundle, which kept
 * `const { verifyPassword } = _scrml_stdlib.auth;` alive — on origin/main 7f2b81418
 * that shipped the auth chunk to the browser; with auth having no client chunk (§34
 * E-STDLIB-CLIENT-CHUNK-MISSING, S462) it refused a program the browser never runs
 * that code for.
 *
 * A binding the client DOES name keeps the read, and the gate refuses it (fail closed).
 *
 * S468 (merge of #1435 into s467-await-r10, which enforces SPEC §13.9.6 / dpa-023 F4):
 * a WAITING function is bound only by a `function` declaration, so a `const w = (a, b)
 * => verifyPassword(a, b)` is now itself refused (E-ASYNC-FN-ESCAPES-AS-VALUE). A
 * `function` declaration never reaches region 3 (it is placed on the server, not
 * emitted as a client `const`), so the prune guarantee is pinned on the shape that
 * still reaches it: a const-bound SYNCHRONOUS function value over a server-only stdlib
 * export (`const w = (a, b) => generatePassword(8) == a`, and its chain form). Bite
 * proven by mutation: with region 3 disabled (`if (false && fnNames.size > 0 …)`)
 * the first three tests fail. The `function w` and waiting-const forms are pinned
 * separately (placed on the server / refused — fail closed either way).
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function compile(src) {
  const d = mkdtempSync(join(tmpdir(), "s466-fnbind-"));
  dirs.push(d);
  const file = join(d, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, outputDir: join(d, "dist"), log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  return { errors, clientJs: result.outputs.get(file)?.clientJs ?? "", serverJs: result.outputs.get(file)?.serverJs ?? "" };
}

const app = (top, handler, imp = "verifyPassword") => `<program db="./app.db">
\${
  import { ${imp} } from "scrml:auth"
  ${top}
  function f(name: string, pass: string) {
    const row = ?{\`SELECT name, pw FROM users WHERE name = \${name}\`}.get()
    if (!w(pass, row.pw)) { return "REJECTED" }
    return "WELCOME"
  }
}
<out> = ""
<button onclick={ ${handler} }>f</button>
<p>\${@out}</p>
</program>
`;
// generatePassword: a SYNCHRONOUS export of scrml:auth (server-only — no client chunk).
const GEN = "generatePassword";

describe("S466 — a dead client fn-valued binding does not keep a server-only stdlib read alive", () => {
  test("used only by server code: compiles, no auth read and no binding in the client bundle", () => {
    const r = compile(app(`const w = (a, b) => generatePassword(8) == a`, `@out = f("bob", "x")`, GEN));
    expect(r.errors).toEqual([]);
    expect(r.clientJs).not.toContain("_scrml_stdlib.auth");
    expect(r.clientJs).not.toMatch(/\b(const|function) w\b/);
    expect(r.serverJs).toMatch(/\bconst w\b/);
  });

  test("a chain of bindings (w calls a calls the stdlib export) is dropped to a fixpoint", () => {
    const r = compile(app(`const a = (p) => generatePassword(8) == p
  const w = (p, h) => a(p)`, `@out = f("bob", "x")`, GEN));
    expect(r.errors).toEqual([]);
    expect(r.clientJs).not.toContain("_scrml_stdlib.auth");
    expect(r.clientJs).not.toMatch(/\b(const|function) (a|w)\b/);
  });

  test("a binding that reaches no stdlib read is left as it was (dead or not)", () => {
    const r = compile(app(`const w = (a, b) => generatePassword(8) == a
  const dbl = (x) => x * 2`, `@out = f("bob", "x")`, GEN));
    expect(r.errors).toEqual([]);
    expect(r.clientJs).not.toContain("_scrml_stdlib.auth");
    expect(r.clientJs).not.toMatch(/\bconst w\b/);
    expect(r.clientJs).toMatch(/\bconst dbl\b/);
  });

  test("a binding the CLIENT calls keeps the read, and the chunk gate refuses it", () => {
    const r = compile(app(`const w = (a, b) => generatePassword(8) == a`, `@out = w("x", "y") ? "y" : "n"`, GEN));
    expect(r.errors).toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
    const w = compile(app(`const w = (a, b) => verifyPassword(a, b)`, `@out = w("x", "y") ? "y" : "n"`));
    expect(w.errors).toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
    expect(w.errors).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
  });

  test("a `function` w (server-only or client-called) is placed on the server: no auth read in the client bundle", () => {
    for (const handler of [`@out = f("bob", "x")`, `@out = w("x", "y") ? "y" : "n"`]) {
      const r = compile(app(`function w(a, b) { return verifyPassword(a, b) }`, handler));
      expect(r.errors).toEqual([]);
      expect(r.clientJs).not.toContain("_scrml_stdlib.auth");
      expect(r.clientJs).not.toMatch(/\b(const|function) w\b/);
      expect(r.serverJs).toMatch(/\basync function w\(/);
    }
  });

  test("S468 — the const-bound waiting forms are refused (SPEC §13.9.6), never shipped", () => {
    for (const top of [
      `const w = (a, b) => verifyPassword(a, b)`,
      `const a = (p, h) => verifyPassword(p, h)
  const w = (p, h) => a(p, h)`,
    ]) {
      const r = compile(app(top, `@out = f("bob", "x")`));
      expect(r.errors).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
    }
  });
});
