export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const L = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
const BG = R(`!g(pass, row.pw)`);
const L2 = L(`export function vp(p, h) { return verifyPassword(p, h) }`);
export const SHAPES = {
  // no binding: async fn as argument / HOF
  hofId: { top: `function id(x) { return x }`, body: R(`!id(check)(pass, row.pw)`) },
  hofCall2: { top: `function call2(fn, a, b) { return fn(a, b) }`, body: R(`!call2(check, pass, row.pw)`) },
  hofCall2Lib: { lib: L(`function call2(fn, a, b) { return fn(a, b) }\n  export function check(p, h) { if (!call2(verifyPassword, p, h)) { return false }\n    return true }`), body: R(`!check(pass, row.pw)`) },
  paramShadowRun: { top: `function run(check, p, h) { const g = check\n    return g(p, h) }`, body: R(`!run(check, pass, row.pw)`) },
  paramStore: { top: `function wrap(fn) { const g = fn\n    return g }`, body: R(`!wrap(check)(pass, row.pw)`) },
  factoryDecl: { top: `function mk() { return check }`, body: `const g = mk()\n    ` + BG },
  factoryDeclLib: { lib: L(`function mk() { return verifyPassword }\n  export function check(p, h) { const g = mk()\n    if (!g(p, h)) { return false }\n    return true }`), body: R(`!check(pass, row.pw)`) },
  factoryParam: { top: `function pick(a, b) { return a }`, body: `const g = pick(check, null)\n    ` + BG },
  // collection methods with async callbacks
  mapIdx: { body: `const ok = [row.pw].map((h) => check(pass, h))[0]\n    ` + R(`!ok`) },
  filterLen: { body: R(`[row.pw].filter((h) => check(pass, h)).length == 0`) },
  findCb: { body: R(`[row.pw].find((h) => check(pass, h)) == null`) },
  everyCb: { body: R(`![row.pw].every((h) => check(pass, h))`) },
  reduceCb: { body: R(`![row.pw].reduce((acc, h) => acc && check(pass, h), true)`) },
  mapRetFn: { body: `const g = [1].map(() => check)[0]\n    ` + BG },
  mapRetFn2: { body: `const g = [check].map((x) => x)[0]\n    ` + BG },
  // namespace / destructure
  nsDestructure: { imports: `import * as ns from "./lib.scrml"`, body: `const { check } = ns\n    ` + R(`!check(pass, row.pw)`) },
  nsIndex: { imports: `import * as ns from "./lib.scrml"`, body: `const g = ns["check"]\n    ` + BG },
  nsCall: { imports: `import * as ns from "./lib.scrml"`, body: R(`!ns.check(pass, row.pw)`) },
  // re-export alias
  reexportAlias: { lib2: L2, lib: `\${\n  export { vp as check } from "./lib2.scrml"\n}\n`, body: R(`!check(pass, row.pw)`) },
  reexportAliasBind: { lib2: L2, lib: `\${\n  export { vp as check } from "./lib2.scrml"\n}\n`, body: `const g = check\n    ` + BG },
  importAs: { imports: `import { check as c9 } from "./lib.scrml"`, body: `const g = c9\n    ` + BG },
  importAsHof: { imports: `import { check as c9 } from "./lib.scrml"`, top: `function call2(fn, a, b) { return fn(a, b) }`, body: R(`!call2(c9, pass, row.pw)`) },
  defaultExport: { lib: L(`export default function check(p, h) { return verifyPassword(p, h) }`), imports: `import check from "./lib.scrml"`, body: R(`!check(pass, row.pw)`) },
  // object return / spread
  objRet: { top: `function mk() { return { k: check } }`, body: R(`!mk().k(pass, row.pw)`) },
  spreadArr: { body: `const [g] = [check]\n    ` + BG },
  destructParam: { top: `function run({ fn }, p, h) { return fn(p, h) }`, body: R(`!run({ fn: check }, pass, row.pw)`) },
  // assignment to object member then call
  memberStore: { body: `const o = {}\n    o.k = check\n    ` + R(`!o.k(pass, row.pw)`) },
  // optional chain / await-like
  promiseThen: { body: `let ok = false\n    check(pass, row.pw).then((v) => { ok = v })\n    ` + R(`!ok`) },
  // caller-context helper via alias in server fn (sync helper peer)
  ctxHelperAlias: { top: `function eq(a, b) { return a == b }`, body: `const g = eq\n    ` + R(`!g(pass, "right-password")`) },
  ctxHelperHof: { top: `function eq(a, b) { return a == b }\n  function call2(fn, a, b) { return fn(a, b) }`, body: R(`!call2(eq, pass, "right-password")`) },
  ctxHelperSome: { top: `function eq(a, b) { return a == b }`, body: `const g = eq\n    ` + R(`![1].some(() => g(pass, "right-password"))`) },
  ctxHelperTern: { top: `function eq(a, b) { return a == b }`, body: `const g = true ? eq : null\n    ` + R(`!g(pass, "right-password")`) },
  ctxHelperDbAlias: { top: `function eqdb(a, b) { const r = ?{\`SELECT 1 AS one\`}.get()\n    return a == b }`, body: `const g = eqdb\n    ` + R(`!g(pass, "right-password")`) },
};
