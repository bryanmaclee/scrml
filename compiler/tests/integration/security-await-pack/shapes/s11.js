// Probe family `s11` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s11.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
export const SHAPES = {
  topDefaultLit: { top: `function g(a, b = 5) { return b }`, body: `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + String(g(1))` },
  topDefaultCallSync: { top: `function g(a, b = String(7)) { return b }`, body: `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + String(g(1))` },
};
