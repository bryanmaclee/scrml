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

/** A plain (not failable) function that returns the error enum's variant as a VALUE. */
const PLAIN_DENY = "    function plainDeny(p) { return AuthErr::Denied }";

describe("B — handled through an alias / returned function: executed", () => {
  test("`g(p) !{ … }` through a ternary alias", async () => {
    await expectRejectsWrong("const g = p ? check : id\n        const ok = g(p) !{ .Denied :> false }");
  });
  test("`getF()(p) !{ … }`", async () => {
    await expectRejectsWrong("const ok = getF()(p) !{ .Denied :> false }");
  });
  test("`match g(p)` through `const g = check` (was: compiled and LOGGED IN)", async () => {
    await expectRejectsWrong("const g = check\n        const ok = match g(p) { .Denied :> false  _ :> true }");
  });
  test("`match g(p)` through a const ternary both of whose arms are failable", async () => {
    await expectRejectsWrong("const g = p == \"\" ? check : check\n        const ok = match g(p) { .Denied :> false  _ :> true }");
  });
  test("`match getF()(p)` (every return of getF is a failable function)", async () => {
    await expectRejectsWrong("const ok = match getF()(p) { .Denied :> false  _ :> true }");
  });
  test("`match mk()(p)` with `const mk = () => check`", async () => {
    await expectRejectsWrong("const mk = () => check\n        const ok = match mk()(p) { .Denied :> false  _ :> true }");
  });
  test("a statement-position `match g(p)` through `const g = check`", async () => {
    await expectRejectsWrong("const g = check\n        let ok = false\n        match g(p) {\n            .Denied :> { ok = false }\n            _ :> { ok = true }\n        }");
  });
  test("a direct-call subject in an expression-position match inside a block (was: LOGGED IN)", async () => {
    await expectRejectsWrong("let ok = true\n        if (p != \"\") { ok = match check(p) { .Denied :> false  _ :> true } }");
  });
  test("a direct-call subject in an arrow body (was: LOGGED IN)", async () => {
    await expectRejectsWrong("const ok = [1].map((x) => match check(p) { .Denied :> false  _ :> true })[0]");
  });
});

// ---------------------------------------------------------------------------
// C — S468 fix round 1: a `match` handles a failable call only when the subject is a call
// of a PROVABLY failable function. Everything else stays REFUSED (fail closed): the lowering
// reads every non-error value as `.Ok`, so a subject that may be a plain value has no correct
// lowering (review F1–F3 of 7ecae57eb: each of these compiled and LOGGED IN on a wrong password).
// ---------------------------------------------------------------------------

describe("C — an operator-widened match subject is E-ERROR-002 (as on base)", () => {
  const shapes = [
    ["`||`", "const ok = match (p == \"\" || check(p)) { .Denied :> false  _ :> true }"],
    ["a ternary arm", "const ok = match (p == \"\" ? false : check(p)) { .Denied :> false  _ :> true }"],
    ["the right of `&&`", "const ok = match (p != \"\" && check(p)) { .Denied :> false  _ :> true }"],
    ["`??`", "const ok = match (check(p) ?? false) { .Denied :> false  _ :> true }"],
    ["an `::Ok(v)` arm through an operator", "const ok = match (p == \"\" || check(p)) { .Ok(v) :> v  .Denied :> false }"],
    ["a statement-position match", "let ok = true\n        match (p == \"\" || check(p)) {\n            .Denied :> { ok = false }\n            _ :> { ok = true }\n        }"],
    // F1 — a PLAIN enum value as the other operand: the stamped lowering read it as `.Ok`.
    ["F1: a plain enum value as the other ternary arm",
      "const ok = match (p == \"wrong\" ? AuthErr::Denied : check(p)) { .Denied :> false  _ :> true }"],
    ["F1: a bare-dot variant as the other ternary arm",
      "const ok = match (p == \"wrong\" ? .Denied : check(p)) { .Denied :> false  _ :> true }"],
    ["F1: a plain function's enum value under `||`",
      "const ok = match (plainDeny(p) || check(p)) { .Denied :> false  _ :> true }"],
    ["F1: statement position",
      "let ok = true\n        match (p == \"wrong\" ? AuthErr::Denied : check(p)) { .Denied :> { ok = false }  _ :> { ok = true } }"],
    ["inside a block", "let ok = false\n        if (p != \"zz\") { ok = match (false || check(p)) { .Denied :> false  _ :> true } }"],
    ["inside `.map`", "const ok = [p].map((q) => match (false || check(q)) { .Denied :> false  _ :> true })[0]"],
    ["an `if` condition", "let ok = false\n        if (match (false || check(p)) { .Denied :> false  _ :> true }) { ok = true }"],
  ];
  for (const [label, decl] of shapes) {
    test(label, () => {
      expect(codesOf(decl, PLAIN_DENY)).toContain("E-ERROR-002");
    });
  }

  test("F2: inline `match` through `||` in an event-handler attribute", () => {
    const src = LOGIN("const ok = false").replace('onclick=login("wrong")',
      'onclick=${ @msg = match (false || check("wrong")) { .Denied :> "rejected"  _ :> "LOGGED IN" } }');
    expect(compileSource(src).codes).toContain("E-ERROR-002");
  });

  test("F2: inline `match` through `||` in a markup interpolation", () => {
    const src = LOGIN("const ok = false").replace('<p id="out">${@msg}</p>',
      '<p id="out">${match (false || check("wrong")) { .Denied :> "rejected"  _ :> "LOGGED IN" }}</p>');
    expect(compileSource(src).codes).toContain("E-ERROR-002");
  });
});

