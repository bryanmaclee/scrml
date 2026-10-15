/**
 * e-error-002-value-position-s467.test.js — SPEC §19.4.3 / §19.4.4, E-ERROR-002 in a VALUE position.
 *
 * §19.4.3: "Failing to handle the result of a `!` function call in any of these ways SHALL be a
 * compile error: E-ERROR-002". §19.4.4: "An unhandled `!` function call SHALL be a compile error
 * (E-ERROR-002)." Neither is limited to a call that is a whole statement, but impl#1 checked only
 * that one: `const ok = check(p); if (ok) { … }` compiled at exit 0, and on failure `ok` held the
 * error object — truthy — so a wrong password read as success (the S467 security repro, D below).
 *
 * The rule is structural, not a list of positions: any call whose callee resolves to a failable
 * function is reported unless it is the operand of a handling form (`!{}`, `match`, `?`, a
 * `<request>` body's right-hand side, a render-time call inside `<errorBoundary>`).
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
  const dir = resolve(tmpdir(), `scrml-s467-${uniq}`);
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
      warnings: [...(result.warnings ?? []), ...all.filter((e) => e.severity === "warning")].map((e) => e.code),
      clientJs: read("app.client.js"),
      html: read("app.html"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HEAD = `type AuthErr:enum = { Denied }
<m> = 0
<arr> = []
`;
const CHECK = `    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function plain(x) { return x }
    function log(x) { return x }
    function apply(f) { return f(1) }
`;
/** One function `t(p)` whose body is `body`, beside the failable `check`. */
const inFn = (body, { failable = false } = {}) => `${HEAD}\${
${CHECK}
    function t(p)${failable ? "! -> AuthErr" : ""} {
        ${body}
    }
}
<button onclick=${failable ? "plain(1)" : 't("x")'}>go</button>
<p>\${@m}</p>
`;
const e002 = (src) => compileSource(src).codes.filter((c) => c === "E-ERROR-002").length;

// ---------------------------------------------------------------------------
// A — value positions are E-ERROR-002
// ---------------------------------------------------------------------------

