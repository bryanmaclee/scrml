// Probe family `n3` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r6/probes2/n3.mjs`, r6 (S465/S466 await review round 6).
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
export const SHAPES = {
  schedNameDirect: { top: `function setTimeout(p, h) { return check(p, h) }`, body: R(`!setTimeout(pass, row.pw)`) },
  schedNameQueue: { top: `function queueMicrotask(p, h) { return check(p, h) }`, body: R(`!queueMicrotask(pass, row.pw)`) },
  runLambda: { top: `function run(cb, a, b) { return cb(a, b) }`, body: R(`!run((a, b) => check(a, b), pass, row.pw)`) },
  runLambdaSync: { top: `function run(cb, a, b) { return cb(a, b) }`, body: R(`!run((a, b) => a == "right-password", pass, row.pw)`) },
  schedShadowSyncLambda: { top: `function setTimeout(cb, a, b) { return cb(a, b) }`, body: R(`!setTimeout((a, b) => a == "right-password", pass, row.pw)`) },
  schedLambdaGlobal: { body: `setTimeout((a) => check(a, row.pw), 0, pass)\n    ${R("!check(pass, row.pw)")}` },
  schedShadowLambdaBlock: { top: `function setTimeout(cb, a, b) { return cb(a, b) }`, body: R(`!setTimeout((a, b) => { return check(a, b) }, pass, row.pw)`) },
  schedShadowLambdaNoArgs: { top: `function setTimeout(cb) { return cb() }`, body: R(`!setTimeout(() => check(pass, row.pw))`) },
  schedShadowLocal: { body: `const setTimeout = (cb, a, b) => cb(a, b)\n    ${R("!setTimeout((a, b) => check(a, b), pass, row.pw)")}` },
};
