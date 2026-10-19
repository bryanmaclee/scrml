/**
 * e-error-002-value-form-followups-s469.test.js — SPEC §19.4.3, E-ERROR-002: the follow-ups to
 * the value-form `if` / `for` fix (#1464), each a place the failable-call walk
 * (`failable-value-calls.ts`) read NOTHING and so let an unhandled `!` call through.
 *
 * §19.4.3: "Failing to handle the result of a `!` function call in any of these ways SHALL be a
 * compile error: E-ERROR-002". The login page below: `check(p)` is a `!` function, and `login`
 * does `if (ok) LOGGED IN else rejected`. An unhandled call hands `ok` the error object — truthy —
 * so a WRONG password logs in.
 *
 *   F1 — a `lift` operand neither parser reads (a value form nested two deep) returned silently;
 *        only codegen's E-CODEGEN-INVALID-LOGIC stood in the way. Now: E-ERROR-002 when the
 *        text names a failable function, otherwise refused as unreadable (fails closed).
 *   F1b — lifted MARKUP (`lift <li>${check(x) ? "LOGGED IN" : "rejected"}</li>`) was never read
 *        (`g-lift-markup-failable-call-unchecked-s468`); executed on #1464's head, a wrong
 *        password rendered LOGGED IN. The same reader now serves markup an EXPRESSION holds
 *        (`${ c ? <p>${check(p) ? … }</p> : "" }`, `g-markup-in-interp-ternary-failable-call-unchecked-s468`).
 *   F2 — a TAGGED TEMPLATE (`check\`${p}\``) calls its tag, but the expression tree carries it as
 *        an escape hatch with only `raw`, which the walk did not read: `const ok = check\`${p}\``
 *        compiled and a wrong password logged in. Every other ESTree node carried that way
 *        (a sequence, a class expression, an interpolation the parser could not read) is read
 *        too — to refuse.
 *   F7 — a pass's `__` annotation that holds a structure is read, never skipped; test D of the
 *        #1464 suite now also follows assignments through loop variables.
 *
 * Each fix has wrong-password tests (refused) and right-password tests (a handled form compiles,
 * and executed, rejects the wrong password and logs in the right one).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { forEachCallInStatement, forEachCallInValuePosition, mentionedNames } from "../../src/failable-value-calls.ts";

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function compileSource(source, label = "case") {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s469fu-${uniq}`);
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
    return { errors, codes: errors.map((e) => e.code), clientJs: read("app.client.js"), html: read("app.html") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const AUTH = `type AuthErr:enum = { Denied }`;
const CHECK = `    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function plain(p) { return p == "secret" }`;

/** The login page: `login` reads `ok`. */
const LOGIN = (decl, top = "") => `${AUTH}
<msg> = "init"
\${
${CHECK}
${top}
    function login(p) {
        ${decl}
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;

/** A rendered page: `@pw` is the password the `#out` markup is rendered from. */
const RENDER = (body) => `${AUTH}
<pw> = "wrong"
\${
${CHECK}
}
<button id="wrong" onclick=\${@pw = "wrong"}>go</button>
<button id="right" onclick=\${@pw = "secret"}>go</button>
<div id="out">${body}</div>
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

async function expectLoginRejectsWrongAcceptsRight(source) {
  const page = await boot(source);
  await page.click("#wrong");
  expect(page.text("#out")).toBe("rejected");
  await page.click("#right");
  expect(page.text("#out")).toBe("LOGGED IN");
}

const codesOf = (src) => compileSource(src).codes;

// ---------------------------------------------------------------------------
// F1 — a `lift` operand neither parser reads fails closed
// ---------------------------------------------------------------------------

describe("F1 — an unreadable `lift` operand is refused, never skipped", () => {
  test("the review repro: `lift if` / `lift if` two deep inside a value-form `for`", () => {
    const decl = "const vs = for (const x of [p]) { lift if (x != \"\") { lift if (x != \"z\") { lift check(x) } else { lift false } } else { lift false } }\n        const ok = vs[0]";
    expect(codesOf(LOGIN(decl))).toContain("E-ERROR-002");
  });

  test("`lift if` three deep inside a value-form `if`", () => {
    const decl = "const ok = if (p != \"\") { lift if (p != \"z\") { lift if (p != \"y\") { lift check(p) } else { lift false } } else { lift false } } else { lift false }";
    expect(codesOf(LOGIN(decl))).toContain("E-ERROR-002");
  });

  test("an alias of the failable function, called in the unreadable operand", () => {
    const decl = "const g = check\n        const ok = if (p != \"\") { lift if (p != \"z\") { lift if (p != \"y\") { lift g(p) } else { lift false } } else { lift false } } else { lift false }";
    const d = compileSource(LOGIN(decl)).errors.filter((e) => e.code === "E-ERROR-002");
    expect(d.some((e) => /called through 'g'/.test(e.message))).toBe(true);
  });

  test("an unreadable operand that names no failable function is refused as unreadable", () => {
    const decl = "const ok = if (p != \"\") { lift if (p != \"z\") { lift if (p != \"y\") { lift plain(p) } else { lift false } } else { lift false } } else { lift false }";
    const errs = compileSource(LOGIN(decl)).errors;
    expect(errs.some((e) => e.code === "E-CODEGEN-INVALID-LOGIC" && /'lift' operand could not be read/.test(e.message))).toBe(true);
  });

  test("right password: the supported shape — bind the inner value first, then lift it", async () => {
    await expectLoginRejectsWrongAcceptsRight(LOGIN(
      "const inner = if (p != \"z\") { const v = check(p) !{ | _ :> false }\n        lift v } else { lift false }\n" +
      "        const ok = if (p != \"\") { lift inner } else { lift false }"));
  });
});

// ---------------------------------------------------------------------------
// F1b — lifted markup is read
// ---------------------------------------------------------------------------

describe("F1b — a failable call in markup a `lift` produces is E-ERROR-002", () => {
  const LOOP = (markup) => `\${ for (x of [@pw]) { lift ${markup} } }`;
  const wrong = [
    ["the review repro: a ternary on the call in an interpolation", RENDER("${ for (x of [\"wrong\"]) { lift <li>${check(x) ? \"LOGGED IN\" : \"rejected\"}</li> } }")],
    ["a bare call rendered in an interpolation", RENDER(LOOP("<li>${check(x)}</li>"))],
    ["an interpolation in nested markup", RENDER(LOOP("<li><span>${check(x) ? \"LOGGED IN\" : \"rejected\"}</span></li>"))],
    ["an attribute value", RENDER(LOOP("<li if=${check(x)}>LOGGED IN</li>"))],
    ["an event handler call", RENDER(LOOP("<button onclick=check(x)>b</button>"))],
    ["an event handler reference", RENDER(LOOP("<button onclick=check>b</button>"))],
    ["inside a value-form `for`", LOGIN("const vs = for (const x of [p]) { lift <li>${check(x) ? \"a\" : \"b\"}</li> }\n        const ok = vs.length > 5")],
  ];
  for (const [name, src] of wrong) {
    test(name, () => {
      expect(codesOf(src)).toContain("E-ERROR-002");
    });
  }

  test("inside an `<errorBoundary>`, a call in lifted markup is refused (no catch site tests it)", () => {
    const src = `type AuthErr:enum = { Denied renders <b>denied</b> }
