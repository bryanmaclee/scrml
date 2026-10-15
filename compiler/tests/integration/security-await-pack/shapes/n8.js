// Probe family `n8` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r6/probes2/n8.mjs`, r6 (S465/S466 await review round 6).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = ``;
const B = `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`;
const L = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
const IF = `export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`;
export const SHAPES = {
  libFnDeclIf: { lib: L(`function inner(p, h) { return verifyPassword(p, h) }\n  ` + IF), body: B },
  libExportedSiblingIf: { lib: L(`export function inner(p, h) { return verifyPassword(p, h) }\n  ` + IF), body: B },
  libFnDeclImportIf: { lib2: L(`export function vp(p, h) { return verifyPassword(p, h) }`), lib: `\${\n  import { vp } from "./lib2.scrml"\n  function inner(p, h) { return vp(p, h) }\n  ${IF}\n}\n`, body: B },
  libFnDeclTwoHop: { lib: L(`function inner0(p, h) { return verifyPassword(p, h) }\n  function inner(p, h) { return inner0(p, h) }\n  ` + IF), body: B },
  libFnDeclTernary: { lib: L(`function inner(p, h) { return verifyPassword(p, h) }\n  export function check(p, h) { return inner(p, h) ? true : false }`), body: B },
  libFnDeclSql: { lib: `\${\n  function hasUser(n) { return ?{\`SELECT 1 AS x FROM users WHERE name = \${n}\`}.get() }\n  export function check(p, h) {\n    if (!hasUser("nobody-zz")) { return false }\n    return true\n  }\n}\n`, body: B },
  libFnDeclServerKw: { lib: L(`server function inner(p, h) { return verifyPassword(p, h) }\n  ` + IF), body: B },
  appFnDeclIf: { lib: L(`export function vp(p, h) { return verifyPassword(p, h) }`), imports: `import { vp } from "./lib.scrml"`, top: `function inner(p, h) { return vp(p, h) }\n  function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`, body: B },
};
