// Probe family `n6` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r6/probes2/n6.mjs`, r6 (S465/S466 await review round 6).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const B = `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + w(name)`;
export const SHAPES = {
  syncFnStrParen: { top: `const w = function (a, s = ")") {\n    return a.trim() + s\n  }`, body: B },
  syncArrowDefaultLambda: { top: `const w = (a, k = (x) => x) => {\n    return k(a.trim())\n  }`, body: B },
  syncArrowStrArrow: { top: `const w = (a, s = "=>") => {\n    return a.trim() + s\n  }`, body: B },
  syncInFnStrParen: { body: `const w = function (a, s = ")") {\n      return a.trim() + s\n    }\n    ${B}` },
  syncInFnArrowDefault: { body: `const w = (a, k = (x) => x) => {\n      return k(a.trim())\n    }\n    ${B}` },
};