<pw> = "wrong"
\${
${CHECK}
}
<errorBoundary>
<ul id="out">\${ for (x of [@pw]) { lift <li>\${check(x) ? "LOGGED IN" : "rejected"}</li> } }</ul>
</errorBoundary>
`;
    const d = compileSource(src).errors.filter((e) => e.code === "E-ERROR-002");
    expect(d.some((e) => /markup produced by 'lift'/.test(e.message))).toBe(true);
  });

  test("right password: a handled call in lifted markup compiles and renders correctly", async () => {
    await expectLoginRejectsWrongAcceptsRight(RENDER(
      "${ for (x of [@pw]) { lift <li>${(check(x) !{ | _ :> false }) ? \"LOGGED IN\" : \"rejected\"}</li> } }"));
  });

  // The same reader serves markup an EXPRESSION holds (`g-markup-in-interp-ternary-failable-call-unchecked-s468`).
  test("markup held by an interpolation's ternary (on #1464's head: a wrong password rendered LOGGED IN)", () => {
    expect(codesOf(RENDER("${ @pw != \"\" ? <p>${check(@pw) ? \"LOGGED IN\" : \"rejected\"}</p> : \"\" }"))).toContain("E-ERROR-002");
  });

  test("markup held by an expression, inside an `<errorBoundary>`, is refused", () => {
    const src = RENDER("${ @pw != \"\" ? <p>${check(@pw) ? \"LOGGED IN\" : \"rejected\"}</p> : \"\" }")
      .replace("type AuthErr:enum = { Denied }", "type AuthErr:enum = { Denied renders <b>denied</b> }")
      .replace("<div id=\"out\">", "<errorBoundary>\n<div id=\"out\">").replace(/<\/div>\n$/, "</div>\n</errorBoundary>\n");
    const d = compileSource(src).errors.filter((e) => e.code === "E-ERROR-002");
    expect(d.some((e) => /held by an expression/.test(e.message))).toBe(true);
  });

  test("right password: a handled call in markup held by an expression", async () => {
    await expectLoginRejectsWrongAcceptsRight(RENDER(
      "${ @pw != \"\" ? <p>${(check(@pw) !{ | _ :> false }) ? \"LOGGED IN\" : \"rejected\"}</p> : \"\" }"));
  });

  test("lifted markup with no failable call is not reported", () => {
    expect(codesOf(RENDER("${ for (x of [@pw]) { lift <li title=${x}>${x == \"secret\" ? \"LOGGED IN\" : \"rejected\"}</li> } }"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F2 — a tagged template calls its tag
// ---------------------------------------------------------------------------

describe("F2 — a tagged-template call to a failable function is E-ERROR-002", () => {
  const TAG = "    function checkTag(s, p)! -> AuthErr {\n        if (p != \"secret\") fail AuthErr::Denied\n        return true\n    }";
  const wrong = [
    ["the review repro: `const ok = check`${p}``", "const ok = check`${p}`"],
    ["the review repro: `Boolean(check`${p}`)`", "const ok = Boolean(check`${p}`)"],
    ["the review repro: `lift check`${p}`` in a value form", "const ok = if (p != \"\") { lift check`${p}` } else { lift false }"],
    ["no interpolation", "const ok = check`x`"],
    ["a member read on the result", "const ok = check`${p}`.valueOf()"],
    ["a `return` operand", "function inner() { return check`${p}` }\n        const ok = inner()"],
    ["a failable call interpolated into a plain tag", "const ok = plain`${check(p)}`"],
    ["a `match` subject (not lowered as a failable match)", "const ok = match checkTag`${p}` { .Denied :> false\n        else :> true }"],
    ["a sequence expression `(0, check(p))`", "const ok = (0, check(p))"],
  ];
  for (const [name, decl] of wrong) {
    test(name, () => {
      expect(codesOf(LOGIN(decl, TAG))).toContain("E-ERROR-002");
    });
  }

  test("inside an `<errorBoundary>`, a tagged-template call is refused", () => {
    const src = `type AuthErr:enum = { Denied renders <b>denied</b> }
