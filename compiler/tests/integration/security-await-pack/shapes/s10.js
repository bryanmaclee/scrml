// Probe family `s10` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s10.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const C = `check(pass, row.pw)`;
const T = `return "WELCOME"`;
export const SHAPES = {
  destrParamDefaultSome: { body: `if (![{}].some(({ ok = ${C} }) => ok)) { return "REJECTED" }\n    ${T}` },
  destrParamDefaultMap: { body: `if (![{}].map(({ ok = ${C} }) => ok)[0]) { return "REJECTED" }\n    ${T}` },
  destrParamDefaultIife: { body: `const ok = (({ ok = ${C} }) => ok)({})\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  arrParamDefaultFind: { body: `const hit = [[]].find(([ok = ${C}]) => ok)\n    if (!hit) { return "REJECTED" }\n    ${T}` },
  destrDefaultInBlockArrow: { body: `const g = (o) => { const { ok = ${C} } = o\n      return ok }\n    if (!g({})) { return "REJECTED" }\n    ${T}` },
  destrParamDefaultBlock: { body: `const g = ({ ok = ${C} }) => { return ok }\n    if (!g({})) { return "REJECTED" }\n    ${T}` },
  destrParamDefaultFnDecl: { body: `function g({ ok = ${C} }) { return ok }\n    if (!g({})) { return "REJECTED" }\n    ${T}` },
  topDestrParamDefault: { top: `function g({ ok = check("a", "b") }) { return ok }`, body: `if (!g({})) { return "REJECTED" }\n    ${T}` },
  paramDefaultFnDecl: { body: `function g(p, h, ok = check(p, h)) { return ok }\n    if (!g(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  topParamDefault: { top: `function g(p, h, ok = check(p, h)) { return ok }`, body: `if (!g(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
};
