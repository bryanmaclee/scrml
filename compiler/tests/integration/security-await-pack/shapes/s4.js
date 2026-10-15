// Probe family `s4` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s4.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

const L = (body) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${body}\n}\n`;
const B = `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`;
export const DEFAULT_LIB = L(`export function check(p, h) { return verifyPassword(p, h) }`);
export const SHAPES = {
  libLambda: { lib: L(`export const check = (p, h) => verifyPassword(p, h)`), body: B },
  libFnExpr: { lib: L(`export const check = function (p, h) { return verifyPassword(p, h) }`), body: B },
  libInner: { lib: L(`function inner(p, h) { return verifyPassword(p, h) }\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libInnerLambda: { lib: L(`const inner = (p, h) => verifyPassword(p, h)\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libLocalVar: { lib: L(`export function check(p, h) {\n    const ok = verifyPassword(p, h)\n    if (!ok) { return false }\n    return true\n  }`), body: B },
  libTernary: { lib: L(`export function check(p, h) { return verifyPassword(p, h) ? true : false }`), body: B },
  libHatch: { lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  type R:enum = { Found(name:string), Missing }\n  export function check(p, h) {\n    const r = [verifyPassword(p, h), .Found(name: "c")]\n    return r[0]\n  }\n}\n`, body: B },
  libAliasStd: { lib: `\${\n  import { verifyPassword as vp } from "scrml:auth"\n  export function check(p, h) { return vp(p, h) }\n}\n`, body: B },
  libReexportStd: { lib: `\${\n  export { verifyPassword as check } from "scrml:auth"\n}\n`, body: B },
  libReexportStdPlain: { lib: `\${\n  export { verifyPassword } from "scrml:auth"\n}\n`, imports: `import { verifyPassword } from "./lib.scrml"`, body: `if (!verifyPassword(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` },
  libSomeCb: { lib: L(`export function check(p, h) { return [h].some((x) => verifyPassword(p, x)) }`), body: B },
  libObjExport: { lib: L(`export const auth = { check: (p, h) => verifyPassword(p, h) }`), imports: `import { auth } from "./lib.scrml"`, body: `if (!auth.check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` },
  libStarImport: { imports: `import * as Lb from "./lib.scrml"`, body: `if (!Lb.check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` },
  libDefault: { lib: L(`export default function check(p, h) { return verifyPassword(p, h) }`), imports: `import check from "./lib.scrml"`, body: B },
  libChainReexport3: { imports: `import { check } from "./lib2.scrml"`, lib2: `\${\n  export { check } from "./lib.scrml"\n}\n`, lib: `\${\n  export { verifyPassword as check } from "scrml:auth"\n}\n`, body: B },
  libHashCompare: { lib: L(`export function check(p, h) { return verifyPassword(p, h) == true }`), body: B },
  libDestrParam: { lib: L(`export function check({ p, h }) { return verifyPassword(p, h) }`), body: `if (!check({ p: pass, h: row.pw })) { return "REJECTED" }\n    return "WELCOME"` },
  libDefaultParam: { lib: L(`export function check(p, h = "x") { return verifyPassword(p, h) }`), body: B },
};
