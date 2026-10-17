/**
 * failable-alias-and-match-s468.test.js — SPEC §19.4.3 / §19.4.4 / §19.7.1, E-ERROR-002.
 *
 * §19.4.3: "Failing to handle the result of a `!` function call in any of these ways SHALL be a
 * compile error: E-ERROR-002". Two S467 gaps of that rule, closed by ONE judgement read from the
 * tree (`failable-value-calls.ts`):
 *
 *  1. g-failable-alias-through-operator-or-returned-fn-s467 — a callee is judged by its VALUE: a
 *     call is a failable call when the function its callee evaluates to MAY be a failable function
 *     (a ternary / `||` / `&&` that may choose one, a call of a function that may return one, a
 *     binding holding any of these, a reassignment). Before: `const g = p ? check : id; g(p)`
 *     compiled and a wrong password logged in (A, executed in D).
 *  2. g-match-failable-subject-through-operator-miscompiled-s467 — a `match` subject that CARRIES a
 *     failable call's result (the reaches-unchanged rule `!{}` and `?` already follow) is a match on
 *     a failable result: the check accepts it and the lowering discriminates the error, from the
 *     same reading. Before: refused (fail closed); `match g(p)` through an alias, and a direct-call
 *     subject in an expression-position `match` (an assignment, an arrow body) compiled and logged
 *     in (C, executed).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function compileSource(source, label = "case") {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s468-${uniq}`);
  const input = resolve(dir, "app.scrml");
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const read = (name) => {
      const p = resolve(outDir, name);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    };
    const all = result.errors ?? [];
    const errors = all.filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
    return {
      errors,
      codes: errors.map((e) => e.code),
      messages: errors.map((e) => e.message),
      clientJs: read("app.client.js"),
      html: read("app.html"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A login page: `login(p)` runs `pre` (inside the logic block) and then `decl`, which binds `ok`. */
const LOGIN = (decl, pre = "") => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function id(p) { return true }
    function plain(p) { return p == "secret" }
    function getF() { return check }
    function getP() { return plain }
${pre}
    function login(p) {
        ${decl}
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;

async function boot(source) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const out = compileSource(source, "login");
  if (out.errors.length > 0) throw new Error(`compile errors: ${out.codes.join(", ")} — ${out.messages.join(" | ")}`);
  const bodyMatch = out.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : out.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  // eslint-disable-next-line no-eval
  (0, eval)(`(function() {\n${SCRML_RUNTIME}\n${out.clientJs}\n})();`);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  await settle();
  return {
    click: async (sel) => { document.querySelector(sel).click(); await settle(); },
    text: (sel) => document.querySelector(sel).textContent,
  };
}

/** Compiles, a wrong password is rejected and the right one logs in. */
async function expectRejectsWrong(decl, pre = "") {
  const page = await boot(LOGIN(decl, pre));
  await page.click("#wrong");
  expect(page.text("#out")).toBe("rejected");
  await page.click("#right");
  expect(page.text("#out")).toBe("LOGGED IN");
}

const codesOf = (decl, pre = "") => compileSource(LOGIN(decl, pre)).codes;

// ---------------------------------------------------------------------------
// A — gap 1: a failable function reached through an operator or a returned function
// ---------------------------------------------------------------------------

describe("A — an unhandled call through a value that may be a failable function is E-ERROR-002", () => {
  const shapes = [
    ["a ternary alias", "const g = p ? check : id\n        const ok = g(p)"],
    ["a `||` alias", "const g = check || id\n        const ok = g(p)"],
    ["a `??` alias", "const g = check ?? id\n        const ok = g(p)"],
    ["the right of `&&`", "const g = id && check\n        const ok = g(p)"],
    ["a call of a function returning one", "const ok = getF()(p)"],
    ["a binding of a returned function", "const g = getF()\n        const ok = g(p)"],
    ["a parenthesized ternary callee", "const ok = (p ? check : id)(p)"],
    ["an alias of an alias through an operator", "const g = check\n        const h = p ? g : id\n        const ok = h(p)"],
    ["an arrow returning one", "const mk = () => check\n        const ok = mk()(p)"],
    ["a block arrow returning one", "const mk = () => { return check }\n        const ok = mk()(p)"],
    ["a reassignment in an inner block", "let g = id\n        if (p != \"\") { g = check }\n        const ok = g(p)"],
    ["a whole-statement call through an alias", "const g = p ? check : id\n        g(p)\n        const ok = true"],
  ];
  for (const [label, decl] of shapes) {
    test(label, () => {
      expect(codesOf(decl)).toContain("E-ERROR-002");
    });
  }

  test("a function returning another's returned function (any declaration order)", () => {
    const pre = "    function h2() { return h1() }\n    function h1() { return getF() }";
    expect(codesOf("const ok = h2()(p)", pre)).toContain("E-ERROR-002");
  });

  test("a local function returning one", () => {
    expect(codesOf("function mk() { return check }\n        const ok = mk()(p)")).toContain("E-ERROR-002");
  });

  test("the message names the function and the alias", () => {
    const r = compileSource(LOGIN("const g = p ? check : id\n        const ok = g(p)"));
    expect(r.messages.join("\n")).toMatch(/'check' \(called through 'g'\)/);
  });
});

