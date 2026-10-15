// Probe family `m6` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r8/probes4/m6.mjs`, r8 (S466 await review round 8).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = ``;
const T = `return "WELCOME"`;
const B = `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + label("x")`;
const AUTH = `\${\n  import { verifyPassword } from "scrml:auth"\n  export function check(p, h) { return verifyPassword(p, h) }\n}\n`;
export const SHAPES = {
  voImportsClientFnLib: { files: { "auth.scrml": AUTH, "b.scrml": `\${\n  export function fmt(x) { return x + "!" }\n}\n` }, lib: `\${\n  import { fmt } from "./b.scrml"\n  export const label = (x) => fmt(x)\n}\n`, imports: `import { check } from "./auth.scrml"\n  import { label } from "./lib.scrml"`, body: B },
  voImportsPureFnLib: { files: { "auth.scrml": AUTH, "b.scrml": `\${\n  export fn fmt(x) { return x + "!" }\n}\n` }, lib: `\${\n  import { fmt } from "./b.scrml"\n  export const label = (x) => fmt(x)\n}\n`, imports: `import { check } from "./auth.scrml"\n  import { label } from "./lib.scrml"`, body: B },
  voImportsConstLib: { files: { "auth.scrml": AUTH, "b.scrml": `\${\n  export const BANG = "!"\n}\n` }, lib: `\${\n  import { BANG } from "./b.scrml"\n  export const label = (x) => x + BANG\n}\n`, imports: `import { check } from "./auth.scrml"\n  import { label } from "./lib.scrml"`, body: B },
  voImportsTypeOnly: { files: { "auth.scrml": AUTH, "b.scrml": `\${\n  export type Color:enum = { Red, Blue }\n}\n` }, lib: `\${\n  import { Color } from "./b.scrml"\n  export const label = (x) => x + "Color"\n}\n`, imports: `import { check } from "./auth.scrml"\n  import { label } from "./lib.scrml"`, body: B },
  voImportUnusedButInString: { files: { "auth.scrml": AUTH, "b.scrml": `\${\n  export function fmt(x) { return x + "!" }\n}\n` }, lib: `\${\n  import { fmt } from "./b.scrml"\n  export const label = (x) => x + " fmt"\n}\n`, imports: `import { check } from "./auth.scrml"\n  import { label } from "./lib.scrml"`, body: B },
  voImportsHost: { files: { "auth.scrml": AUTH }, lib: `\${\n  import { join } from "scrml:path"\n  export const label = (x) => join("a", x)\n}\n`, imports: `import { check } from "./auth.scrml"\n  import { label } from "./lib.scrml"`, body: B },
  voImportsAlias: { files: { "auth.scrml": AUTH, "b.scrml": `\${\n  export const BANG = "!"\n}\n` }, lib: `\${\n  import { BANG as B } from "./b.scrml"\n  export const label = (x) => x + B\n}\n`, imports: `import { check } from "./auth.scrml"\n  import { label } from "./lib.scrml"`, body: B },
};
