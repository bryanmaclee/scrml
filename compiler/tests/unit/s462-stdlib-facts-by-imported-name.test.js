/**
 * S462 P0 — stdlib facts are keyed by the name the module EXPORTS, never by the
 * local alias an importer binds it to.
 *
 * `import { verifyPassword as vp } from "scrml:auth"` binds `vp` locally to the
 * export `verifyPassword`. The §13.2 auto-await classifier looked `vp` up in
 * `scrml:auth`'s export table, found nothing, classified the call sync, and left
 * it un-awaited: a truthy Promise accepted every password (executed proof in
 * integration/s462-p0-unawaited-async-stdlib.test.js). This file pins the
 * mechanism at each layer, plus the re-export paths the same audit covered:
 *
 *   §1 buildCalleeImportMap carries local → imported names; the classifier
 *      helper resolves an alias through them.
 *   §2 every server emit shape awaits an aliased async stdlib callee; the alias
 *      used as a value is E-ASYNC-FN-ESCAPES-AS-VALUE (§13.2); a SYNC
 *      aliased stdlib call is still not awaited.
 *   §3 a client function calling an aliased async stdlib export is async-colored.
 *   §4 a local `.scrml` module that re-exports a stdlib async function
 *      (`export { verifyPassword as vp } from "scrml:auth"`) carries its
 *      async-ness: the importer's call is awaited. A USER-declared async export
 *      re-exported the same way still does not classify (Q5 carve-out).
 *   §5 E-IMPORT-004 judges the imported name, not the alias.
 *   §6 a RENAMED local re-export of a type / function (`export { Color as Hue,
 *      paint as tint } from "./errs.scrml"`) resolves through the source-side
 *      name (it used to chase `Hue` / `tint` in errs.scrml and find nothing).
 *   §7 (F1) an optional call (`f?.(…)`) is awaited like `f(…)`, once.
 *
 * SPEC §13.2: "An async-colored function is one the compiler emits async: a
 * server function, a Promise-returning standard-library function, or any
 * function that (transitively) calls one. … It MAY be called directly (the
 * compiler awaits the call)". §21.4: re-export follows ES `export { name } from`.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { buildCalleeImportMap } from "../../src/codegen/scheduling.ts";
import { isPromiseReturningImportedCallee, importedNameOf, resolveModulePath } from "../../src/module-resolver.js";

const TMP = mkdtempSync(join(tmpdir(), "s462-facts-by-imported-name-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function compile(files) {
  const dir = join(TMP, `c${seq++}`);
  const paths = [];
  for (const [name, src] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(p, src);
    paths.push(p);
  }
  const result = compileScrml({ inputFiles: paths, write: false, log: () => {} });
  const out = (name) => result.outputs.get(join(dir, name)) ?? {};
  const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.code !== "E-PA-002");
  return { result, out, errors, codes: errors.map((e) => e.code) };
}

const serverApp = (imports, body) => `<program auth="none" db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)\`}
  </schema>
  <db src="./app.db" tables="users">
    \${
      ${imports}
      function login(name, pass) {
        const row = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        if (row is not) { return "NOUSER" }
${body}
      }
    }
  </db>
  <out> = ""
  <button onclick={ @out = login("ada", "x") !{ .Transport(_) :> { return } } }>go</button>
</program>
`;

describe("§1 the callee import map carries the imported name", () => {
  test("an `as` alias maps to the export name; an unaliased import maps to itself", () => {
    const filePath = join(TMP, "m1.scrml");
    const map = buildCalleeImportMap({
      filePath,
      imports: [{
        kind: "import-decl", source: "scrml:auth", names: ["verifyPassword", "hashPassword"],
        specifiers: [{ imported: "verifyPassword", local: "vp" }, { imported: "hashPassword", local: "hashPassword" }],
      }],
    });
    expect(map.get("vp")).toBe(resolveModulePath("scrml:auth", filePath));
    expect(importedNameOf("vp", map)).toBe("verifyPassword");
    expect(importedNameOf("hashPassword", map)).toBe("hashPassword");
    expect(map.has("verifyPassword")).toBe(false);
  });

  test("the classifier resolves the alias through the imported name", () => {
    const filePath = join(TMP, "m2.scrml");
    const abs = resolveModulePath("scrml:auth", filePath);
    const map = buildCalleeImportMap({
      filePath,
      imports: [{ kind: "import-decl", source: "scrml:auth", names: ["verifyPassword"], specifiers: [{ imported: "verifyPassword", local: "vp" }] }],
    });
    const registry = new Map([[abs, new Map([["verifyPassword", { kind: "function", category: "function", isComponent: false, isAsync: true }]])]]);
    expect(isPromiseReturningImportedCallee("vp", map, registry)).toBe(true);
    expect(isPromiseReturningImportedCallee("verifyPassword", map, registry)).toBe(false); // not bound in this file
  });
});

describe("§2 server emit awaits an aliased async stdlib callee", () => {
  test("bound const, inline predicate, nested, SQL interpolation", () => {
    const { out, codes } = compile({
      "app.scrml": serverApp(
        `import { verifyPassword as vp, hashPassword as hp } from "scrml:auth"`,
        `        const ok = vp(pass, row.pw)
        if (!ok) { return "REJECTED" }
        if (!vp(pass, row.pw)) { return "REJECTED" }
        const s = String(vp(pass, row.pw))
        ?{\`UPDATE users SET pw = \${hp(pass)} WHERE name = \${name}\`}.run()
        return "ACCEPTED" + s`,
      ),
    });
    expect(codes).toEqual([]);
    const js = out("app.scrml").serverJs ?? "";
    expect(js).toMatch(/const ok = await vp\(pass, row\.pw\)/);
    expect(js).toMatch(/if \(!_scrml_assert_settled\(await vp\(/);
    expect(js).toMatch(/String\(await vp\(/);
    expect(js).toMatch(/await hp\(pass\)/);
    expect(js).not.toMatch(/[^t] vp\(pass/); // never bare
    expect(js).not.toMatch(/\bawait\s+await\b/);
  });

  test("an aliased http get is awaited", () => {
    const { out, codes } = compile({
      "app.scrml": serverApp(
        `import { get as httpGet } from "scrml:http"`,
        `        const r = httpGet(pass)
        return r.status`,
      ),
    });
    expect(codes).toEqual([]);
    expect(out("app.scrml").serverJs ?? "").toMatch(/const r = await httpGet\(pass\)/);
  });

  test("an aliased async import used as a VALUE is E-ASYNC-FN-ESCAPES-AS-VALUE (base: compiled clean, the call through it unawaited)", () => {
    const { codes } = compile({
      "app.scrml": serverApp(
        `import { verifyPassword as vp } from "scrml:auth"`,
        `        const f = vp
        const ok = f(pass, row.pw)
        if (!ok) { return "REJECTED" }
        return "ACCEPTED"`,
      ),
    });
    expect(codes).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
  });

  test("an aliased SYNC stdlib call is not awaited", () => {
    const { out, codes } = compile({
      "app.scrml": serverApp(
        `import { generateToken as tok } from "scrml:crypto"`,
        `        const t = tok(16)
        return t`,
      ),
    });
    expect(codes).toEqual([]);
    const js = out("app.scrml").serverJs ?? "";
    expect(js).toMatch(/const t = tok\(16\)/);
    expect(js).not.toMatch(/await tok\(/);
  });
});

describe("§3 a client function calling an aliased async stdlib export is async-colored", () => {
  test("`sleep as nap` (scrml:time) colors the caller and awaits the call", () => {
    const { out, codes } = compile({
      "app.scrml": `<program>
  \${
    import { sleep as nap } from "scrml:time"
    function wait() {
      nap(5)
      @done = true
    }
  }
  <done> = false
  <button onclick=wait()>go</button>
</program>
`,
    });
    expect(codes).toEqual([]);
    const js = out("app.scrml").clientJs ?? "";
    expect(js).toMatch(/async function [\w$]*wait[\w$]*\(/);
    expect(js).toMatch(/await nap\(5\)/);
  });
});

describe("§4 a local re-export of a stdlib async function stays async", () => {
  test("`export { verifyPassword as vp } from \"scrml:auth\"` — the importer awaits vp", () => {
    const { result, out, codes } = compile({
      "lib.scrml": `\${
  export { verifyPassword as vp } from "scrml:auth"
}
`,
      "app.scrml": serverApp(`import { vp } from "./lib.scrml"`, `        const ok = vp(pass, row.pw)
        if (!ok) { return "REJECTED" }
        return "ACCEPTED"`),
    });
    expect(codes).toEqual([]);
    expect(out("app.scrml").serverJs ?? "").toMatch(/const ok = await vp\(pass, row\.pw\)/);
    void result;
  });

  test("a chain of local re-exports keeps it async", () => {
    const { out, codes } = compile({
      "inner.scrml": `\${
  export { verifyPassword as checkPw } from "scrml:auth"
}
`,
      "lib.scrml": `\${
  export { checkPw as vp } from "./inner.scrml"
}
`,
      "app.scrml": serverApp(`import { vp } from "./lib.scrml"`, `        if (!vp(pass, row.pw)) { return "REJECTED" }
        return "ACCEPTED"`),
    });
    expect(codes).toEqual([]);
    expect(out("app.scrml").serverJs ?? "").toMatch(/if \(!_scrml_assert_settled\(await vp\(/);
  });

  test("a USER-declared function re-exported the same way does not classify as a stdlib Promise", () => {
    const { out, codes } = compile({
      "impl.scrml": `\${
  export function check(a, b) { return a == b }
}
`,
      "lib.scrml": `\${
  export { check as vp } from "./impl.scrml"
}
`,
      "app.scrml": serverApp(`import { vp } from "./lib.scrml"`, `        const ok = vp(pass, row.pw)
        if (!ok) { return "REJECTED" }
        return "ACCEPTED"`),
    });
    expect(codes).toEqual([]);
    expect(out("app.scrml").serverJs ?? "").not.toMatch(/await vp\(/);
  });
});

describe("§5 E-IMPORT-004 judges the imported name, not the alias", () => {
  test("`import { verifyPassword as nonsense }` is clean", () => {
    const { codes } = compile({
      "app.scrml": serverApp(`import { verifyPassword as nonsense } from "scrml:auth"`, `        const ok = nonsense(pass, row.pw)
        if (!ok) { return "REJECTED" }
        return "ACCEPTED"`),
    });
    expect(codes).toEqual([]);
  });

  test("`import { notAnExport as verifyPassword }` is E-IMPORT-004", () => {
    const { codes } = compile({
      "app.scrml": serverApp(`import { notAnExport as verifyPassword } from "scrml:auth"`, `        const ok = verifyPassword(pass, row.pw)
        if (!ok) { return "REJECTED" }
        return "ACCEPTED"`),
    });
    expect(codes).toContain("E-IMPORT-004");
  });
});

describe("§6 a renamed local re-export of a type / function resolves through the source-side name", () => {
  const errs = `\${
  export type Color:enum = { Red, Green }
  export function paint(c: Color) { return c }
}
`;
  const lib = `\${
  export { Color as Hue, paint as tint } from "./errs.scrml"
}
`;
  const app = (extra) => `<program>
  \${
    import { Hue, tint } from "./lib.scrml"
    function pick(h: Hue) {
      return match h {
        .Red :> "r"
        .Green :> "g"
      }
    }
    ${extra}
  }
  <out> = pick(.Red)
  <p>\${@out}</p>
</program>
`;

  test("matching on the renamed enum type-checks", () => {
    const { codes } = compile({ "errs.scrml": errs, "lib.scrml": lib, "app.scrml": app("") });
    expect(codes).toEqual([]);
  });

  test("a bare variant passed to the renamed function is checked against its parameter type", () => {
    const { codes } = compile({
      "errs.scrml": errs, "lib.scrml": lib,
      "app.scrml": app("function bad() { return tint(.Blue) }").replace("</program>", "<button onclick=bad()>x</button>\n</program>"),
    });
    expect(codes).toContain("E-TYPE-063");
  });
});

describe("§7 (F1) an optional call is awaited in every emit shape, exactly once", () => {
  test("server: decl, predicate, receiver, nested arg, ternary, SQL interpolation", () => {
    const { out, codes } = compile({
      "app.scrml": serverApp(
        `import { verifyPassword as vp, hashPassword } from "scrml:auth"`,
        `        const ok = vp?.(pass, row.pw)
        if (!vp?.(pass, row.pw)) { return "REJECTED" }
        const n = hashPassword?.(pass).length
        const s = String(vp?.(pass, row.pw))
        const t = vp?.(pass, row.pw) ? "Y" : "N"
        ?{\`UPDATE users SET pw = \${hashPassword?.(pass)} WHERE name = \${name}\`}.run()
        return s + n + t + ok`,
      ),
    });
    expect(codes).toEqual([]);
    const js = out("app.scrml").serverJs ?? "";
    expect(js).toMatch(/const ok = await vp\?\.\(pass, row\.pw\)/);
    expect(js).toMatch(/if \(!_scrml_assert_settled\(await vp\?\.\(/);
    expect(js).toMatch(/\(await hashPassword\?\.\(pass\)\)\.length/);
    expect(js).toMatch(/String\(await vp\?\.\(/);
    expect(js).toMatch(/const t = _scrml_assert_settled\(await vp\?\.\(/);
    expect(js).toMatch(/\$\{await hashPassword\?\.\(pass\)\}/);
    expect(js).not.toMatch(/[^t] (vp|hashPassword)\?\.\(/); // never bare
    expect(js).not.toMatch(/\bawait\s+\(?\s*await\b/);
  });

  test("server: an optional call of a sibling server function is awaited", () => {
    const { out, codes } = compile({
      "app.scrml": serverApp(
        ``,
        `        if (!other?.(name)) { return "REJECTED" }
        return "ACCEPTED"
      }
      function other(name) {
        const r = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        return r`,
      ),
    });
    expect(codes).toEqual([]);
    expect(out("app.scrml").serverJs ?? "").toMatch(/if \(!await other\?\.\(name\)\)/);
  });

  test("client: an optional call of an async stdlib export is awaited once", () => {
    const { out, codes } = compile({
      "app.scrml": `<program>
  \${
    import { sleep as nap } from "scrml:time"
    function wait() {
      nap?.(5)
      @done = true
    }
  }
  <done> = false
  <button onclick=wait()>go</button>
</program>
`,
    });
    expect(codes).toEqual([]);
    const js = out("app.scrml").clientJs ?? "";
    expect(js).toMatch(/await nap\?\.\(5\)/);
    expect(js).not.toMatch(/await\s+await/);
  });
});
