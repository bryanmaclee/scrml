// Probe family `s13` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s13.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const TL = `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + String(v)`;
const S = (body) => ({ body: body + `\n    ${TL}` });
export const SHAPES = {
  arrowBlockReGroup: S(`const g = (s) => { return /b(o)/.test(s) }\n    const v = g(name)`),
  arrowExprReGroup: S(`const g = (s) => /b(o)/.test(s)\n    const v = g(name)`),
  mapReGroup: S(`const v = [name].map((s) => s.replace(/(o)/g, "0"))[0]`),
  topFnReGroup: { top: `function g(s) { return /b(o)/.test(s) }`, body: `const v = g(name)\n    ${TL}` },
  bigint: S(`const v = String(10n + 5n)`),
  seqExpr: S(`let a = 0\n    const v = (a = 2, a + 1)`),
};
