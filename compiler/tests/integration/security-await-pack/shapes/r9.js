// Probe family `r9` — written by the S467 await fix round 9 (s465-await-imported-server-fn) while
// closing the reviewer's r8 findings: every other way a file-scope binding can hand out a function
// value — an `||` arm, a block-bodied arrow returning one, a reassigned `let`, an alias / curried /
// ternary export used straight from the app, a namespace member, a function stored in an object
// or array, the same shapes in the app's own top level.
// Data, not logic — same shape format as the reviewer families. Do not edit a shape to make it pass.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const L = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
const B = R(`!check(pass, row.pw)`);
const IF = `export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`;
export const SHAPES = {
  // function-decl returning an async literal
  fnReturnsLit: { lib: L(`function mk() { return (p, h) => verifyPassword(p, h) }\n  export function check(p, h) {\n    const g = mk()\n    if (!g(p, h)) { return false }\n    return true\n  }`), body: B },
  topFromFactory: { lib: L(`function mk() { return (p, h) => verifyPassword(p, h) }\n  const inner = mk()\n  ` + IF), body: B },
  localTernary: { lib: L(`export function check(p, h) {\n    const g = true ? (a, b) => verifyPassword(a, b) : (a, b) => false\n    if (!g(p, h)) { return false }\n    return true\n  }`), body: B },
  topTernaryApp: { top: `const g = true ? (a, b) => check(a, b) : (a, b) => false`, body: R(`!g(pass, row.pw)`) },
  topCurriedApp: { top: `const g = (a) => (b) => check(a, b)`, body: R(`!g(pass)(row.pw)`) },
  topParenApp: { top: `const g = ((a, b) => check(a, b))`, body: R(`!g(pass, row.pw)`) },
  topAsyncApp: { top: `const g = async (a, b) => check(a, b)`, body: R(`!g(pass, row.pw)`) },
  topAliasApp: { top: `const g = check`, body: R(`!g(pass, row.pw)`) },
  topOrApp: { top: `const g = null || ((a, b) => check(a, b))`, body: R(`!g(pass, row.pw)`) },
  libExportOr: { lib: L(`export const inner = null || ((p, h) => verifyPassword(p, h))\n  ` + IF), body: B },
  libExportObj: { lib: L(`const o = { f: (p, h) => verifyPassword(p, h) }\n  export function check(p, h) { if (!o.f(p, h)) { return false }\n    return true }`), body: B },
  libExportArr: { lib: L(`const o = [(p, h) => verifyPassword(p, h)]\n  export function check(p, h) { if (!o[0](p, h)) { return false }\n    return true }`), body: B },
  libExportNs: { lib: `\${\n  import * as auth from "scrml:auth"\n  export const inner = auth.verifyPassword\n  ${IF}\n}\n`, body: B },
  libExportBlockReturnsLit: { lib: L(`export const mk = (p) => {\n    return (h) => verifyPassword(p, h)\n  }\n  export function check(p, h) {\n    if (!mk(p)(h)) { return false }\n    return true\n  }`), body: B },
  libLetReassign: { lib: L(`let inner = (p, h) => true\n  inner = (p, h) => verifyPassword(p, h)\n  ` + IF), body: B },
  voCurried: { lib: L(`export const inner = (p) => (h) => verifyPassword(p, h)`), imports: `import { inner } from "./lib.scrml"`, body: R(`!inner(pass)(row.pw)`) },
  voTernary: { lib: L(`export const inner = true ? (p, h) => verifyPassword(p, h) : (p, h) => false`), imports: `import { inner } from "./lib.scrml"`, body: R(`!inner(pass, row.pw)`) },
  voAlias: { lib2: L(`export function vp(p, h) { return verifyPassword(p, h) }`), lib: `\${\n  import { vp } from "./lib2.scrml"\n  export const inner = vp\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: R(`!inner(pass, row.pw)`) },
};
