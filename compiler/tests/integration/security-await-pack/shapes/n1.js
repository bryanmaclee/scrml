// Probe family `n1` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r6/probes2/n1.mjs`, r6 (S465/S466 await review round 6).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const L = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
export const SHAPES = {
  reexportLocal: { imports: `import { check } from "./lib2.scrml"`, lib2: `\${\n  import { check } from "./lib.scrml"\n  export { check }\n}\n`, body: R(`!check(pass, row.pw)`) },
  reexportAlias: { imports: `import { verify } from "./lib2.scrml"`, lib2: `\${\n  export { check as verify } from "./lib.scrml"\n}\n`, body: R(`!verify(pass, row.pw)`) },
  reexportAliasAlias: { imports: `import { verify as v } from "./lib2.scrml"`, lib2: `\${\n  export { check as verify } from "./lib.scrml"\n}\n`, body: R(`!v(pass, row.pw)`) },
  exportStar: { imports: `import { check } from "./lib2.scrml"`, lib2: `\${\n  export * from "./lib.scrml"\n}\n`, body: R(`!check(pass, row.pw)`) },
  paramDefaultTopFn: { top: `function g(p, h, ok = check(p, h)) { return ok }`, body: R(`!g(pass, row.pw)`) },
  nestedBoolean: { body: R(`!Boolean(check(pass, row.pw))`) },
  nestedUserId: { top: `function id(x) { return x }`, body: R(`!id(check(pass, row.pw))`) },
  nestedAsyncInAsync: { body: R(`!check(pass, check(pass, row.pw) ? row.pw : row.pw)`) },
  methodOnResult: { body: R(`check(pass, row.pw).valueOf() != true`) },
  destructResult: { lib: L(`export function info(p, h) { return { ok: verifyPassword(p, h) } }`), imports: `import { info } from "./lib.scrml"`, body: `const { ok } = info(pass, row.pw)\n    ${R("!ok")}` },
  destructResultArr: { lib: L(`export function info(p, h) { return [verifyPassword(p, h)] }`), imports: `import { info } from "./lib.scrml"`, body: `const [ok] = info(pass, row.pw)\n    ${R("!ok")}` },
  memberResult: { lib: L(`export function info(p, h) { return { ok: verifyPassword(p, h) } }`), imports: `import { info } from "./lib.scrml"`, body: R(`!info(pass, row.pw).ok`) },
  forHeaderTest: { body: `let n = 0\n    for (let i = 0; i < (check(pass, row.pw) ? 1 : 0); i++) { n = n + 1 }\n    ${R("n == 0")}` },
  forHeaderInit: { body: `let n = 0\n    for (let i = (check(pass, row.pw) ? 0 : 5); i < 1; i++) { n = n + 1 }\n    ${R("n == 0")}` },
  forOfHeaderCall: { body: `let n = 0\n    for (const v of (check(pass, row.pw) ? [1] : [])) { n = n + 1 }\n    ${R("n == 0")}` },
  ternaryArm: { body: `const ok = name == "bob" ? check(pass, row.pw) : false\n    ${R("!ok")}` },
  templateNested: { body: `const s = \`a\${name == "bob" ? \`\${check(pass, row.pw)}\` : "x"}\`\n    ${R('s != "atrue"')}` },
  handlerArm: { top: `type AE:enum = { X }\n  function boom(x)! AE {\n    if (x) fail .X\n    return false\n  }`, body: `const ok = boom(true) !{\n      .X :> check(pass, row.pw)\n    }\n    ${R("!ok")}` },
  handlerArmBlock: { top: `type AE:enum = { X }\n  function boom(x)! AE {\n    if (x) fail .X\n    return false\n  }`, body: `let ok = false\n    boom(true) !{\n      .X :> { ok = check(pass, row.pw) }\n    }\n    ${R("!ok")}` },
  propagate: { top: `type AE:enum = { Bad }\n  function g(p, h)! AE {\n    if (!check(p, h)) fail .Bad\n    return true\n  }\n  function g2(p, h)! AE {\n    const ok = g(p, h)?\n    return ok\n  }`, body: `const ok = g2(pass, row.pw) !{\n      .Bad :> false\n    }\n    ${R("!ok")}` },
  deferBody: { body: `let seen = "none"\n    defer { seen = String(check(pass, row.pw)) }\n    ${R("!check(pass, row.pw)")}` },
  topObjOfLambdas: { top: `const auth = { c: (a, b) => check(a, b) }`, body: R(`!auth.c(pass, row.pw)`) },
  topArrOfLambdas: { top: `const fns = [(a, b) => check(a, b)]`, body: R(`!fns[0](pass, row.pw)`) },
  topTernaryLambda: { top: `const w = true ? (a, b) => check(a, b) : (a, b) => check(a, b)`, body: R(`!w(pass, row.pw)`) },
  topParenLambda: { top: `const w = ((a, b) => check(a, b))`, body: R(`!w(pass, row.pw)`) },
  topLetReassign: { top: `let w = (a, b) => true`, body: `w = (a, b) => check(a, b)\n    ${R("!w(pass, row.pw)")}` },
  topFactory: { top: `function mk() { return (a, b) => check(a, b) }`, body: `const w = mk()\n    ${R("!w(pass, row.pw)")}` },
  topFactoryConst: { top: `function mk() { return (a, b) => check(a, b) }\n  const w = mk()`, body: R(`!w(pass, row.pw)`) },
  topBind: { top: `const w = check.bind(null)`, body: R(`!w(pass, row.pw)`) },
  chainReverse: { top: `const w2 = (a, b) => w1(a, b)\n  const w1 = (a, b) => check(a, b)`, body: R(`!w2(pass, row.pw)`) },
  bindingBlockUsesBinding: { top: `const w1 = (a, b) => check(a, b)\n  const w2 = (a, b) => {\n    if (!w1(a, b)) { return false }\n    return true\n  }`, body: R(`!w2(pass, row.pw)`) },
  calleeCond: { body: R(`!(true ? check : check)(pass, row.pw)`) },
  calleeParen: { body: R(`!(check)(pass, row.pw)`) },
  calleeIndex: { body: R(`![check][0](pass, row.pw)`) },
  bindingOptCall: { top: `const w = (a, b) => check(a, b)`, body: R(`!w?.(pass, row.pw)`) },
  bindingCallMember: { top: `const w = (a, b) => check(a, b)`, body: R(`!w.call(null, pass, row.pw)`) },
  checkCallMember: { body: R(`!check.call(null, pass, row.pw)`) },
  checkApply: { body: R(`!check.apply(null, [pass, row.pw])`) },
  schedShadow: { top: `function setTimeout(cb, a, b) { return cb(a, b) }`, body: R(`!setTimeout(check, pass, row.pw)`) },
  schedShadowBinding: { top: `function setTimeout(cb, a, b) { return cb(a, b) }\n  const w = (a, b) => check(a, b)`, body: R(`!setTimeout(w, pass, row.pw)`) },
  schedShadowLambda: { top: `function setTimeout(cb, a, b) { return cb(a, b) }`, body: R(`!setTimeout((a, b) => check(a, b), pass, row.pw)`) },
  topDestructLambda: { top: `const [w] = [(a, b) => check(a, b)]`, body: R(`!w(pass, row.pw)`) },
  topObjDestructLambda: { top: `const { w } = { w: (a, b) => check(a, b) }`, body: R(`!w(pass, row.pw)`) },
  bindingInSome: { top: `const w = (a, b) => check(a, b)`, body: R(`![row.pw].some((h) => w(pass, h))`) },
  bindingInTemplate: { top: `const w = (a, b) => check(a, b)`, body: `const s = \`\${w(pass, row.pw)}\`\n    ${R('s != "true"')}` },
  bindingInDestrDefault: { top: `const w = (a, b) => check(a, b)`, body: `const { ok = w(pass, row.pw) } = {}\n    ${R("!ok")}` },
  fnDeclViaLaterBinding: { top: `function w(a, b) { return inner(a, b) }\n  const inner = (a, b) => check(a, b)`, body: R(`!w(pass, row.pw)`) },
  bindingStrMatch: { top: `const w = (a, b) => match a {\n    "zz" => false\n    else => check(a, b)\n  }`, body: R(`!w(pass, row.pw)`) },
  sqlInBinding: { top: "const getPw = (n) => ?{`SELECT pw FROM users WHERE name = ${n}`}.get()", body: R(`!check(pass, getPw(name).pw)`) },
  sqlInBindingBlock: { top: "const getPw = (n) => {\n    return ?{`SELECT pw FROM users WHERE name = ${n}`}.get()\n  }", body: R(`!check(pass, getPw(name).pw)`) },
};
