// Probe family `s2` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s2.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
  export function vérifier(p, h) { return verifyPassword(p, h) }
  export function Check(p, h) { return verifyPassword(p, h) }
}
`;
const H = `if (!r[0]) { return "REJECTED" }\n    return "WELCOME"`;
export const SHAPES = {
  hatchCtl: { body: `const r = [check(pass, row.pw), .Found(name: "c")]\n    ${H}` , imports: `import { check } from "./lib.scrml"\n  type R:enum = { Found(name:string), Missing }`},
  hatchBlockCmt: { body: `const r = [check/**/(pass, row.pw), .Found(name: "c")]\n    ${H}` , imports: `import { check } from "./lib.scrml"\n  type R:enum = { Found(name:string), Missing }`},
  hatchLineCmt: { body: `const r = [check // c\n      (pass, row.pw), .Found(name: "c")]\n    ${H}` , imports: `import { check } from "./lib.scrml"\n  type R:enum = { Found(name:string), Missing }`},
  hatchUnicode: { body: `const r = [vérifier(pass, row.pw), .Found(name: "c")]\n    ${H}` , imports: `import { vérifier } from "./lib.scrml"\n  type R:enum = { Found(name:string), Missing }`},
  unicodeDirect: { body: `if (!vérifier(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` , imports: `import { vérifier } from "./lib.scrml"`},
  blockCmtDirect: { body: `if (!check/**/(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` },
  hatchCapMember: { body: `const L = { C: 1 }\n    const r = [L /*x*/ .Check(pass, row.pw), .Found(name: "c")]\n    ${H}` , imports: `import { Check } from "./lib.scrml"\n  type R:enum = { Found(name:string), Missing }`},
  capDirect: { body: `if (!Check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` , imports: `import { Check } from "./lib.scrml"`},
  hatchNewArg: { body: `const r = [new Boolean(check(pass, row.pw)).valueOf(), .Found(name: "c")]\n    ${H}` , imports: `import { check } from "./lib.scrml"\n  type R:enum = { Found(name:string), Missing }`},
  hatchStrParen: { body: `const r = ["(" + "x", .Found(name: "c")]\n    if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` , imports: `import { check } from "./lib.scrml"\n  type R:enum = { Found(name:string), Missing }`},
};
