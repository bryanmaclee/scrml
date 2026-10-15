// Probe family `n5` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r6/probes2/n5.mjs`, r6 (S465/S466 await review round 6).
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
export const SHAPES = {
  splitArrowDefaultLambda: { top: `const w = (a, b, k = (x) => x) => {\n    return check(a, b)\n  }`, body: R(`!w(pass, row.pw)`) },
  splitArrowDefaultLambdaExpr: { top: `const w = (a, b, k = (x) => x) => check(a, b)`, body: R(`!w(pass, row.pw)`) },
  splitFnStrParen: { top: `const w = function (a, b, s = ")") {\n    return check(a, b)\n  }`, body: R(`!w(pass, row.pw)`) },
  splitArrowStrArrow: { top: `const w = (a, b, s = "=>") => {\n    return check(a, b)\n  }`, body: R(`!w(pass, row.pw)`) },
  libSplitArrowDefault: { lib: L(`const inner = (p, h, k = (x) => x) => {\n    return verifyPassword(p, h)\n  }\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libSplitFnStrParen: { lib: L(`const inner = function (p, h, s = ")") {\n    return verifyPassword(p, h)\n  }\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libSplitArrowStrArrow: { lib: L(`const inner = (p, h, s = "=>") => {\n    return verifyPassword(p, h)\n  }\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libExportConstTypeAnn: { lib: L(`const inner: (p: string, h: string) => boolean = (p, h) => verifyPassword(p, h)\n  export function check(p, h) { return inner(p, h) }`), body: B },
  shadowParamSyncSort: { top: `const w = (a, b) => check(a, b)\n  function h(w) { return [2, 1].sort((x, y) => w(x, y)) }`, body: `const z = h((x, y) => x - y)\n    ${B}` },
  libShadowLocal: { lib: L(`const inner = (p, h) => verifyPassword(p, h)\n  export function check(p, h) {\n    const r = inner(p, h)\n    return r\n  }`), body: B },
  libVarLambda: { lib: L(`var inner = (p, h) => verifyPassword(p, h)\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libLambdaInServerBlock: { lib: L(`export function check(p, h) { return wrap(p, h) }\n  const wrap = (p, h) => verifyPassword(p, h) && true`), body: B },
  libGenericArrow: { lib: L(`const inner = async (p, h) => verifyPassword(p, h)\n  export function check(p, h) { return inner(p, h) }`), body: B },
};