\${
${CHECK}
}
<errorBoundary>
<p id="out">\${ check\`wrong\` ? "LOGGED IN" : "rejected" }</p>
</errorBoundary>
`;
    expect(codesOf(src)).toContain("E-ERROR-002");
  });

  test("right password: `checkTag`${p}` !{ … }` is handled", async () => {
    await expectLoginRejectsWrongAcceptsRight(LOGIN("const ok = checkTag`${p}` !{ | _ :> false }", TAG));
  });

  test("right password: a handled tagged-template call in a value-form body", async () => {
    await expectLoginRejectsWrongAcceptsRight(LOGIN(
      "const ok = if (p != \"\") { const v = checkTag`${p}` !{ | _ :> false }\n        lift v } else { lift false }", TAG));
  });

  test("right password: `checkTag`${p}`?` inside a `!` function propagates", async () => {
    await expectLoginRejectsWrongAcceptsRight(LOGIN(
      "const ok = inner(p) !{ | _ :> false }",
      `${TAG}\n    function inner(p)! -> AuthErr {\n        const v = checkTag\`\${p}\`?\n        return v\n    }`));
  });

  test("a non-failable tag is not reported", () => {
    expect(codesOf(LOGIN("const ok = plain`${p}`"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The walk's text readers, directly
// ---------------------------------------------------------------------------

describe("escape hatches and unread text, at the walk", () => {
  const env = {
    resolveOuter: (n) => (n === "check" ? "check" : null),
    parseStatements: () => null,
    parseExpr: () => null,
    parseGuardArms: () => null,
    matchArmBodyText: () => null,
  };
  const found = (node) => { const out = []; forEachCallInValuePosition(node, "none", env, (c) => out.push(c)); return out; };
  const hatch = (nativeKind, raw) => ({ kind: "escape-hatch", nativeKind, raw, span: { start: 0, end: raw.length, line: 1, col: 1 } });

  test("every ESTree kind carried as a hatch is read (tagged template, sequence, class, unread interpolation)", () => {
    expect(found(hatch("TaggedTemplateExpression", "check`${p}`")).map((c) => c.calleeName)).toEqual(["check"]);
    expect(found(hatch("SequenceExpression", "(0, check(p))")).length).toBe(1);
    expect(found(hatch("ClassExpression", "class { m() { return check(p) } }")).length).toBe(1);
    expect(found(hatch("TemplateInterpFallback", "check(p) !{ | _ :> 1 }")).length).toBe(1);
    expect(found(hatch("MetaProperty", "import.meta")).length).toBe(0);
  });

  test("a regular-expression literal holds no code", () => {
    expect(found(hatch("Literal", "/check/g")).length).toBe(0);
  });

  test("a tagged template's interpolations are read structurally", () => {
    const tpl = { kind: "lit", litType: "template", raw: "`a ${check(p)} b`", span: { start: 0, end: 16, line: 1, col: 1 } };
    expect(found(tpl).length).toBe(1);
    expect(found(hatch("TaggedTemplateExpression", "plain`${check(p)}`")).map((c) => c.calleeName)).toEqual(["check"]);
  });

  test("a parse-error statement root with no structured reading is read to refuse", () => {
    const out = [];
    forEachCallInStatement({ kind: "return-stmt", exprNode: hatch("ParseError", "check(p) :> 1") }, "none", env, (c) => out.push(c));
    expect(out.length).toBe(1);
  });

  test("a parse-error root next to its structured reading is not read twice", () => {
    const out = [];
    const call = { kind: "call", callee: { kind: "ident", name: "check" }, args: [], optional: false };
    forEachCallInStatement({ kind: "match-arm-inline", resultExpr: hatch("ParseError", "check(p)?"), propagateOperandExpr: call }, "none", env, (c) => out.push(c));
    expect(out.length).toBe(0);
  });

  test("mentionedNames: names, not properties; template interpolations; `@cell`s", () => {
    const n = mentionedNames("o.check(p) + `x${ `y${inner(q)}` }` + @cell + \"check\"");
    expect(n.has("o")).toBe(true);
    expect(n.has("check")).toBe(false);
    expect(n.has("inner")).toBe(true);
    expect(n.has("cell")).toBe(true);
    expect(mentionedNames("...check").has("check")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F7 — `__` annotations that hold a structure are read
// ---------------------------------------------------------------------------

describe("F7 — a `__` key is a flag, or it is read", () => {
  const env = {
    resolveOuter: (n) => (n === "check" ? "check" : null),
    parseStatements: () => null,
    parseExpr: () => null,
    parseGuardArms: () => null,
    matchArmBodyText: () => null,
  };
  const call = () => ({ kind: "call", callee: { kind: "ident", name: "check" }, args: [], optional: false });
  const found = (st) => { const out = []; forEachCallInStatement(st, "none", env, (c) => out.push(c)); return out; };

  test("a `__` key holding an expression is read (fails closed)", () => {
    expect(found({ kind: "const-decl", name: "ok", init: "", __future: call() }).length).toBe(1);
    expect(found({ kind: "bare-expr", expr: "x", __future: { wrap: [call()] } }).length).toBe(1);
  });

  test("a `__` flag is not read", () => {
    expect(found({ kind: "const-decl", name: "ok", init: "", __enclosingFnCanFail: true, __inDeferBody: false }).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fix round 2 (the #1470 review)
// ---------------------------------------------------------------------------

/** A page whose `#out` shows `@msg`; `#wrong` / `#right` set `@pw`; `body` is extra markup. */
const MSG = (top, body) => `${AUTH}
<msg> = "init"
<pw> = "wrong"
\${
${CHECK}
${top}
}
<button id="wrong" onclick=\${@pw = "wrong"}>go</button>
<button id="right" onclick=\${@pw = "secret"}>go</button>
${body}
<p id="out">\${@msg}</p>
`;

describe("r2 F1 — a lifted attribute value that swallowed later attributes is read whole", () => {
  // `parseLiftTag` folds `id=${…}` and every attribute after it into one value; codegen still
  // emits the `onclick`. On the r1 head the walk read only the `$` the value parsed to.
  const wrong = [
    ["the review repro: `id=${\"wrong\"}` before `onclick`", "id=${\"wrong\"}"],
    ["`class=${x}` before `onclick`", "class=${x}"],
  ];
  for (const [name, attr] of wrong) {
    test(name, () => {
      const src = MSG("", `<div>\${ for (const x of ["wrong"]) { lift <button ${attr} onclick={ @msg = check(x) ? "LOGGED IN" : "rejected" }>go</button> } }</div>`);
      expect(codesOf(src)).toContain("E-ERROR-002");
    });
  }

  test("in a value-form `for`", () => {
    expect(codesOf(LOGIN("const vs = for (const x of [p]) { lift <button id=${\"a\"} onclick={ @msg = check(x) ? \"a\" : \"b\" }>go</button> }\n        const ok = vs.length > 5"))).toContain("E-ERROR-002");
  });

  // (A braced handler holding `check(x) !{ … }` in lifted markup does not lower on #1464's head
  // either — E-CODEGEN-INVALID-LOGIC — so the handled call sits in a function the handler calls.)
  test("right password: a lifted handler after an `id=${…}` value, calling a function that handles the call", async () => {
    const LOGIN_FN = "    function login(p) { const ok = check(p) !{ | _ :> false }\n        if (ok) { @msg = \"LOGGED IN\" } else { @msg = \"rejected\" } }";
    const page = await boot(MSG(LOGIN_FN, "<div>${ for (const x of [@pw]) { lift <button id=${\"go\"} onclick=login(x)>go</button> } }</div>"));
    await page.click("#wrong");
    await page.click("#go");
    expect(page.text("#out")).toBe("rejected");
    await page.click("#right");
    await page.click("#go");
    expect(page.text("#out")).toBe("LOGGED IN");
  });
});

// S469 r3 — the #1470 merge-queue failure (`handler-server-assign-order-s446.browser.test.js`): a
// lifted handler is a STATEMENT LIST; r2 read any multi-statement handler text refuse-only, so a
// correctly handled `!{}` there was a false E-ERROR-002. These pin the handled shapes in the
// pre-commit gate (the browser dir is not in it), and the unhandled ones stay refused.
describe("r3 — a lifted event handler is read as statements", () => {
  const H_OK = "@msg = check(x) !{ | e :> { @s = \"err\" } }; @y = @msg == true ? 1 : 2";
  const LIFT = (h) => `<ul>\${ for (x of [@pw]) { lift <li><button id="go" onclick=\${${h}}>b</button></li>; } }</ul>`;
  const ARM = (inner) => `<div><match for=Doc on=@cur><Empty><p>none</p></><Note(note)>${inner}</></match></div>`;
  const PAGE = (body) => MSG("", body)
    .replace("<msg> = \"init\"", "<msg> = \"init\"\n<s> = \"\"\n<y> = 0\ntype Doc:enum = { Empty, Note(note: string) }\n<cur> = Doc.Note(\"hi\")")
    .replace("<p id=\"out\">${@msg}</p>", "<p id=\"out\">${@s}/${@y}</p>");
  for (const [pos, wrap] of [["for … lift", LIFT], ["for … lift in a match arm", (h) => ARM(LIFT(h))]]) {
    test(`right password: ${pos} > \`!{}\` error arm, then a later statement`, async () => {
      const page = await boot(PAGE(wrap(H_OK)));
      await page.click("#wrong");
      await page.click("#go");
      expect(page.text("#out")).toBe("err/2");
      await page.click("#right");
      await page.click("#go");
      expect(page.text("#out")).toBe("err/1");
    });
    test(`wrong password: ${pos} > an unhandled call in a LATER statement of the handler`, () => {
      expect(codesOf(PAGE(wrap("@s = \"a\"; @msg = check(x) ? \"LOGGED IN\" : \"rejected\"")))).toContain("E-ERROR-002");
    });
    test(`wrong password: ${pos} > an unhandled call in the first statement`, () => {
      expect(codesOf(PAGE(wrap("@msg = check(x) ? \"LOGGED IN\" : \"rejected\"; @s = \"a\"")))).toContain("E-ERROR-002");
    });
  }
});

/** RENDER with a top-level helper function `mk`. */
const RENDER_MK = (fn) => RENDER("${mk(@pw)}").replace("    function plain(p)", `    ${fn}\n    function plain(p)`);

describe("r2 F2 — `return <markup>` is read", () => {
  test("the review repro: an interpolation in returned markup", () => {
    expect(codesOf(RENDER_MK("function mk(p) { return <b>${check(p) ? \"LOGGED IN\" : \"rejected\"}</b> }"))).toContain("E-ERROR-002");
  });

  test("an attribute of returned markup", () => {
    expect(codesOf(RENDER_MK("function mk(p) { return <b if=(check(p))>LOGGED IN</b> }"))).toContain("E-ERROR-002");
  });

  test("right password: a handled call in returned markup", async () => {
    await expectLoginRejectsWrongAcceptsRight(RENDER_MK("function mk(p) { return <b>${(check(p) !{ | _ :> false }) ? \"LOGGED IN\" : \"rejected\"}</b> }"));
  });
});

describe("r2 F3 — destructuring defaults in a `for` head are read", () => {
  const wrong = [
    ["an object pattern", "let ok = false\n        for (const { a = check(p) } of [{}]) { ok = a }"],
    ["an array pattern", "let ok = false\n        for (const [a = check(p)] of [[]]) { ok = a }"],
    ["a value-form `for`", "const vs = for (const { a = check(p) } of [{}]) { lift a }\n        const ok = vs[0]"],
  ];
  for (const [name, decl] of wrong) {
    test(name, () => {
      expect(codesOf(LOGIN(decl))).toContain("E-ERROR-002");
    });
  }

  test("right password: a non-failable default", async () => {
    await expectLoginRejectsWrongAcceptsRight(LOGIN("let ok = false\n        for (const { a = plain(p) } of [{}]) { ok = a }"));
  });
});

describe("r2 F4 — a §18.19 multi-scrutinee match on a failable call is handled (no false refusal)", () => {
  const ok = [
    ["the call as the first scrutinee", "const ok = match (check(p), 1) { (.Denied, _) :> false\n        _ :> true }"],
    ["through an alias", "const g = check\n        const ok = match (g(p), 1) { (.Denied, _) :> false\n        _ :> true }"],
    ["the call as the second scrutinee", "const ok = match (1, check(p)) { (_, .Denied) :> false\n        _ :> true }"],
  ];
  for (const [name, decl] of ok) {
    test(`right password: ${name}`, async () => {
      await expectLoginRejectsWrongAcceptsRight(LOGIN(decl));
    });
  }

  test("wrong password: the call under an operator inside a scrutinee is still refused", () => {
    expect(codesOf(LOGIN("const ok = match (check(p) || 1, 1) { (.Denied, _) :> false\n        _ :> true }"))).toContain("E-ERROR-002");
  });
});
