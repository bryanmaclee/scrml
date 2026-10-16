// Probe family `m5` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r8/probes4/m5.mjs`, r8 (S466 await review round 8).
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
const B = R(`!check(pass, row.pw)`);
const IF = `export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`;
export const SHAPES = {
  // module-level names treated as locals?
  paramShadowSync: { top: `const w = (a, b) => check(a, b)\n  const v = (w, p, h) => !w(p, h)`, body: R(`v((a, b) => a == "right-password", pass, row.pw)`) },
  innerConstShadow: { top: `const w = (a, b) => check(a, b)\n  const v = (p, h) => {\n    const w = (a, b) => a == "right-password"\n    return !w(p, h)\n  }`, body: R(`v(pass, row.pw)`) },
  bindCallsFnDeclServer: { top: `function sv(a, b) { return check(a, b) }\n  const v = (p, h) => !sv(p, h)`, body: R(`v(pass, row.pw)`) },
  bindCallsLetBinding: { top: `let w = (a, b) => check(a, b)\n  const v = (p, h) => !w(p, h)`, body: R(`v(pass, row.pw)`) },
  bindCallsDestructuredFromImport: { top: `const v = (p, h) => !check(p, h) == true`, body: R(`v(pass, row.pw)`) },
  bindInMarkupNested: { app: null },
  // valueInit on exports
  libExportLetFn: { lib: L(`export let inner = (p, h) => verifyPassword(p, h)\n  ` + IF), body: B },
  libExportVarFn: { lib: L(`export var inner = (p, h) => verifyPassword(p, h)\n  ` + IF), body: B },
  libExportBlockAnn: { lib: L(`export const inner: (p: string, h: string) => boolean = (p, h) => {\n    return verifyPassword(p, h)\n  }\n  ` + IF), body: B },
  libExportFnExprAnn: { lib: L(`export const inner: (p: string, h: string) => boolean = function (p, h) { return verifyPassword(p, h) }\n  ` + IF), body: B },
  libExportMulti: { lib: L(`export const k = 1, inner = (p, h) => verifyPassword(p, h)\n  ` + IF), body: B },
  libExportParen: { lib: L(`export const inner = ((p, h) => verifyPassword(p, h))\n  ` + IF), body: B },
  libExportTernaryFn: { lib: L(`export const inner = true ? (p, h) => verifyPassword(p, h) : (p, h) => false\n  ` + IF), body: B },
  libExportImportedValue: { lib2: L(`export function vp(p, h) { return verifyPassword(p, h) }`), lib: `\${\n  import { vp } from "./lib2.scrml"\n  export const inner = vp\n  ${IF}\n}\n`, body: B },
  libExportBindingOfBinding: { lib: L(`const a1 = (p, h) => verifyPassword(p, h)\n  export const inner = (p, h) => !!a1(p, h)\n  ` + IF), body: B },
  libExportCurried: { lib: L(`export const mk = (p) => (h) => verifyPassword(p, h)\n  export function check(p, h) {\n    if (!mk(p)(h)) { return false }\n    return true\n  }`), body: B },
  // app imports an exported async value directly
  importExportedConst: { lib: L(`export const check = (p, h) => verifyPassword(p, h)`), body: B },
  importExportedConstAnn: { lib: L(`export const check: (p: string, h: string) => boolean = (p, h) => verifyPassword(p, h)`), body: B },
  importExportedConstNot: { lib: L(`export const check = (p, h) => !!verifyPassword(p, h)`), body: B },
  importExportedFnExpr: { lib: L(`export const check = function (p, h) {\n    if (!verifyPassword(p, h)) { return false }\n    return true\n  }`), body: B },
  importExportedLet: { lib: L(`export let check = (p, h) => verifyPassword(p, h)`), body: B },
  importExportedReassigned: { lib: L(`export let check = (p, h) => verifyPassword(p, h)\n  export function relax() { check = (p, h) => true }`), imports: `import { check, relax } from "./lib.scrml"`, body: B },
  importReexportedConst: { lib2: L(`export const vp = (p, h) => verifyPassword(p, h)`), lib: `\${\n  export { vp as check } from "./lib2.scrml"\n}\n`, body: B },
  importTwoHopConst: { lib2: L(`export const vp = (p, h) => verifyPassword(p, h)`), lib: `\${\n  import { vp } from "./lib2.scrml"\n  export const check = (p, h) => vp(p, h) == true\n}\n`, body: B },
};
delete SHAPES.bindInMarkupNested;
