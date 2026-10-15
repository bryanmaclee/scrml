// Probe family `m3` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r7/probes3/m3.mjs`, r7 (S466 await review round 7).
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
const L = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
const B = R(`!check(pass, row.pw)`);
export const SHAPES = {
  bindNotBinding: { top: W + `\n  const v = (p, h) => !w(p, h)`, body: R(`v(pass, row.pw)`) },
  bindNotImport: { top: `const v = (p, h) => !check(p, h)`, body: R(`v(pass, row.pw)`) },
  bindEqImport: { top: `const v = (p, h) => check(p, h) == true`, body: R(`!v(pass, row.pw)`) },
  bindTernImport: { top: `const v = (p, h) => check(p, h) ? 1 : 0`, body: R(`v(pass, row.pw) == 0`) },
  bindAndImport: { top: `const v = (p, h) => h && check(p, h)`, body: R(`!v(pass, row.pw)`) },
  bindNotFnDecl: { top: `function w(a, b) { return check(a, b) }\n  const v = (p, h) => !w(p, h)`, body: R(`v(pass, row.pw)`) },
  bindNotServerFn: { top: `function pw(n) { return ?{\`SELECT pw FROM users WHERE name = \${n}\`}.get().pw }\n  const v = (p, n) => !check(p, pw(n))`, body: R(`v(pass, name)`) },
  bindTemplate: { top: `const v = (p, h) => \`\${check(p, h)}\``, body: R(`v(pass, row.pw) != "true"`) },
  fnDeclNotBinding: { top: W + `\n  function v(p, h) { return !w(p, h) }`, body: R(`v(pass, row.pw)`) },
  libBindNot: { lib: L(`const inner = (p, h) => !verifyPassword(p, h)\n  export function check(p, h) { return !inner(p, h) }`), body: B },
  libBindNotNot: { lib: L(`const inner = (p, h) => !!verifyPassword(p, h)\n  export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`), body: B },
  libBindEq: { lib: L(`const inner = (p, h) => verifyPassword(p, h) == true\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libBindChainNot: { lib: L(`const a1 = (p, h) => verifyPassword(p, h)\n  const a2 = (p, h) => !a1(p, h)\n  export function check(p, h) { return !a2(p, h) }`), body: B },
  clientIrrelevant: { top: W + `\n  const v = (p, h) => [w(p, h)][0]`, body: R(`!v(pass, row.pw)`) },
};
