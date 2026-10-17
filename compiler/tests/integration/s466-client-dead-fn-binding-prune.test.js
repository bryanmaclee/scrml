/**
 * S466 (s462-p0-cps fix round 3, merge integration) — a top-level FUNCTION-VALUED
 * binding whose body reaches a stdlib read and that no client code names is dead
 * on the client, and is dropped from the client bundle together with the read it
 * kept alive (emit-client.ts pruneUnusedClientImports, region 3).
 *
 * Before: `const w = (a, b) => verifyPassword(a, b)` used only from a server
 * function was emitted into the client bundle as `const w = async (a, b) => await
 * verifyPassword(a, b)`, which kept `const { verifyPassword } = _scrml_stdlib.auth;`
 * alive — on origin/main 7f2b81418 that shipped the auth chunk to the browser; with
 * auth having no client chunk (§34 E-STDLIB-CLIENT-CHUNK-MISSING, S462) it refused a
 * program the browser never runs that code for.
 *
 * A binding the client DOES name keeps the read, and the gate refuses it (fail closed).
 *
 * S468 (merge of #1435 into s467-await-r10, which enforces SPEC §13.9.6 / dpa-023 F4):
 * a WAITING function is bound only by a `function` declaration, so every `const w =
 * (a, b) => verifyPassword(a, b)` here is now itself refused
 * (E-ASYNC-FN-ESCAPES-AS-VALUE). The prune guarantee is pinned on the legal form —
 * `function w(a, b) { return verifyPassword(a, b) }` — and the const forms pin the
 * refusal (fail closed either way: no auth read reaches the client bundle).
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

const app = (top, handler) => `<program db="./app.db">
\${
  import { verifyPassword } from "scrml:auth"
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

describe("S466 — a dead client fn-valued binding does not keep a server-only stdlib read alive", () => {
  test("used only by server code: compiles, no auth read and no binding in the client bundle", () => {
    const r = compile(app(`function w(a, b) { return verifyPassword(a, b) }`, `@out = f("bob", "x")`));
    expect(r.errors).toEqual([]);
    expect(r.clientJs).not.toContain("_scrml_stdlib.auth");
    expect(r.clientJs).not.toMatch(/\b(const|function) w\b/);
    expect(r.serverJs).toMatch(/\basync function w\(/);
    expect(r.serverJs).toMatch(/!await w\(pass, row\.pw\)/);
  });

  test("a chain of bindings (b calls a calls the stdlib export) is dropped to a fixpoint", () => {
    const r = compile(app(`function a(p, h) { return verifyPassword(p, h) }
  function w(p, h) { return a(p, h) }`, `@out = f("bob", "x")`));
    expect(r.errors).toEqual([]);
    expect(r.clientJs).not.toContain("_scrml_stdlib.auth");
    expect(r.clientJs).not.toMatch(/\b(const|function) (a|w)\b/);
  });

  test("a binding the CLIENT calls keeps the read, and the chunk gate refuses it", () => {
    const r = compile(app(`const w = (a, b) => verifyPassword(a, b)`, `@out = w("x", "y") ? "y" : "n"`));
    expect(r.errors).toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
    expect(r.errors).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
  });

  test("a `function` the client calls is placed on the server: no auth read in the client bundle", () => {
    const r = compile(app(`function w(a, b) { return verifyPassword(a, b) }`, `@out = w("x", "y") ? "y" : "n"`));
    expect(r.errors).toEqual([]);
    expect(r.clientJs).not.toContain("_scrml_stdlib.auth");
    expect(r.serverJs).toMatch(/\basync function w\(/);
  });

  test("a binding that reaches no stdlib read is left as it was (dead or not)", () => {
    const r = compile(app(`function w(a, b) { return verifyPassword(a, b) }
  const dbl = (x) => x * 2`, `@out = f("bob", "x")`));
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toMatch(/\bconst dbl\b/);
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