describe("C1 — a callee that MAY be a plain function is not provably failable: E-ERROR-002", () => {
  // The F1 class reached through a NAME (found while reproducing F1): with the alias stamped
  // failable, `plainDeny`'s `AuthErr::Denied` read as `.Ok` and a wrong password logged in.
  const shapes = [
    ["a ternary alias over a plain function", "const g = p == \"wrong\" ? plainDeny : check\n        const ok = match g(p) { .Denied :> false  _ :> true }"],
    ["a `||` alias", "const g = plainDeny || check\n        const ok = match g(p) { .Denied :> false  _ :> true }"],
    ["a ternary callee", "const ok = match (p == \"wrong\" ? plainDeny : check)(p) { .Denied :> false  _ :> true }"],
    ["a returned function that may be plain", "const ok = match getQ(p)(p) { .Denied :> false  _ :> true }"],
    ["a `let` alias written again", "let g = check\n        if (p == \"wrong\") { g = plainDeny }\n        const ok = match g(p) { .Denied :> false  _ :> true }"],
    ["statement position", "const g = p == \"wrong\" ? plainDeny : check\n        let ok = false\n        match g(p) { .Denied :> { ok = false }  _ :> { ok = true } }"],
  ];
  const pre = PLAIN_DENY + "\n    function getQ(q) { if (q == \"wrong\") { return plainDeny }\n        return check }";
  for (const [label, decl] of shapes) {
    test(label, () => {
      expect(codesOf(decl, pre)).toContain("E-ERROR-002");
    });
  }

  test("the message says why the match does not handle it", () => {
    const r = compileSource(LOGIN("const g = p == \"wrong\" ? plainDeny : check\n        const ok = match g(p) { .Denied :> false  _ :> true }", PLAIN_DENY));
    expect(r.messages.join("\n")).toMatch(/subject of a 'match', but the function called there may also be one that is not failable/);
  });

  test("a §18.19 multi-scrutinee head keeps its rule (its lowering reads each value's own variant)", async () => {
    await expectRejectsWrong("const g = p == \"wrong\" ? plainDeny : check\n        const ok = match (g(p), 1) { (.Denied, _) :> false  _ :> true }", PLAIN_DENY);
  });
});

