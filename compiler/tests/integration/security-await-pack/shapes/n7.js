// Probe family `n7` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r6/probes2/n7.mjs`, r6 (S465/S466 await review round 6).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = ``;
const T = `return "WELCOME"`;
const B = `if (!check(pass, row.pw)) { return "REJECTED" }\n    ${T}`;
const L = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
const IN = `const inner = (p, h) => verifyPassword(p, h)\n  `;
export const SHAPES = {
  libBindIf: { lib: L(IN + `export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`), body: B },
  libBindNotNot: { lib: L(IN + `export function check(p, h) { return !!inner(p, h) }`), body: B },
  libBindTernary: { lib: L(IN + `export function check(p, h) { return inner(p, h) ? true : false }`), body: B },
  libBindSome: { lib: L(IN + `export function check(p, h) { return [h].some((x) => inner(p, x)) }`), body: B },
  libBindTemplate: { lib: L(IN + `export function check(p, h) { return \`\${inner(p, h)}\` == "true" }`), body: B },
  libBindLocalVar: { lib: L(IN + `export function check(p, h) {\n    const ok = inner(p, h)\n    return ok == true\n  }`), body: B },
  libBindObj: { lib: L(IN + `export function check(p, h) {\n    const o = { ok: inner(p, h) }\n    return o.ok == true\n  }`), body: B },
  libBindBlockIf: { lib: L(`const inner = (p, h) => {\n    if (!verifyPassword(p, h)) { return false }\n    return true\n  }\n  export function check(p, h) { return inner(p, h) == true }`), body: B },
  libImportIf: { lib2: L(`export function vp(p, h) { return verifyPassword(p, h) }`), lib: `\${\n  import { vp } from "./lib2.scrml"\n  export function check(p, h) {\n    if (!vp(p, h)) { return false }\n    return true\n  }\n}\n`, body: B },
  libImportBindIf: { lib2: L(`export function vp(p, h) { return verifyPassword(p, h) }`), lib: `\${\n  import { vp } from "./lib2.scrml"\n  const inner = (p, h) => vp(p, h)\n  export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }\n}\n`, body: B },
  libFnDeclIf: { lib: L(`function inner(p, h) { return verifyPassword(p, h) }\n  export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`), body: B },
};
