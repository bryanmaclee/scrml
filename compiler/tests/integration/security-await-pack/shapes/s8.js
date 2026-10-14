// Probe family `s8` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s8.mjs`, r5 (S465 await review round 5).
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
  reTest: S(`const v = /b(o)b/.test(name)`),
  reTestCaret: S(`const v = /^(b)/.test(name)`),
  reReplace: S(`const v = name.replace(/o(b)/g, "X")`),
  reMatch: S(`const v = name.match(/b(o)/)[1]`),
  reConst: S(`const re = /b(o)b/\n    const v = re.test(name)`),
  reDigit: S(`const v = /\\d(\\d)/.test("12")`),
  reEmail: S(`const v = /^[a-z]+@([a-z]+)\\.com$/.test("a@b.com")`),
  reInIf: S(`let v = "n"\n    if (/b(o)b/.test(name)) { v = "y" }`),
  reSplit: S(`const v = "a1b2".split(/[0-9](?=b)/).length`),
};