describe("C2 — the direct subject keeps the other rules", () => {
  test("exhaustiveness: no `_` and no `.Ok` arm is E-TYPE-020", () => {
    expect(codesOf("const ok = match check(p) { .Denied :> false }")).toContain("E-TYPE-020");
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
  test("a §18.19 multi-scrutinee head keeps the direct-call rule", () => {
    expect(codesOf("const ok = match (p == \"\" || check(p), 1) { (.Denied, _) :> false  _ :> true }")).toContain("E-ERROR-002");
  });
  test("a built-in failable bound by import (`parseVariant`, §41.13) is a provable direct subject", () => {
    const src = `type Color:enum = { Red, Green }
<msg> = "init"
\${
    import { parseVariant } from "scrml:data"
    function pick(p) {
        @msg = match parseVariant(p, Color) { .Ok(c) :> "ok"  _ :> "bad" }
    }
}
<button onclick=pick("Red")>go</button>
<p>\${@msg}</p>
`;
    expect(compileSource(src).codes).toEqual([]);
  });
  test("a CPS-split server function (failable without `!`) stays a handled direct subject", () => {
    const src = `<msg> = "init"
\${
    server function load(p) { return p == "x" }
    function go() {
        @msg = match load("x") { .Ok(v) :> "ok"  _ :> "bad" }
    }
}
<button onclick=go()>go</button>
<p>\${@msg}</p>
`;
    expect(compileSource(src).codes.filter((c) => c === "E-ERROR-002")).toEqual([]);
  });
});

describe("C3 — server function (F3): an operator-widened subject is refused at statement and expression position", () => {
  const SRV = (body) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    server function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    server function login(p) {
        ${body}
    }
    function go() { @msg = login("wrong") !{ _ :> "err" } }
}
<button onclick=go()>go</button>
<p>\${@msg}</p>
`;
  test("statement position `match (p == \"\" || check(p))` (was: unawaited, 200 LOGGED IN)", () => {
    const codes = compileSource(SRV("let ok = false\n        match (p == \"\" || check(p)) { .Denied :> { ok = false }  _ :> { ok = true } }\n        return ok ? \"LOGGED IN\" : \"rejected\"")).codes;
    expect(codes).toContain("E-ERROR-002");
  });
  test("expression position `match (p == \"\" || check(p))`", () => {
    const codes = compileSource(SRV("const ok = match (p == \"\" || check(p)) { .Denied :> false  _ :> true }\n        return ok ? \"LOGGED IN\" : \"rejected\"")).codes;
    expect(codes).toContain("E-ERROR-002");
  });
});

// ---------------------------------------------------------------------------
// D — F5: function facts are judged BY BINDING, never by name across the file
// ---------------------------------------------------------------------------

describe("D — a function's returns are judged where it is declared (F5)", () => {
  test("the review's shape: a local plain `getF` is clean while another function's nested `getF` returns check", () => {
    expect(codesOf(
      "function getF2() { return plain }\n        const ok = getF2()(p)",
      "    function other() { function getF2() { return check }\n        return getF2()(\"x\") !{ _ :> false } }")).toEqual([]);
  });
  test("a local `getF` returning check is still E-ERROR-002 when called unhandled", () => {
    expect(codesOf(
      "function getF2() { return check }\n        const ok = getF2()(p)",
      "    function other() { function getF2() { return plain }\n        return getF2()(\"x\") }")).toContain("E-ERROR-002");
  });
  test("a local `getF` used before its declaration (hoisted) is judged by that declaration", () => {
    expect(codesOf(
      "const ok = getF2()(p)\n        function getF2() { return plain }",
      "    function other() { function getF2() { return check }\n        return getF2()(\"x\") !{ _ :> false } }")).toEqual([]);
  });
  test("a local shadow of a failable name declared later is not provable: refused in a match subject", () => {
    expect(codesOf(
      "function getF2() { return check }\n        const ok = match getF2()(p) { .Denied :> false  _ :> true }\n        const check = plain")).toContain("E-ERROR-002");
  });
});

// ---------------------------------------------------------------------------
// E — S469: the return-facts walk terminates in polynomial time on a recursive call graph
// ---------------------------------------------------------------------------
//
// The fix-round-1 WIP re-walked every SIMPLE PATH of a cyclic call graph (a declaration's
// facts computed through a cycle were never reused, even inside one query): N mutually
// recursive functions, each binding calls of the others, took n=6 1.0 s, n=7 16.4 s, and the
// bootstrap's `parse.scrml` (236 `fn`s) never finished (the pre-commit gate: 49 min, 24 GB).

/** N mutually recursive `fn`s; each binds a call of every other (the recursive-descent shape). */
function recursiveCallGraph(n, extra = "") {
  let s = "type AuthErr:enum = { Denied }\n${\n";
  s += "    function check(p)! -> AuthErr {\n        if (p != \"secret\") fail AuthErr::Denied\n        return true\n    }\n";
  for (let i = 0; i < n; i++) {
    s += `    fn p${i}(k: number) -> number {\n        if (k < 1) return 0\n`;
    for (let j = 0; j < n; j++) if (j !== i) s += `        const v${j} = p${j}(k - 1)\n`;
    s += "        return k\n    }\n";
  }
  s += extra + "}\n<p>${p0(3)}</p>\n";
  return s;
}

/** getA may return check directly or through getB; getB returns getA's result (a cycle). */
const CYCLE_FNS = [
  "    function getA(k) { if (k < 1) { return check }\n        return getB(k - 1) }",
  "    function getB(k) { return getA(k) }",
].join("\n") + "\n";

describe("E — termination on a cyclic call graph (S469 hang)", () => {
  test("14 mutually recursive functions compile (bounded time)", () => {
    const t = Date.now();
    const r = compileSource(recursiveCallGraph(14), "cyclic");
    expect(r.codes).toEqual([]);
    expect(Date.now() - t).toBeLessThan(10000);
  }, 30000);

  test("a failable function reachable only THROUGH the cycle is still found (fail closed)", () => {
    const extra = CYCLE_FNS + "    function login(p) { const ok = getB(1)(p)\n        return ok }\n";
    expect(compileSource(recursiveCallGraph(6, extra), "cyclic-fail").codes).toContain("E-ERROR-002");
  }, 30000);

  test("a cycle never makes a match subject provable (refused)", () => {
    const extra = CYCLE_FNS
      + "    function login(p) { const ok = match getB(1)(p) { .Denied :> false  _ :> true }\n        return ok }\n";
    expect(compileSource(recursiveCallGraph(6, extra), "cyclic-match").codes).toContain("E-ERROR-002");
  }, 30000);
});
