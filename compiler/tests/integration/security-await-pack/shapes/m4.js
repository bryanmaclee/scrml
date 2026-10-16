// Probe family `m4` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r7/probes3/m4.mjs`, r7 (S466 await review round 7).
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
  appExportConst: { top: `export const w = (a, b) => check(a, b)`, body: R(`!w(pass, row.pw)`) },
  appExportConstAnn: { top: `export const w: (a: string, b: string) => boolean = (a, b) => check(a, b)`, body: R(`!w(pass, row.pw)`) },
  appConstAnn: { top: `const w: (a: string, b: string) => boolean = (a, b) => check(a, b)`, body: R(`!w(pass, row.pw)`) },
  libExportConstAnnInner: { lib: L(`export const inner: (p: string, h: string) => boolean = (p, h) => verifyPassword(p, h)\n  export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`), body: B },
  libExportConstInner: { lib: L(`export const inner = (p, h) => verifyPassword(p, h)\n  export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`), body: B },
};
