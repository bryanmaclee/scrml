// Probe family `s9` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s9.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const I = `import { check } from "./lib.scrml"\n  type R:enum = { Found(name:string), Missing }`;
const TL = `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + String(v)`;
const S = (body) => ({ imports: I, body: body + `\n    ${TL}` });
export const SHAPES = {
  topOneLine: S(`const r: R = R.Found("q")\n    const v = match r { .Found(n) :> n .Missing :> "m" }`),
  arrowMultiLine: S(`const g = (r) => {\n      return match r {\n        .Found(n) :> n\n        .Missing :> "m"\n      }\n    }\n    const v = g(R.Found("q"))`),
  arrowMultiLineNoCall: S(`const g = (r) => {\n      return match r {\n        .Found(n) :> n\n        .Missing :> "m"\n      }\n    }\n    const v = g(R.Missing)`),
  arrowConstMatch: S(`const g = (r) => {\n      const s = match r {\n        .Found(n) :> n\n        .Missing :> "m"\n      }\n      return s\n    }\n    const v = g(R.Found("q"))`),
  fnDeclMatch: S(`function g(r) {\n      return match r {\n        .Found(n) :> n\n        .Missing :> "m"\n      }\n    }\n    const v = g(R.Found("q"))`),
  arrowMatchStmt: S(`const g = (r) => {\n      let s = "x"\n      match r {\n        .Found(n) => { s = n }\n        .Missing => { s = "m" }\n      }\n      return s\n    }\n    const v = g(R.Found("q"))`),
};
