/**
 * e-error-002-value-form-if-for-s469.test.js — SPEC §19.4.3, E-ERROR-002 through a VALUE-FORM
 * `if` / `for` (S469 security fix).
 *
 * §19.4.3: "Failing to handle the result of a `!` function call in any of these ways SHALL be a
 * compile error: E-ERROR-002". A declaration whose value is a value-form `if` / `for`
 * (`const ok = if (c) { lift a } else { lift b }`) is carried as `ifExpr` / `forExpr` with
 * `init: ""`, and the E-ERROR-002 walk (`failable-value-calls.ts`) read neither key: the
 * condition, the body statements and the `lift` operands went unchecked, and on origin/main
 * a74a32eca every shape in A below but one compiled, so a WRONG PASSWORD LOGGED IN (the value-form
 * `if` inside a value-form `for` is refused there by codegen, E-CODEGEN-INVALID-LOGIC — see A).
 *
 * The fix: the walk reads a value-form `if` / `for` as statements (condition / iterable as values,
 * bodies as statements), a `lift` operand as a value position (a `!{}` on it still handles it),
 * refuses a failable function lifted as a VALUE (calls through the binding are not followed), and
 * classifies EVERY key a declaration can carry: a key with no class is read in full as a value
 * position (fails closed). D pins the classification against the AST builder's own source.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import * as acorn from "acorn";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { DECL_KEY_CLASSES, STATEMENT_CHILD_KEYS, STMT_KEY_CLASSES, VALUE_POSITION_STMT_KINDS, forEachCallInStatement } from "../../src/failable-value-calls.ts";

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function compileSource(source, label = "case") {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s469-${uniq}`);
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

/** The login page: `check` is a `!` function, `plain` is not; `login` reads `ok`. */
const LOGIN = (decl, top = "") => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function plain(p) { return p == "secret" }
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

const e002 = (src) => compileSource(src).codes.filter((c) => c === "E-ERROR-002").length;

// ---------------------------------------------------------------------------
// A — the wrong-password shapes (each compiled on a74a32eca and logged in — except "a
// value-form `if` inside a value-form `for`", which main refuses with E-CODEGEN-INVALID-LOGIC
// (codegen cannot lower a `lift if`); it is here because the type system must not rely on that)
// ---------------------------------------------------------------------------

describe("A — an unhandled failable call through a value-form if/for is E-ERROR-002", () => {
  const cases = [
    ["the `if` condition", "const ok = if (check(p)) { lift true } else { lift false }"],
    ["a `lift` operand", "const ok = if (p != \"\") { lift check(p) } else { lift false }"],
    ["a declaration in the body", "const ok = if (p != \"\") { const z = check(p)\n        lift z } else { lift false }"],
    ["`let` with a value-form `if`", "let ok = if (p != \"\") { lift check(p) } else { lift false }"],
    ["a value-form `for` lift", "const vs = for (const x of [p]) { lift check(x) }\n        const ok = vs[0]"],
    ["a value-form `for` iterable", "const vs = for (const x of [check(p)]) { lift x }\n        const ok = vs[0]"],
    ["an `else if` arm", "const ok = if (p == \"\") { lift false } else if (p != \"x\") { lift check(p) } else { lift false }"],
    ["a nested statement `if` in the body", "const ok = if (p != \"\") { if (p != \"x\") { const q = check(p)\n        lift q } else { lift false } } else { lift false }"],
    ["a whole-statement call in the body", "const ok = if (p != \"\") { check(p)\n        lift true } else { lift false }"],
    ["a value-form `if` inside a value-form `for`", "const vs = for (const x of [p]) { lift if (x != \"\") { lift check(x) } else { lift false } }\n        const ok = vs[0]"],
  ];
  for (const [name, decl] of cases) {
    test(name, () => {
      expect(compileSource(LOGIN(decl)).codes).toContain("E-ERROR-002");
    });
  }
});

// S469 #1444 fix round 3 (PA decision): ONE reader of "a failable function read as a value" —
// `refKind: "fn-value"` — reports E-IMPL1-FAILABLE-FN-VALUE (ruling:user-voice-scrml.md S469
// "Split + audit": the language allows it; impl#1 cannot follow it). These lift-operand cases
// were E-ERROR-002 ("lifted as a VALUE") before the two readers were unified; the code changed,
// the refusal did not.
const fnValue = (src) => compileSource(src).errors.filter((e) => e.code === "E-IMPL1-FAILABLE-FN-VALUE").length;

