/**
 * S467 fix round 10 — dpa-023 F4 enforced in impl#1 (SPEC §13.9.6, PR #1430;
 * ruling:user-voice-scrml.md S467 "b it is" + "yes on the impl#1 enforce F4").
 *
 *   An async-colored function (§13.2) is bound ONLY by a `function` declaration. Every binding
 *   — file scope, a value-only library module, a nested scope — and every later write whose
 *   value is, or may be, an async-colored function is E-ASYNC-FN-ESCAPES-AS-VALUE. FAIL CLOSED:
 *   "may be" is read off the parsed tree (codegen/fn-valued-bindings.ts `mayHoldWaitingFn`) — a
 *   function value whose body references an async name, at any position of the initializer (the
 *   init itself, a ternary / `||` arm, an IIFE callee, a returned function, an object property);
 *   an async name used as anything but a direct callee (an alias, `.bind`, a sequence operand);
 *   text the compiler did not parse that names one.
 *
 *   Round 9 (e5155a5bb, DO-NOT-LAND) COLOURED `const f = (…) => waitingCall()` and treated any
 *   call / member / sequence init as "not a function" — `export const inner = (() => vp)()`,
 *   `= vp.bind(null)`, `= (() => (p, h) => vp(p, h))()`, `export const inner: any = …` were
 *   unseen and the importing route answered a wrong password WELCOME (security-await-pack y3).
 *
 * Executed wrong-password shapes: security-await-pack families y1, y2, y3 (+ all earlier ones).
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync, copyFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { mayHoldWaitingFn, waitingBindingsOf } from "../../src/codegen/fn-valued-bindings.ts";
import { ASYNC_COMBINATOR_METHODS } from "../../src/codegen/async-combinators.ts";
import { appSource, makeTemplateDb } from "./security-await-pack/pack.js";

const ESC = "E-ASYNC-FN-ESCAPES-AS-VALUE";
const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function compileFiles(tag, files, entry = "app.scrml") {
  const dir = mkdtempSync(join(tmpdir(), `s467-r10-${tag}-`));
  dirs.push(dir);
  for (const [n, src] of Object.entries(files)) writeFileSync(join(dir, n), src);
  copyFileSync(makeTemplateDb(dir), join(dir, "app.db"));
  const out = join(dir, "dist");
  const r = compileScrml({ inputFiles: [join(dir, entry)], write: true, outputDir: out, log: () => {} });
  const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const read = (n) => (existsSync(join(out, n)) ? readFileSync(join(out, n), "utf8") : null);
  return { errors: errs.map((e) => e.code), messages: errs.map((e) => String(e.message)), read };
}

const LIB = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
const DEFAULT_LIB = LIB(`export function check(p, h) { return verifyPassword(p, h) }`);
const BG = `if (!g(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`;
const app = (top, body = BG) => appSource({ top, body });
const VP2 = LIB(`export function vp(p, h) { return verifyPassword(p, h) }`);
const vo2 = (s) => ({
  "app.scrml": appSource({ imports: `import { inner } from "./lib.scrml"`, body: `if (!inner(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` }),
  "lib2.scrml": VP2,
  "lib.scrml": `\${\n  import { vp } from "./lib2.scrml"\n  ${s}\n}\n`,
});

describe("S467 r10 — the y3 shapes r9 accepted (wrong password WELCOME) are refused", () => {
  for (const [name, init] of Object.entries({
    vo2Iife: "export const inner = (() => vp)()",
    vo2IifeLit: "export const inner = (() => (p, h) => vp(p, h))()",
    vo2Bind: "export const inner = vp.bind(null)",
    vo2Annot: "export const inner: any = (() => vp)()",
    vo2Lambda: "export const inner = (p, h) => vp(p, h)",
  })) {
    test(`${name}: ${init}`, () => {
      const { errors, read } = compileFiles(name, vo2(init));
      expect(errors).toContain(ESC);
      expect(read("app.server.js")).toBeNull();
    }, 30_000);
  }
});

describe("S467 r10 — every binding form holding a waiting function is refused", () => {
  const cases = {
    constLambda: [app(`const g = (a, b) => check(a, b)`)],
    constAsyncArrow: [app(`const g = async (a, b) => check(a, b)`)],
    constFnExpr: [app(`const g = function (a, b) { return check(a, b) }`)],
    letLambda: [app(`let g = (a, b) => check(a, b)`)],
    ternaryArm: [app(`const g = true ? (a, b) => check(a, b) : (a, b) => false`)],
    curried: [app(`const mk = (a) => (b) => check(a, b)\n  const g = (a, b) => true`)],
    objectMethod: [app(`const o = { k: (a, b) => check(a, b) }\n  const g = (a, b) => true`)],
    alias: [app(`const g = check`)],
    // (a comma sequence is not scrml — §4.18.2 — so that precise refusal stands; the F4
    // refusal of its unreadable text is the backstop.)
    seq: [app(`const g = (0, check)`), "E-CODEGEN-INVALID-LOGIC"],
    bind: [app(`const g = check.bind(null)`)],
    iife: [app(`const g = (() => check)()`)],
    cast: [app(`const g = check as any`)],
    matchArm: [app(`const g = match 1 { 1 => check, else => (a, b) => false }`)],
    // MED-2 (y1 topLetIfWrite / y2 topLetIfLit): a write inside a file-scope `if` block.
    letWrittenInIf: [app(`let g = (a, b) => true\n  if (true) { g = check }`)],
    letWrittenInIfLit: [app(`let g = (a, b) => true\n  if (true) { g = (a, b) => check(a, b) }`)],
    letWritePlain: [app(`let g = (a, b) => true\n  g = check`)],
    logicalAssign: [app(`let g = null\n  g ||= check`)],
    nested: [app("", `const g = (a, b) => check(a, b)\n    ${BG}`)],
  };
  for (const [name, [src, code = ESC]] of Object.entries(cases)) {
    test(name, () => {
      const { errors, read } = compileFiles(name, { "app.scrml": src, "lib.scrml": DEFAULT_LIB });
      expect(errors).toContain(code);
      expect(read("app.server.js")).toBeNull();
    }, 30_000);
  }

  test("a value-only lib: `export const` lambda / alias / namespace member", () => {
    for (const [tag, lib] of [
      ["voLambda", LIB(`export const inner = (p, h) => verifyPassword(p, h)`)],
      ["voAlias", LIB(`export const inner = verifyPassword`)],
      ["voNs", `\${\n  import * as auth from "scrml:auth"\n  export const inner = auth.verifyPassword\n}\n`],
    ]) {
      const { errors } = compileFiles(tag, {
        "app.scrml": appSource({ imports: `import { inner } from "./lib.scrml"`, body: `if (!inner(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` }),
        "lib.scrml": lib,
      });
      expect(errors).toContain(ESC);
    }
  }, 60_000);

  test("the message names the binding and the `function` rewrite", () => {
    const { messages } = compileFiles("msg", { "app.scrml": app(`const g = (a, b) => check(a, b)`), "lib.scrml": DEFAULT_LIB });
    const m = messages.find((x) => x.startsWith(ESC));
    expect(m).toContain("`g` holds a value that is, or may be, an async function");
    expect(m).toContain("function g(…) { return … }");
    expect(m).toContain("§13.9.6");
  }, 30_000);
});

describe("S467 r10 — what stays legal", () => {
  const ok = {
    syncLambda: app(`const dbl = (x) => x * 2`, `if (dbl(2) != 4 || !check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`),
    syncTernary: app(`const eq = true ? (a, b) => a == b : (a, b) => false`, `if (!eq(1, 1) || !check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`),
    dataFromAsyncCall: app("", `const ok = check(pass, row.pw)\n    if (!ok) { return "REJECTED" }\n    return "WELCOME"`),
    combinatorCallback: app("", `const ok = [row.pw].some((h) => check(pass, h))\n    if (!ok) { return "REJECTED" }\n    return "WELCOME"`),
    paramShadow: app(`function w(a, b) { return check(a, b) }\n  const v = (w, p) => w(p)`, `if (v((x) => x == "right-password", pass) == false || !w(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`),
    functionDecl: app(`function g(a, b) { return check(a, b) }`),
  };
  for (const [name, src] of Object.entries(ok)) {
    test(name, () => {
      const { errors } = compileFiles(name, { "app.scrml": src, "lib.scrml": DEFAULT_LIB });
      expect(errors).toEqual([]);
    }, 30_000);
  }
});

describe("S467 r10 — the judge on parsed initializers (mayHoldWaitingFn)", () => {
  const asyncNames = ["vp", "check"];
  const isAsync = (n) => asyncNames.includes(n);
  const holds = (src) => mayHoldWaitingFn(parseExprToNode(src, "t", 0), isAsync, asyncNames, ASYNC_COMBINATOR_METHODS);
  test("may hold a waiting function", () => {
    for (const src of [
      "(p, h) => vp(p, h)", "vp", "(0, vp)", "vp.bind(null)", "(() => vp)()", "(() => (p, h) => vp(p, h))()",
      "c ? (p) => vp(p) : null", "null || ((p) => vp(p))", "{ k: (p) => vp(p) }", "[vp]", "wrap((p) => vp(p))",
      "(p) => (h) => vp(p, h)", "xs.map((x) => (h) => vp(x, h))",
    ]) expect([src, holds(src)]).toEqual([src, true]);
  });
  test("provably free of one", () => {
    for (const src of [
      "1", "\"vp\"", "vp(1, 2)", "check(a, b) ? 1 : 0", "(x) => x * 2", "xs.some((h) => vp(p, h))", "xs.filter(check)",
      "{ a: 1, b: [2, 3] }", "typeof vp", "(vp) => vp + 1",
    ]) expect([src, holds(src)]).toEqual([src, false]);
  });
  test("a later write is judged like an initializer; one report per binding", () => {
    const stmts = [
      { kind: "let-decl", name: "g", initExpr: parseExprToNode("(a) => true", "t", 0), span: { start: 1 } },
      { kind: "if-stmt", consequent: [{ kind: "tilde-decl", name: "g", initExpr: parseExprToNode("vp", "t", 0), span: { start: 2 } }] },
      { kind: "const-decl", name: "n", initExpr: parseExprToNode("vp(1)", "t", 0), span: { start: 3 } },
    ];
    const out = waitingBindingsOf(stmts, isAsync, asyncNames, ASYNC_COMBINATOR_METHODS);
    expect(out.map((w) => [w.name, w.how])).toEqual([["g", "written"]]);
  });
});

describe("S467 r10 — a server-placed SYNC helper reached by a first-class reference (§12.2 #284) is not a waiting function", () => {
  test("conformance server-db/first-class-fn-ref-server-helper-rt compiles", () => {
    const src = readFileSync(join(import.meta.dir, "../../../conformance/cases/server-db/first-class-fn-ref-server-helper-rt/case.scrml"), "utf8");
    const { errors } = compileFiles("ccp", { "app.scrml": src });
    expect(errors).toEqual([]);
  }, 30_000);
});

// r10 review finding (false refusal): a parameter or local of the ENCLOSING scope that shares
// a spelling with a file-scope async function is that parameter / local, not the async
// function. The binding judge resolves the name through the binding's lexical scope chain
// (codegen/fn-valued-bindings.ts `waitingBindingsOf`: enclosing functions' parameters, and each
// enclosing block's const / let / lin whose own value is not waiting).
describe("S467 r10 — the judge resolves a name through the binding's scope chain", () => {
  const EQ = `if (!eqx(1, 1) || !check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`;
  const VPI = `import { check } from "./lib.scrml"\n  import { verifyPassword } from "scrml:auth"`;
  const src = (top, imports) => appSource({ top, body: EQ, imports });
  const ok = {
    paramShadow: src(`function eqx(check, b) { const g = check\n    return g == b }`), // pack z4/fpParamShadow
    localShadow: src(`function eqx(a, b) { const check = 7\n    const g = check\n    return g == b }`), // reviewer ps3
    localLambdaShadow: src(`function eqx(a, b) { const check = (x, y) => x == y\n    const g = check\n    return g(a, b) }`), // z4/fpLocalShadow
    blockLocalSameBlock: src(`function eqx(a, b) { if (a) { const check = 7\n    const g = check\n    return g == b }\n    return false }`),
    outerLocalInnerBlock: src(`function eqx(a, b) { const check = 7\n    if (a) { const g = check\n    return g == b }\n    return false }`),
    paramCapturedByLambda: src(`function eqx(check, b) { const g = () => check\n    return g() == b }`),
  };
  for (const [name, s] of Object.entries(ok)) {
    test(`compiles: ${name}`, () => {
      const { errors } = compileFiles(name, { "app.scrml": s, "lib.scrml": DEFAULT_LIB });
      expect(errors).toEqual([]);
    }, 30_000);
  }
  // What the scope chain must NOT hide — each still refused, naming the binding that holds it.
  const still = {
    localAssignedAsync: [src(`function eqx(a, b) { const check2 = check\n    const g = check2\n    return g == b }`), "`check2` holds"],
    paramShadowReassignedReal: [src(`function eqx(check, b) { check = verifyPassword\n    const g = check\n    return g == b }`, VPI), "`check` is assigned"],
    paramReassignedAsync: [src(`function eqx(c2, b) { c2 = check\n    const g = c2\n    return g == b }`), "`c2` is assigned"],
    blockShadowBindingOutside: [src(`function eqx(a, b) { if (a) { const check = 7 }\n    const g = check\n    return g == b }`), "`g` holds"],
    blockShadowLambdaOutside: [src(`function eqx(a, b) { if (a) { const check = 7\n    }\n    const g = () => check(a, b)\n    return g == b }`), "`g` holds"],
    nestedFnCaptures: [src(`function eqx(a, b) { function inner() { return check(a, b) }\n    const g = inner\n    return g == b }`), "`inner` is an async function"],
    lambdaCapturesAsync: [src(`function eqx(a, b) { const g = () => check(a, b)\n    return g == b }`), "`g` holds"],
    localShadowWrittenWaiting: [src(`function eqx(a, b) { let check = 1\n    check = (x, y) => verifyPassword(x, y)\n    return check == b }`, VPI), "`check` is assigned"],
    localShadowWaitingInit: [src(`function eqx(a, b) { const check = () => verifyPassword(a, b)\n    const g = check\n    return g == b }`, VPI), "`g` holds"],
    siblingParamDoesNotLeak: [src(`function other(check) { return check }\n  function eqx(a, b) { const g = check\n    return g == b }`), "`g` holds"],
    realFnPassedToShadowParam: [src(`function eqx(a, b) { return other(check, b) }\n  function other(check, b) { const g = check\n    return g == b }`), "`check` is an async function"],
  };
  for (const [name, [s, msg]] of Object.entries(still)) {
    test(`still refused: ${name}`, () => {
      const { errors, messages, read } = compileFiles(name, { "app.scrml": s, "lib.scrml": DEFAULT_LIB });
      expect(errors).toContain(ESC);
      expect(messages.some((m) => m.startsWith(ESC) && m.includes(msg))).toBe(true);
      expect(read("app.server.js")).toBeNull();
    }, 30_000);
  }
  test("unit: a shadowing parameter / local hides the name; an outer-block binding does not", () => {
    const asyncNames = ["check"];
    const isAsync = (n) => asyncNames.includes(n);
    const e = (s) => parseExprToNode(s, "t", 0);
    const fn = (params, body) => ({ kind: "function-decl", name: "eqx", params: params.map((name) => ({ name })), body });
    const stmts = [
      fn(["check"], [{ kind: "const-decl", name: "g1", initExpr: e("check"), span: { start: 1 } }]),
      fn([], [{ kind: "const-decl", name: "check", initExpr: e("7"), span: { start: 2 } }, { kind: "const-decl", name: "g2", initExpr: e("check"), span: { start: 3 } }]),
      fn([], [{ kind: "if-stmt", consequent: [{ kind: "const-decl", name: "check", initExpr: e("7"), span: { start: 4 } }] },
        { kind: "const-decl", name: "g3", initExpr: e("check"), span: { start: 5 } }]),
      fn([], [{ kind: "const-decl", name: "check", initExpr: e("check"), span: { start: 6 } }, { kind: "const-decl", name: "g4", initExpr: e("check"), span: { start: 7 } }]),
      { kind: "const-decl", name: "g5", initExpr: e("check"), span: { start: 8 } },
    ];
    const out = waitingBindingsOf(stmts, isAsync, asyncNames, ASYNC_COMBINATOR_METHODS);
    expect(out.map((w) => w.name)).toEqual(["g3", "check", "g4", "g5"]);
  });
});

// S468 follow-up F1 (review of #1434; introduced by 933c6e51a): the scope chain must also
// REMOVE a name. A nested `function` declaration, a loop header or a destructuring that
// re-binds a shadowed spelling makes the name async-capable again for that scope, so a
// binding there that captures it holds a waiting function. Before: the shadow only ever
// grew, and F4 went silent on every shape below (they stayed refused only by the
// sync-callback backstop). Each now names the binding `g` again, as at 19458af1e.
describe("S468 F1 — a re-binding by `function` / loop header / destructuring drops the shadow", () => {
  const VPI = `import { check } from "./lib.scrml"\n  import { verifyPassword } from "scrml:auth"`;
  const RUN = `if (!run(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`;
  const RUN1 = `if (!run(1, pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`;
  const blockFn = (lam, kw = "const") => `function run(p, h) { const check = 1\n    if (p) { function check(a, b) { return verifyPassword(a, b) }\n      ${kw} g = ${lam}\n      return g(p, h) }\n    return false }`;
  const shapes = {
    reproducer: [blockFn(`(a, b) => check(a, b)`), RUN],
    paramShadow: [`function run(check, p, h) { if (p) { function check(a, b) { return verifyPassword(a, b) }\n      const g = (a, b) => check(a, b)\n      return g(p, h) }\n    return false }`, RUN1],
    innerFnBody: [`function run(p, h) { const check = 1\n    function inner(a, b) { function check(x, y) { return verifyPassword(x, y) }\n      const g = (x, y) => check(x, y)\n      return g(a, b) }\n    return inner(p, h) }`, RUN],
    innerFnBodyParamShadow: [`function run(check, p, h) { function inner(a, b) { function check(x, y) { return verifyPassword(x, y) }\n      const g = (x, y) => check(x, y)\n      return g(a, b) }\n    return inner(p, h) }`, RUN1],
    blockLambda: [blockFn(`(a, b) => { return check(a, b) }`), RUN],
    fnExpr: [blockFn(`function (a, b) { return check(a, b) }`), RUN],
    namedFnExpr: [blockFn(`function nm(a, b) { return check(a, b) }`), RUN],
    iife: [blockFn(`(() => (a, b) => check(a, b))()`), RUN],
    letG: [blockFn(`(a, b) => check(a, b)`, "let"), RUN],
    ternary: [blockFn(`p ? (a, b) => check(a, b) : (a, b) => false`), RUN],
    sameListAsParam: [`function run(check, p, h) { function check(a, b) { return verifyPassword(a, b) }\n    const g = (a, b) => check(a, b)\n    return g(p, h) }`, RUN1],
  };
  for (const [name, [top, body]] of Object.entries(shapes)) {
    test(`refused, naming \`g\`: ${name}`, () => {
      const { errors, messages, read } = compileFiles(`f1-${name}`, { "app.scrml": appSource({ top, body, imports: VPI }), "lib.scrml": DEFAULT_LIB });
      expect(errors).toContain(ESC);
      expect(messages.some((m) => m.startsWith(ESC) && m.includes("`g` holds"))).toBe(true);
      expect(read("app.server.js")).toBeNull();
    }, 30_000);
  }
  // The r10 false-refusal fix still holds where nothing re-binds the name.
  const EQ = `if (!eqx(1, 1) || !check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`;
  const ok = {
    paramShadowInLoop: `function eqx(check, b) { for (const x of [1]) { const g = check\n      return g == b }\n    return false }`,
    paramShadowBesideOtherFn: `function eqx(check, b) { function other(x) { return x }\n    const g = check\n    return other(g) == b }`,
    paramShadowInNestedBlock: `function eqx(check, b) { if (b) { if (check) { const g = check\n        return g == b } }\n    return false }`,
  };
  for (const [name, top] of Object.entries(ok)) {
    test(`compiles: ${name}`, () => {
      const { errors } = compileFiles(`f1ok-${name}`, { "app.scrml": appSource({ top, body: EQ }), "lib.scrml": DEFAULT_LIB });
      expect(errors).toEqual([]);
    }, 30_000);
  }
  test("unit: function-decl / loop header / destructuring / waiting local / unknown binder drop the shadow", () => {
    const asyncNames = ["check", "vp"];
    const isAsync = (n) => asyncNames.includes(n);
    const e = (s) => parseExprToNode(s, "t", 0);
    const g = (start) => ({ kind: "const-decl", name: `g${start}`, initExpr: e("check"), span: { start } });
    const fn = (params, body) => ({ kind: "function-decl", name: "eqx", params: params.map((name) => ({ name })), body });
    const stmts = [
      fn(["check"], [g(1)]), // param shadow: clean
      fn(["check"], [{ kind: "function-decl", name: "check", params: [], body: [] }, g(2)]), // re-bound by a function decl
      fn(["check"], [{ kind: "for-stmt", variable: "check", body: [g(3)] }]), // loop header re-binds
      fn(["check"], [{ kind: "for-stmt", variable: "x", body: [g(4)] }]), // other loop variable: clean
      fn(["check"], [{ kind: "if-stmt", consequent: [{ kind: "const-decl", name: { kind: "destructure-object", properties: [{ kind: "name", fieldName: "check", bindName: "check" }] }, initExpr: e("o"), span: { start: 5 } }, g(6)] }]),
      fn(["check"], [{ kind: "if-stmt", consequent: [{ kind: "let-decl", name: "check", initExpr: e("(a) => vp(a)"), span: { start: 7 } }, g(8)] }]), // waiting local re-binds
      fn(["check"], [{ kind: "match-stmt", body: [g(9)] }]), // an unlisted (binding) kind: no shadow inside
      fn(["check"], [{ kind: "for-stmt", variable: null, body: [g(10)] }]), // C-style header: no shadow inside
    ];
    const out = waitingBindingsOf(stmts, isAsync, asyncNames, ASYNC_COMBINATOR_METHODS);
    expect(out.map((w) => w.name)).toEqual(["g2", "g3", "g6", "check", "g8", "g9", "g10"]);
  });
});

// S468 follow-up F3 (review of #1434) — NOT taken, pinned here so it is not taken by accident.
// `const ranked = rows.sort((a, b) => verifyPassword(…) ? -1 : 1)` gets a second, misleadingly
// worded F4 error beside E-ASYNC-STDLIB-IN-SYNC-CALLBACK. Suppressing F4 for a sync-callback
// consumer's result (`.sort` / `.toSorted` / `.findLast` / `.findLastIndex` / `.reduceRight`)
// would be NEWLY ACCEPTING: for `.findLast` / `.findLastIndex` / `.reduceRight` over a lambda
// calling a file-scope helper that calls an imported async function, the sync-callback
// backstop does not fire and F4 is the only compile-time refusal (measured S468: with the
// suppression these compiled and failed only at run time, ReferenceError → 500).
describe("S468 F3 (not taken) — a consumer lambda over a file-scope async helper stays refused", () => {
  const VPI = `import { check } from "./lib.scrml"\n  import { verifyPassword } from "scrml:auth"`;
  const PR = `function pr(r) { return check(r.name, r.pw) }`;
  const body = (init) => `const rows = ?{\`SELECT name, pw FROM users\`}.all()\n    const ranked = ${init}\n    if (ranked.length == 0) { return "REJECTED" }\n    return "WELCOME"`;
  for (const [name, init] of Object.entries({
    findLast: `[rows.findLast((r) => pr(r))]`,
    findLastIndex: `[rows.findLastIndex((r) => pr(r))]`,
    reduceRight: `[rows.reduceRight((acc, r) => acc || pr(r), false)]`,
  })) {
    test(`${name}: refused at compile time`, () => {
      const { errors, read } = compileFiles(`f3-${name}`, { "app.scrml": appSource({ top: PR, body: body(init), imports: VPI }), "lib.scrml": DEFAULT_LIB });
      expect(errors).toContain(ESC);
      expect(read("app.server.js")).toBeNull();
    }, 30_000);
  }
});