describe("A2 — values that cannot be a failable function stay clean", () => {
  const shapes = [
    ["a ternary over plain functions", "const g = p ? plain : id\n        const ok = g(p)"],
    ["a returned plain function", "const ok = getP()(p)"],
    ["the left of `&&` (only tested)", "const g = check && plain\n        const ok = g(p)"],
    ["a call RESULT is not the function", "const r = check(p) !{ .Denied :> false }\n        const ok = r"],
    ["a parameter shadowing the name", "const t = (check) => check(1)\n        const ok = t(plain)"],
  ];
  for (const [label, decl] of shapes) {
    test(label, () => {
      expect(codesOf(decl)).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// B — the handled forms through such a value compile and reject a wrong password
// ---------------------------------------------------------------------------

describe("B — handled through an alias / returned function: executed", () => {
  test("`g(p) !{ … }` through a ternary alias", async () => {
    await expectRejectsWrong("const g = p ? check : id\n        const ok = g(p) !{ .Denied :> false }");
  });
  test("`getF()(p) !{ … }`", async () => {
    await expectRejectsWrong("const ok = getF()(p) !{ .Denied :> false }");
  });
  test("`match g(p)` through a plain alias (was: compiled and LOGGED IN)", async () => {
    await expectRejectsWrong("const g = check\n        const ok = match g(p) { .Denied :> false  _ :> true }");
  });
  test("`match g(p)` through a ternary alias", async () => {
    await expectRejectsWrong("const g = p ? check : id\n        const ok = match g(p) { .Denied :> false  _ :> true }");
  });
  test("`match getF()(p)`", async () => {
    await expectRejectsWrong("const ok = match getF()(p) { .Denied :> false  _ :> true }");
  });
});

// ---------------------------------------------------------------------------
// C — gap 2: a `match` subject that carries a failable result through an operator
// ---------------------------------------------------------------------------

describe("C — a match subject carrying a failable result: compiles and discriminates the error", () => {
  test("`match (p == \"\" || check(p))` (was: refused; before S467, LOGGED IN)", async () => {
    await expectRejectsWrong("const ok = match (p == \"\" || check(p)) { .Denied :> false  _ :> true }");
  });
  test("a ternary-arm subject", async () => {
    await expectRejectsWrong("const ok = match (p == \"\" ? false : check(p)) { .Denied :> false  _ :> true }");
  });
  test("the right of `&&`", async () => {
    await expectRejectsWrong("const ok = match (p != \"\" && check(p)) { .Denied :> false  _ :> true }");
  });
  test("`??`", async () => {
    await expectRejectsWrong("const ok = match (check(p) ?? false) { .Denied :> false  _ :> true }");
  });
  test("an `::Ok(v)` arm binds the success value through an operator", async () => {
    await expectRejectsWrong("const ok = match (p == \"\" || check(p)) { .Ok(v) :> v  .Denied :> false }");
  });
  test("a statement-position match", async () => {
    await expectRejectsWrong("let ok = true\n        match (p == \"\" || check(p)) {\n            .Denied :> { ok = false }\n            _ :> { ok = true }\n        }");
  });
  test("a direct-call subject in an expression-position match inside a block (was: LOGGED IN)", async () => {
    await expectRejectsWrong("let ok = true\n        if (p != \"\") { ok = match check(p) { .Denied :> false  _ :> true } }");
  });
  test("a direct-call subject in an arrow body (was: LOGGED IN)", async () => {
    await expectRejectsWrong("const ok = [1].map((x) => match check(p) { .Denied :> false  _ :> true })[0]");
  });
});

describe("C2 — the widened subject keeps the other rules", () => {
  test("exhaustiveness: no `_` and no `.Ok` arm is E-TYPE-020", () => {
    expect(codesOf("const ok = match (p == \"\" || check(p)) { .Denied :> false }")).toContain("E-TYPE-020");
  });
  test("a member access in between is still a value position", () => {
    expect(codesOf("const ok = match (check(p).ok) { .Denied :> false  _ :> true }")).toContain("E-ERROR-002");
  });
  test("a coercing operator in between is still a value position", () => {
    expect(codesOf("const ok = match (check(p) == true) { true :> true  _ :> false }")).toContain("E-ERROR-002");
  });
  test("the left of `&&` is only tested: still a value position", () => {
    expect(codesOf("const ok = match (check(p) && true) { .Denied :> false  _ :> true }")).toContain("E-ERROR-002");
  });
});

describe("C3 — blast radius: other lowerings of the widened subject", () => {
  test("a server function's match on `(p == \"\" || check(p))` discriminates the error", () => {
    const src = `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    server function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    server function login(p) {
        const ok = match (p == "" || check(p)) { .Denied :> false  _ :> true }
        return ok ? "LOGGED IN" : "rejected"
    }
    function go() { @msg = login("wrong") !{ _ :> "err" } }
}
<button onclick=go()>go</button>
<p>\${@msg}</p>
`;
    const uniq = `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = resolve(tmpdir(), `scrml-s468-${uniq}`);
    mkdirSync(dir, { recursive: true });
    const input = resolve(dir, "app.scrml");
    writeFileSync(input, src);
    try {
      const result = compileScrml({ inputFiles: [input], write: true, outputDir: resolve(dir, "out"), log: () => {} });
      const errs = (result.errors ?? []).filter((e) => e.severity !== "warning" && !/^[WI]-/.test(e.code ?? ""));
      expect(errs.map((e) => e.code)).toEqual([]);
      const server = readFileSync(resolve(dir, "out", "app.server.js"), "utf8");
      expect(server).toMatch(/const (_scrml_tag_\d+) = \((_scrml_match_\d+) != null && typeof \2 === "object" && \2\.__scrml_error === true\) \? \2\.variant : "Ok";/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a §18.19 multi-scrutinee head keeps the direct-call rule", () => {
    expect(codesOf("const ok = match (p == \"\" || check(p), 1) { (.Denied, _) :> false  _ :> true }")).toContain("E-ERROR-002");
  });
});