describe("A2 — a failable function lifted as a VALUE is refused", () => {
  test("`lift check` then `g(p)`", () => {
    const r = compileSource(LOGIN("const g = if (p != \"\") { lift check } else { lift plain }\n        const ok = g(p)"));
    const d = r.errors.filter((e) => e.code === "E-IMPL1-FAILABLE-FN-VALUE");
    expect(d.length).toBeGreaterThanOrEqual(1);
    expect(d.some((e) => /impl#1 cannot check a failable function used as a value/.test(e.message))).toBe(true);
  });

  test("module-level `const mg = if (true) { lift check } else { lift plain }`", () => {
    expect(compileSource(LOGIN("const ok = mg(p)", "    const mg = if (true) { lift check } else { lift plain }")).codes).toContain("E-IMPL1-FAILABLE-FN-VALUE");
  });

  test("`match g(p)` on that binding", () => {
    const r = compileSource(LOGIN(
      "const g = if (p != \"\") { lift check } else { lift plain }\n        const ok = match g(p) { .Denied :> false\n        else :> true }"));
    expect(r.codes).toContain("E-IMPL1-FAILABLE-FN-VALUE");
  });

  test("a ternary over the function, a lambda returning it, a value-form `for` lifting it", () => {
    expect(fnValue(LOGIN("const g = if (p != \"\") { lift p ? check : plain } else { lift plain }\n        const ok = g(p)"))).toBeGreaterThanOrEqual(1);
    expect(fnValue(LOGIN("const g = if (p != \"\") { lift () => check } else { lift () => plain }\n        const ok = g()(p)"))).toBeGreaterThanOrEqual(1);
    expect(fnValue(LOGIN("const gs = for (const x of [p]) { lift check }\n        const ok = gs[0](p)"))).toBeGreaterThanOrEqual(1);
  });

  test("an alias of the function, lifted", () => {
    expect(fnValue(LOGIN("const h = check\n        const g = if (p != \"\") { lift h } else { lift plain }\n        const ok = g(p)"))).toBeGreaterThanOrEqual(1);
  });

  test("one report per read: the lift-operand scan and the value walk do not both report it", () => {
    const r = compileSource(LOGIN("const g = if (p != \"\") { lift check } else { lift plain }\n        const ok = true"));
    expect(r.errors.filter((e) => e.code === "E-IMPL1-FAILABLE-FN-VALUE").length).toBe(1);
  });
});

describe("A3 — the same walk, other declaration values", () => {
  test("a destructuring default `const { ok = check(p) } = {}`", () => {
    expect(compileSource(LOGIN("const { ok = check(p) } = {}")).codes).toContain("E-ERROR-002");
  });

  test("a rendered `for` body's `lift` operand", () => {
    const r = compileSource(`type AuthErr:enum = { Denied }
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
<ul>\${ for (const x of ["wrong"]) { lift check(x) ? "LOGGED IN" : "rejected" } }</ul>
`);
    expect(r.codes).toContain("E-ERROR-002");
  });

  test("a top-level value-form `if` in a logic block", () => {
    const r = compileSource(`type AuthErr:enum = { Denied }
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
<p>\${ const v = if (true) { lift check("wrong") } else { lift false } }</p>
`);
    expect(r.codes).toContain("E-ERROR-002");
  });
});

describe("A4 — handling forms impl#1 does not lower there are refused, not trusted", () => {
  // Executed before the refusal (S469): each compiled once the call was otherwise accepted, and
  // a wrong password logged in (the `for` lift) or a right one was rejected (the `if` lift).
  test("`lift check(p) !{ … }` — the guard is applied to the lift, not the call", () => {
    for (const decl of [
      "const ok = if (p != \"\") { lift check(p) !{ .Denied :> false } } else { lift false }",
      "let ok = if (p != \"\") { lift check(p) !{ .Denied :> false } } else { lift false }",
      "const vs = for (const x of [p]) { lift check(x) !{ .Denied :> false } }\n        const ok = vs[0]",
    ]) {
      const r = compileSource(LOGIN(decl));
      const d = r.errors.filter((e) => e.code === "E-ERROR-002");
      expect(d.length).toBeGreaterThanOrEqual(1);
      expect(d.some((e) => /written on a 'lift'/.test(e.message))).toBe(true);
    }
  });

  test("a rendered `for` body's `lift check(x) !{ … }`", () => {
    const r = compileSource(`type AuthErr:enum = { Denied }
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return "LOGGED IN"
    }
}
<ul>\${ for (const x of ["wrong"]) { lift check(x) !{ .Denied :> "rejected" } } }</ul>
`);
    expect(r.codes).toContain("E-ERROR-002");
  });

  test("a `match` on a failable call inside a value-form body (the type system never stamps it)", () => {
    expect(compileSource(LOGIN(
      "const ok = if (p != \"\") { const z = match check(p) { .Denied :> false\n        else :> true }\n        lift z } else { lift false }")).codes).toContain("E-ERROR-002");
    expect(compileSource(LOGIN(
      "const vs = for (const x of [p]) { const z = match check(x) { .Denied :> false\n        else :> true }\n        lift z }\n        const ok = vs[0]")).codes).toContain("E-ERROR-002");
  });

  test("the same `match` as a statement-form body is still handled (and rejects)", async () => {
    const page = await boot(LOGIN("let ok = false\n        if (p != \"\") { const z = match check(p) { .Denied :> false\n        else :> true }\n        ok = z }"));
    await page.click("#wrong");
    expect(page.text("#out")).toBe("rejected");
    await page.click("#right");
    expect(page.text("#out")).toBe("LOGGED IN");
  });

  test("inside an `<errorBoundary>`, a call in a value-form body is refused (no catch site tests it)", () => {
    const r = compileSource(`type AuthErr:enum = { Denied }
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
<errorBoundary fallback={<div id="fb">FALLBACK</div>}>
    \${ const ok = if (true) { lift check("wrong") } else { lift false } }
    <p id="out">\${ok ? "LOGGED IN" : "rejected"}</p>
</errorBoundary>
`);
    expect(r.codes).toContain("E-ERROR-002");
  });
});

// ---------------------------------------------------------------------------
// B — handled value forms compile, and a wrong password is rejected (executed)
// ---------------------------------------------------------------------------

describe("B — handled value forms compile and reject a wrong password", () => {
  const ok = [
    ["a handled declaration in the body", "const ok = if (p != \"\") { const z = check(p) !{ .Denied :> false }\n        lift z } else { lift false }"],
    ["a handled call in the condition", "const ok = if (check(p) !{ .Denied :> false }) { lift true } else { lift false }"],
    ["`let`, a handled declaration in the body", "let ok = if (p != \"\") { const z = check(p) !{ .Denied :> false }\n        lift z } else { lift false }"],
    ["a value-form `for`, a handled declaration in the body", "const vs = for (const x of [p]) { const z = check(x) !{ .Denied :> false }\n        lift z }\n        const ok = vs[0]"],
    ["a handled call in the `for` iterable", "const vs = for (const x of [check(p) !{ .Denied :> false }]) { lift x }\n        const ok = vs[0]"],
    ["an `else if` arm, handled", "const ok = if (p == \"\") { lift false } else if (p != \"x\") { const z = check(p) !{ .Denied :> false }\n        lift z } else { lift false }"],
  ];
  for (const [name, decl] of ok) {
    test(name, async () => {
      const page = await boot(LOGIN(decl));
      await page.click("#wrong");
      expect(page.text("#out")).toBe("rejected");
      await page.click("#right");
      expect(page.text("#out")).toBe("LOGGED IN");
    });
  }

  test("`?` inside a `!` function's value-form body propagates the failure", async () => {
    const page = await boot(LOGIN(
      // `inner` wraps the value, so an error that was NOT propagated would reach `ok` (truthy).
      "const r = inner(p) !{ .Denied :> [false] }\n        const ok = r[0]",
      "    function inner(p)! -> AuthErr {\n        const v = if (p != \"\") { const z = check(p)?\n        lift z } else { lift false }\n        return [v]\n    }"));
    await page.click("#wrong");
    expect(page.text("#out")).toBe("rejected");
    await page.click("#right");
    expect(page.text("#out")).toBe("LOGGED IN");
  });

  test("a non-failable value form is not reported", async () => {
    const page = await boot(LOGIN("const ok = if (plain(p)) { lift true } else { lift false }"));
    await page.click("#wrong");
    expect(page.text("#out")).toBe("rejected");
    await page.click("#right");
    expect(page.text("#out")).toBe("LOGGED IN");
  });

  test("lifting a NON-failable function as a value is not reported", () => {
    expect(compileSource(LOGIN("const g = if (p != \"\") { lift plain } else { lift plain }\n        const ok = g(p)")).codes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C — fails closed on a declaration key the walk has no class for
// ---------------------------------------------------------------------------

describe("C — an unclassified declaration key is read as a value position", () => {
  const env = {
    resolveOuter: (n) => (n === "check" ? "check" : null),
    parseStatements: () => null,
    parseExpr: () => null,
    parseGuardArms: () => null,
    matchArmBodyText: () => null,
  };
  const call = () => ({ kind: "call", callee: { kind: "ident", name: "check" }, args: [], optional: false });
  const found = (st) => { const out = []; forEachCallInStatement(st, "none", env, (c) => out.push(c)); return out; };

  test("a future key holding an expression", () => {
    expect(found({ kind: "const-decl", name: "ok", init: "", futureExpr: call() }).length).toBe(1);
  });
  test("a future key holding a wrapper around an expression", () => {
    expect(found({ kind: "const-decl", name: "ok", init: "", futureForm: { kind: "future-form", parts: [{ value: call() }] } }).length).toBe(1);
  });
  test("a future key holding statements", () => {
    expect(found({ kind: "const-decl", name: "ok", init: "", futureBody: [{ kind: "bare-expr", exprNode: call() }] }).length).toBe(1);
  });
  test("an inert key is not read", () => {
    expect(found({ kind: "const-decl", name: "ok", init: "", typeAnnotation: "bool", isConst: true }).length).toBe(0);
  });
  test("`init` text is read when no structured value is carried", () => {
    const envText = { ...env, parseExpr: (t) => (t === "check()" ? call() : null) };
    const out = [];
    forEachCallInStatement({ kind: "const-decl", name: "ok", init: "check()" }, "none", envText, (c) => out.push(c));
    expect(out.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D — every declaration key the AST builder writes is classified
// ---------------------------------------------------------------------------

describe("D — DECL_KEY_CLASSES covers every key ast-builder.js writes on a declaration", () => {
  const DECL_KINDS = new Set(["let-decl", "const-decl", "tilde-decl", "lin-decl", "state-decl"]);
  const src = readFileSync(resolve(import.meta.dir, "../../src/ast-builder.js"), "utf8");
  const tree = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });

  /** Keys of an object literal, including those of `...(c ? { k } : {})` spreads. */
  const objectKeys = (obj, out) => {
    for (const p of obj.properties) {
      if (p.type === "Property") {
        if (p.computed) out.add("<computed>");
        else out.add(p.key.type === "Identifier" ? p.key.name : String(p.key.value));
      } else if (p.type === "SpreadElement") {
        const a = p.argument;
        const arms = a.type === "ConditionalExpression" ? [a.consequent, a.alternate]
          : a.type === "LogicalExpression" ? [a.right] : [a];
        for (const arm of arms) {
          if (arm.type === "ObjectExpression") objectKeys(arm, out);
          else out.add(`<spread ${src.slice(a.start, a.end).slice(0, 40)}>`);
        }
      }
    }
  };
  const isDeclLiteral = (n) => n && n.type === "ObjectExpression" && n.properties.some((p) =>
    p.type === "Property" && !p.computed && (p.key.name === "kind" || p.key.value === "kind")
    && p.value.type === "Literal" && DECL_KINDS.has(p.value.value));

  const keys = new Set();
  const isFn = (n) => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";
  const children = (n, f) => { for (const k of Object.keys(n)) if (k !== "loc" && k !== "start" && k !== "end") f(n[k]); };
  const isScope = (n) => isFn(n) || n.type === "BlockStatement" || n.type === "Program" || n.type === "ForStatement"
    || n.type === "ForOfStatement" || n.type === "ForInStatement" || n.type === "CatchClause";
  /** name -> bound to a declaration literal, for the bindings of ONE scope (not nested ones). */
  const bindingsOf = (scopeNode) => {
    const m = new Map();
    const bindPattern = (p) => {
      if (!p) return;
      if (p.type === "Identifier") m.set(p.name, false);
      else if (p.type === "AssignmentPattern") bindPattern(p.left);
      else if (p.type === "RestElement") bindPattern(p.argument);
      else if (p.type === "ObjectPattern") p.properties.forEach((q) => bindPattern(q.value ?? q.argument));
      else if (p.type === "ArrayPattern") p.elements.forEach(bindPattern);
    };
    if (isFn(scopeNode)) scopeNode.params.forEach(bindPattern);
    if (scopeNode.type === "CatchClause") bindPattern(scopeNode.param);
    const go = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(go); return; }
      if (n !== scopeNode && isScope(n)) return;
      if (n.type === "VariableDeclarator") {
        if (n.id.type === "Identifier") m.set(n.id.name, (m.get(n.id.name) ?? false) || isDeclLiteral(n.init));
        else bindPattern(n.id);
      }
      children(n, go);
    };
    go(scopeNode);
    return m;
  };
  // Every declaration literal's keys, and every `x.k = …` where `x` resolves (lexically, to the
  // nearest scope that binds it) to a variable bound to a declaration literal.
  const stack = [];
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (isDeclLiteral(n)) objectKeys(n, keys);
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && !n.left.computed
        && n.left.object.type === "Identifier") {
      const name = n.left.object.name;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].has(name)) { if (stack[i].get(name)) keys.add(n.left.property.name); break; }
      }
    }
    if (isScope(n)) { stack.push(bindingsOf(n)); children(n, visit); stack.pop(); return; }
    children(n, visit);
  };
  visit(tree);

  test("the scan finds the declaration literals (sanity)", () => {
    for (const k of ["initExpr", "ifExpr", "forExpr", "matchExpr", "init", "name"]) expect(keys.has(k)).toBe(true);
  });

  test("every key is classified", () => {
    const missing = [...keys].filter((k) => !k.startsWith("__") && !DECL_KEY_CLASSES.has(k));
    expect(missing).toEqual([]);
  });

  // S469 follow-up (F7) — a key can also be written through a LOOP VARIABLE over a statement
  // list (`for (const st of prelude) st._handlerParamPrelude = true` — each prelude statement
  // is a `const-decl`), which the literal-bound scan above cannot see. Every such key is either
  // classified, a child-statement key the walk recurses into, or listed here with the reason it
  // never lands on a declaration (each assignment is guarded by a non-declaration kind / shape).
  const NOT_ON_A_DECLARATION = new Map([
    ["_bodyTopBareRun", "guarded: st.kind === \"bare-expr\""],
    ["_bodyTop", "guarded: b.type === \"logic\" (a block, not a statement)"],
    ["leaveStmt", "guarded: child.kind === \"match-arm-inline\""],
    ["propagateOperand", "guarded: child.kind === \"match-arm-inline\""],
    ["propagateOperandExpr", "guarded: child.kind === \"match-arm-inline\""],
    ["expr", "a reactive-ref record of an attribute value, not a statement"],
    ["tabSpan", "a diagnostic object"],
    ["fromHandlerStatementList", "a diagnostic object"],
  ]);
  const loopKeys = new Map();
  const visitLoops = (n, loopVars) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach((x) => visitLoops(x, loopVars)); return; }
    let lv = loopVars;
    if ((n.type === "ForOfStatement" || n.type === "ForInStatement") && n.left.type === "VariableDeclaration"
        && n.left.declarations[0].id.type === "Identifier") {
      lv = new Set(loopVars);
      lv.add(n.left.declarations[0].id.name);
    }
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && !n.left.computed
        && n.left.object.type === "Identifier" && lv.has(n.left.object.name)) {
      const line = src.slice(0, n.start).split("\n").length;
      loopKeys.set(n.left.property.name, [...(loopKeys.get(n.left.property.name) ?? []), line]);
    }
    children(n, (c) => visitLoops(c, lv));
  };
  visitLoops(tree, new Set());

  test("the loop-variable scan finds the parameter-prelude flag (sanity)", () => {
    expect(loopKeys.has("_handlerParamPrelude")).toBe(true);
  });

  test("every key written through a loop variable is classified, a child key, or not on a declaration", () => {
    const missing = [...loopKeys.keys()].filter((k) => !k.startsWith("__") && !DECL_KEY_CLASSES.has(k)
      && !STATEMENT_CHILD_KEYS.has(k) && !NOT_ON_A_DECLARATION.has(k));
    expect(missing.map((k) => `${k} (ast-builder.js:${loopKeys.get(k).join(",")})`)).toEqual([]);
  });

  // The declarations codegen synthesizes (`<formFor>` cells) are built after the walk, but are
  // classified too, so moving one into the builder stays covered.
  test("the keys of the declarations codegen synthesizes are classified", () => {
    const tsSrc = new Bun.Transpiler({ loader: "ts" }).transformSync(
      readFileSync(resolve(import.meta.dir, "../../src/codegen/emit-form-for.ts"), "utf8"));
    const synth = new Set();
    const go = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(go); return; }
      if (isDeclLiteral(n)) objectKeys(n, synth);
      children(n, go);
    };
    go(acorn.parse(tsSrc, { ecmaVersion: "latest", sourceType: "module" }));
    expect(synth.has("_formForSynth")).toBe(true);
    expect([...synth].filter((k) => !k.startsWith("__") && !DECL_KEY_CLASSES.has(k))).toEqual([]);
  });

  // S469 follow-up r2 (F2) — NON-declaration statements. The walk reads an expression tree under
  // any key; an object-valued key that is not one is classified (STMT_KEY_CLASSES) or read
  // conservatively. `return <markup>` (`markupNode`) and a `for` head pattern (`variable`) went
  // unread before r2. Every key the builder writes on a statement literal is either a child-
  // statement key, classified, or listed here as an expression tree / scalar (reviewed).
  const EXPR_OR_SCALAR_STMT_KEYS = new Set([
    "expr", "exprNode", "binding", "target", "method", "args", "argExprs", "path", "value", "valueExpr",
    "iterable", "iterExpr", "condition", "condExpr", "header", "partial", "headerExpr", "name", "fnKind",
    "isServer", "isGenerator", "canFail", "errorType", "test", "armArrow", "result", "resultExpr",
    "_onMountEffect", "raw", "exported", "fromExport", "route", "isHandleEscapeHatch", "label",
    "dependencies", "bodyRaw", "bodyExpr", "openerHadSpaceAfterLt",
    "typeAnnotation", "isAwait", "letBinder", "constBinder", "ruledHead", "isAsync", "hasReturnType",
    "returnTypeAnnotation", "isPure", "isPinned", "idempotentModifier",
    "objectLiteralArm", // a flag (#1473 / arm-body-statements.ts): the arm's value is its `exprNode`

    // `{ kind: "if-expr", ...ifNode }` / `{ kind: "for-expr", ...forNode }`: the spread is an
    // `if-stmt` / `for-stmt` node, whose own literal keys are checked by this same scan.
    "<spread ifNode>", "<spread forNode>",
  ]);
  const NON_DECL_STMT_KINDS = new Set([...VALUE_POSITION_STMT_KINDS, "if-expr", "for-expr"].filter((k) => !DECL_KINDS.has(k)));
  const stmtKeys = new Map();
  const visitStmtLits = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(visitStmtLits); return; }
    if (n.type === "ObjectExpression") {
      const kp = n.properties.find((p) => p.type === "Property" && !p.computed && p.key.name === "kind"
        && p.value.type === "Literal" && NON_DECL_STMT_KINDS.has(p.value.value));
      if (kp) {
        const ks = new Set();
        objectKeys(n, ks);
        for (const k of ks) stmtKeys.set(k, [...(stmtKeys.get(k) ?? []), kp.value.value]);
      }
    }
    children(n, visitStmtLits);
  };
  visitStmtLits(tree);

  test("the statement-literal scan finds `return-stmt.markupNode` (sanity)", () => {
    expect(stmtKeys.get("markupNode") ?? []).toContain("return-stmt");
  });

  test("every key ast-builder.js writes on a non-declaration statement is accounted for", () => {
    const missing = [...stmtKeys.keys()].filter((k) => !k.startsWith("__") && !["kind", "span", "id", "params", "cStyleParts"].includes(k)
      && !STATEMENT_CHILD_KEYS.has(k) && !STMT_KEY_CLASSES.has(k) && !EXPR_OR_SCALAR_STMT_KEYS.has(k));
    expect(missing.map((k) => `${k} (${[...new Set(stmtKeys.get(k))].join(",")})`)).toEqual([]);
  });

  test("an unclassified object-valued statement key is read (fails closed)", () => {
    const env = {
      resolveOuter: (n) => (n === "check" ? "check" : null),
      parseStatements: () => null, parseExpr: () => null, parseGuardArms: () => null, matchArmBodyText: () => null,
    };
    const call = { kind: "call", callee: { kind: "ident", name: "check" }, args: [], optional: false };
    const out = [];
    forEachCallInStatement({ kind: "return-stmt", futureNode: { wrap: { value: call } } }, "none", env, (c) => out.push(c));
    expect(out.length).toBe(1);
  });
});