describe("A — an unhandled failable call used as a value is E-ERROR-002", () => {
  const cases = [
    ["const initializer", "const ok = check(p)\n        @m = ok ? 1 : 0"],
    ["let initializer", "let ok = check(p)\n        @m = ok ? 1 : 0"],
    ["cell write", "@m = check(p)"],
    ["plain assignment", "let x = 0\n        x = check(p)\n        @m = x"],
    ["return operand (non-! function)", "return check(p)"],
    ["call argument", "@m = plain(check(p))"],
    ["argument of a whole-statement call", "log(check(p))"],
    ["ternary branch", "@m = p ? check(p) : 1"],
    ["|| operand", "@m = check(p) || false"],
    ["&& operand", "@m = p && check(p)"],
    ["array member", "@arr = [check(p)]"],
    ["object member", "const o = { k: check(p) }\n        @m = o"],
    ["template interpolation", "const s = `a${check(p)}b`\n        @m = s"],
    ["if condition", "if (check(p)) { @m = 1 }"],
    ["while condition", "while (check(p)) { @m = 1 }"],
    ["for-of iterable", "for (const x of check(p)) { @m = x }"],
    ["arrow expression body", "const xs = [p].map((q) => check(q))\n        @m = xs"],
    ["reactive array method argument", "@arr.push(check(p))"],
  ];
  for (const [name, body] of cases) {
    test(name, () => {
      expect(compileSource(inFn(body)).codes).toEqual(["E-ERROR-002"]);
    });
  }

  test("inside a `!` function a used result is still unhandled (§19.4.3 lists no `return` form)", () => {
    expect(e002(inFn("const v = check(p)\n        return v", { failable: true }))).toBe(1);
    expect(e002(inFn("return check(p)", { failable: true }))).toBe(1);
  });

  test("an event-handler block: the handler wording", () => {
    const r = compileSource(`${HEAD}\${
${CHECK}
}
<button onclick={ const r = check("x"); @m = r }>go</button>
<p>\${@m}</p>
`);
    const d = r.errors.filter((e) => e.code === "E-ERROR-002");
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("not handled in this event handler");
  });

  test("a deferred value-position call is E-DEFER-UNHANDLED-FAILABLE (§19.16.3 rule 3), not E-ERROR-002", () => {
    const r = compileSource(inFn("defer log(check(p))"));
    expect(r.codes).toContain("E-DEFER-UNHANDLED-FAILABLE");
    expect(r.codes).not.toContain("E-ERROR-002");
  });

  test("match arm result", () => {
    const r = compileSource(`type K:enum = { A, B }
${HEAD}\${
${CHECK}
    function t(k: K) {
        const v = match k { .A :> check("x")  .B :> false }
        @m = v
    }
}
<button onclick=t(.A)>go</button>
<p>\${@m}</p>
`);
    expect(r.codes).toEqual(["E-ERROR-002"]);
  });

  test("a top-level cell initializer", () => {
    const r = compileSource(`${HEAD}\${
${CHECK}
}
<n> = check("x")
<p>\${@n}</p>
`);
    expect(r.codes.filter((c) => c === "E-ERROR-002").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B — handled forms stay legal
// ---------------------------------------------------------------------------

describe("B — the handling forms are not reported", () => {
  const ok = [
    ["`!{}` on a declaration", "const ok = check(p) !{ .Denied :> false }\n        @m = ok ? 1 : 0"],
    ["`!{}` on a cell write", "@m = check(p) !{ .Denied :> false }"],
    ["`match` initializer", "const v = match check(p) { .Ok(x) :> x  .Denied :> false }\n        @m = v"],
    ["`return match`", "return match check(p) { .Ok(x) :> x  .Denied :> false }"],
    ["a non-failable call", "@m = plain(p)"],
    ["a lambda parameter that shadows the failable name", "@m = apply((check) => check(1))"],
    // An expression-position `!{}` (inside an operator, a condition, parentheses) handles its operand.
    ["`!{}` inside parentheses under an operator", "const v = (check(p) !{ .Denied :> false }) || false\n        @m = v ? 1 : 0"],
    ["`!{}` in an `if` condition", "if (check(p) !{ .Denied :> false }) { @m = 1 }"],
    ["`!{}` on a postfix chain handles the call at its base", "@m = check(p).toString() !{ .Denied :> \"no\" }"],
  ];
  for (const [name, body] of ok) {
    test(name, () => {
      expect(compileSource(inFn(body)).codes).toEqual([]);
    });
  }

  test("…but `!{}` handles only its operand: a failable ARGUMENT of the handled call is still reported", () => {
    expect(e002(inFn("@m = plain(check(p)) !{ _ :> 0 }"))).toBe(1);
  });

  test("`?` inside a `!` function", () => {
    expect(e002(inFn("const v = check(p)?\n        return v", { failable: true }))).toBe(0);
  });

  test("a `?` ending a match arm inside a `!` function (§19.5.1)", () => {
    expect(e002(inFn("const v = match p { \"a\" :> check(p)?  else :> false }\n        return v", { failable: true }))).toBe(0);
  });

  test("a parameter that shadows the failable name", () => {
    const r = compileSource(`${HEAD}\${
${CHECK}
    function t(check) {
        const v = check("x")
        return v
    }
}
<button onclick=t(plain)>go</button>
<p>\${@m}</p>
`);
    expect(r.codes.filter((c) => c === "E-ERROR-002").length).toBe(0);
  });

  test("a `<request>` body's right-hand side (§19.4.3 item 5)", () => {
    const r = compileSource(`${HEAD}<user> = not
\${
    server function loadUser(id)! -> AuthErr {
        if (id < 0) fail AuthErr::Denied
        return id
    }
}
<request id="userLoad" deps=[]>\${ @user = loadUser(42) }</>
<p>\${<#userLoad>.error is given ? "x" : "y"}</p>
`);
    expect(r.codes.filter((c) => c === "E-ERROR-002").length).toBe(0);
  });

  test("a render-time call inside `<errorBoundary>` (§19.6.6)", () => {
    const r = compileSource(`type CodeError:enum = {
    Empty
        renders <p class="error">Enter a code</>
}
<entry> = ""
\${
    function checkCode(text: string)! -> CodeError {
        if (text == "") fail CodeError::Empty
        return text.toUpperCase()
    }
}
<errorBoundary fallback={<div>Something went wrong/}>
    <p>Code: \${checkCode(@entry) + "!"}</p>
</>
`);
    expect(r.codes.filter((c) => c === "E-ERROR-002").length).toBe(0);
  });

  test("…but a function body declared inside the boundary is not render-time", () => {
    const r = compileSource(`type CodeError:enum = { Empty }
<entry> = ""
\${
    function checkCode(text: string)! -> CodeError {
        if (text == "") fail CodeError::Empty
        return text
    }
}
<errorBoundary fallback={<div>x/}>
    \${
        function show() {
            const v = checkCode(@entry)
            return v
        }
    }
    <button onclick=show()>go</button>
</>
`);
    expect(r.codes.filter((c) => c === "E-ERROR-002").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D — the security repro, executed
// ---------------------------------------------------------------------------

const LOGIN = (decl) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
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
  if (out.errors.length > 0) throw new Error(`compile errors: ${out.codes.join(", ")}`);
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

describe("D — the wrong-password repro", () => {
  test("the unhandled value-position call is refused", () => {
    const r = compileSource(LOGIN("const ok = check(p)"));
    expect(r.codes).toContain("E-ERROR-002");
  });

  test("handled with `!{ .Denied :> false }`: compiles, and a wrong password is rejected", async () => {
    const page = await boot(LOGIN("const ok = check(p) !{ .Denied :> false }"));
    await page.click("#wrong");
    expect(page.text("#out")).toBe("rejected");
    await page.click("#right");
    expect(page.text("#out")).toBe("LOGGED IN");
  });
});
