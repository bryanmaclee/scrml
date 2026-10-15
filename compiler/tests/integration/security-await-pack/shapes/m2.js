// Probe family `m2` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r7/probes3/m2.mjs`, r7 (S466 await review round 7).
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
const W = `const w = (a, b) => check(a, b)`;
export const SHAPES = {
  objShorthandW: { top: W, body: `const o = { w }\n    ${R("!o.w(pass, row.pw)")}` },
  objKeyCheck: { body: `const o = { k: check }\n    ${R("!o.k(pass, row.pw)")}` },
  arrW: { top: W, body: `const a = [w]\n    ${R("!a[0](pass, row.pw)")}` },
  mapW: { top: W, body: `const m = new Map([["k", w]])\n    ${R("!m.get(\"k\")(pass, row.pw)")}` },
  returnW: { top: W + `\n  function pick() { return w }`, body: R(`!pick()(pass, row.pw)`) },
  arrayFromW: { top: W, body: `const r = Array.from([row.pw], (h) => w(pass, h))\n    ${R("!r[0]")}` },
  userHofW: { top: W + `\n  function drive(fn, a, b) { return fn(a, b) }`, body: R(`!drive(w, pass, row.pw)`) },
  userHofCheck: { top: `function drive(fn, a, b) { return fn(a, b) }`, body: R(`!drive(check, pass, row.pw)`) },
  ternaryValueW: { top: W, body: `const g = name == "bob" ? w : w\n    ${R("!g(pass, row.pw)")}` },
  logicalValueW: { top: W, body: `const g = name && w\n    ${R("!g(pass, row.pw)")}` },
  promiseNewW: { top: W, body: `const p2 = new Promise((res) => res(w(pass, row.pw)))\n    ${R("!p2")}` },
  closureCapture: { top: W, body: `const g = () => w(pass, row.pw)\n    ${R("!g()")}` },
  closureCaptureBlock: { top: W, body: `const g = () => {\n      return w(pass, row.pw)\n    }\n    ${R("!g()")}` },
  topClosureOverW: { top: W + `\n  const g = (p, h) => () => w(p, h)`, body: R(`!g(pass, row.pw)()`) },
  topCurried: { top: `const g = (p) => (h) => check(p, h)`, body: R(`!g(pass)(row.pw)`) },
  topBindingAwaitedInBinding: { top: W + `\n  const v = (p, h) => !w(p, h)`, body: R(`v(pass, row.pw)`) },
};
