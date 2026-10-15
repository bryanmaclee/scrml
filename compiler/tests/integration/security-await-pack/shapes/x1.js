// Probe family `x1` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-s467-await-r8/x1.js` (S239 review of e4b2c24e4, await round 8).
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
const BI = R(`!inner(pass, row.pw)`);
const IF = `export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`;
const VO = (s) => ({ lib: L(s), imports: `import { inner } from "./lib.scrml"`, body: BI });
export const SHAPES = {
  asyncArrowExport: { lib: L(`export const inner = async (p, h) => verifyPassword(p, h)\n  ` + IF), body: B },
  asyncArrowExportAwait: { lib: L(`export const inner = async (p, h) => await verifyPassword(p, h)\n  ` + IF), body: B },
  asyncFnExprExport: { lib: L(`export const inner = async function (p, h) { return verifyPassword(p, h) }\n  ` + IF), body: B },
  parenFnExpr: { lib: L(`export const inner = (function (p, h) { return verifyPassword(p, h) })\n  ` + IF), body: B },
  parenArrowSingle: { lib: L(`export const inner = (p => (h) => verifyPassword(p, h))\n  export function check(p, h) { if (!inner(p)(h)) { return false }\n    return true }`), body: B },
  arrowParenBody: { lib: L(`export const inner = (p, h) => (verifyPassword(p, h))\n  ` + IF), body: B },
  arrowDefaultParam: { lib: L(`export const inner = (p, h = "x") => verifyPassword(p, h)\n  ` + IF), body: B },
  arrowDestructParam: { lib: L(`export const inner = ({ p, h }) => verifyPassword(p, h)\n  export function check(p, h) { if (!inner({ p: p, h: h })) { return false }\n    return true }`), body: B },
  // app-side direct use of exported values (value-only module path)
  voDirect: VO(`export const inner = (p, h) => verifyPassword(p, h)`),
  voAliasImport: { lib: `\${\n  import { verifyPassword as vpw } from "scrml:auth"\n  export const inner = (p, h) => vpw(p, h)\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: BI },
  voFnExpr: VO(`export const inner = function (p, h) { return verifyPassword(p, h) }`),
  voParen: VO(`export const inner = ((p, h) => verifyPassword(p, h))`),
  voAsyncArrow: VO(`export const inner = async (p, h) => verifyPassword(p, h)`),
  voLocalHelper: { lib: L(`function hp(p, h) { return verifyPassword(p, h) }\n  export const inner = (p, h) => hp(p, h)`), imports: `import { inner } from "./lib.scrml"`, body: BI },
  voImportFromScrml: { lib2: L(`export function vp(p, h) { return verifyPassword(p, h) }`), lib: `\${\n  import { vp } from "./lib2.scrml"\n  export const inner = (p, h) => vp(p, h)\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: BI },
  voImportAliasScrml: { lib2: L(`export function vp(p, h) { return verifyPassword(p, h) }`), lib: `\${\n  import { vp as zz } from "./lib2.scrml"\n  export const inner = (p, h) => zz(p, h)\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: BI },
  voImportNameInString: { lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  import { hashPassword } from "scrml:auth"\n  export const inner = (p, h) => verifyPassword(p, h)\n  export const s = "hashPassword"\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: BI },
  voReexport: { lib2: L(`export const vp = (p, h) => verifyPassword(p, h)`), lib: `\${\n  export { vp } from "./lib2.scrml"\n  import { vp } from "./lib2.scrml"\n  export const inner = (p, h) => vp(p, h)\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: BI },
  voShadowParam: { lib: L(`export const inner = (verifyPassword, h) => verifyPassword == "right-password"`), imports: `import { inner } from "./lib.scrml"`, body: BI },
  voTypeImportUse: { lib2: `\${\n  export type Role:enum = { Admin, User }\n}\n`, lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  import { Role } from "./lib2.scrml"\n  export const inner = (p, h) => verifyPassword(p, h)\n  export const r = (x) => x == Role.Admin\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: BI },
  voComponentImportUnused: { lib2: `\${\n  export const Badge = <span>hi</span>\n}\n`, lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  import { Badge } from "./lib2.scrml"\n  export const inner = (p, h) => verifyPassword(p, h)\n  export const k = (x) => typeof Badge\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: BI },
};
