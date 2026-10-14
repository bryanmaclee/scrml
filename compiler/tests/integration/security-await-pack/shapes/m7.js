// Probe family `m7` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r8/probes4/m7.mjs`, r8 (S466 await review round 8).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = ``;
const B = `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + label("x")`;
const AUTH = `\${\n  import { verifyPassword } from "scrml:auth"\n  export function check(p, h) { return verifyPassword(p, h) }\n}\n`;
export const SHAPES = {
  voUsesEnumFromTypeLib: { files: { "auth.scrml": AUTH, "b.scrml": `\${\n  export type Color:enum = { Red, Blue }\n}\n` }, lib: `\${\n  import { Color } from "./b.scrml"\n  export const label = (x) => x + String(Color.Red)\n}\n`, imports: `import { check } from "./auth.scrml"\n  import { label } from "./lib.scrml"`, body: B },
  voUsesClientOnlyComponent: { files: { "auth.scrml": AUTH, "b.scrml": `\${\n  export const Badge = <span>hi</span>\n}\n` }, lib: `\${\n  import { Badge } from "./b.scrml"\n  export const label = (x) => x + typeof Badge\n}\n`, imports: `import { check } from "./auth.scrml"\n  import { label } from "./lib.scrml"`, body: B },
};
