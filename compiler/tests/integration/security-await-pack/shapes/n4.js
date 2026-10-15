// Probe family `n4` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r6/probes2/n4.mjs`, r6 (S465/S466 await review round 6).
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
  stdSchedShadowTop: { imports: `import { verifyPassword } from "scrml:auth"`, top: `function setTimeout(cb) { return cb() }`, body: R(`!setTimeout(() => verifyPassword(pass, row.pw))`) },
  stdSchedShadowLocal: { imports: `import { verifyPassword } from "scrml:auth"`, body: `const setTimeout = (cb) => cb()\n    ${R("!setTimeout(() => verifyPassword(pass, row.pw))")}` },
  stdSchedShadowParam: { imports: `import { verifyPassword } from "scrml:auth"`, top: `function g(setTimeout, p, h) { return setTimeout(() => verifyPassword(p, h)) }\n  function run(cb) { return cb() }`, body: R(`!g(run, pass, row.pw)`) },
  peerSchedShadowTop: { top: `function setTimeout(cb) { return cb() }\n  function peer(p, h) { return check(p, h) }`, body: R(`!setTimeout(() => peer(pass, row.pw))`) },
};
