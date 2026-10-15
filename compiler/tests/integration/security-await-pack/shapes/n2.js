// Probe family `n2` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r6/probes2/n2.mjs`, r6 (S465/S466 await review round 6).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const B = `if (!check(pass, row.pw)) { return "REJECTED" }\n    ${T}`;
const L = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
export const SHAPES = {
  libInnerObj: { lib: L(`const impl = { v: (p, h) => verifyPassword(p, h) }\n  export function check(p, h) { return impl.v(p, h) }`), body: B },
  libInnerArr: { lib: L(`const impl = [(p, h) => verifyPassword(p, h)]\n  export function check(p, h) { return impl[0](p, h) }`), body: B },
  libInnerTernary: { lib: L(`const inner = true ? (p, h) => verifyPassword(p, h) : (p, h) => false\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libInnerParen: { lib: L(`const inner = ((p, h) => verifyPassword(p, h))\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libFnKeyword: { lib: L(`export fn check(p, h) { return verifyPassword(p, h) }`), body: B },
  libServerFn: { lib: L(`export server function check(p, h) { return verifyPassword(p, h) }`), body: B },
  libLambdaChain: { lib: L(`const a1 = (p, h) => verifyPassword(p, h)\n  const a2 = (p, h) => a1(p, h)\n  export function check(p, h) { return a2(p, h) }`), body: B },
  libLambdaChainRev: { lib: L(`const a2 = (p, h) => a1(p, h)\n  const a1 = (p, h) => verifyPassword(p, h)\n  export function check(p, h) { return a2(p, h) }`), body: B },
  libBlockLambda: { lib: L(`const inner = (p, h) => {\n    return verifyPassword(p, h)\n  }\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libLetLambda: { lib: L(`let inner = (p, h) => verifyPassword(p, h)\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libFnExprBinding: { lib: L(`const inner = function (p, h) { return verifyPassword(p, h) }\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libNestedFn: { lib: L(`export function check(p, h) {\n    function inner(a, b) { return verifyPassword(a, b) }\n    return inner(p, h)\n  }`), body: B },
  libLocalLambda: { lib: L(`export function check(p, h) {\n    const inner = (a, b) => verifyPassword(a, b)\n    return inner(p, h)\n  }`), body: B },
  libObjMethodShorthand: { lib: L(`const impl = { v(p, h) { return verifyPassword(p, h) } }\n  export function check(p, h) { return impl.v(p, h) }`), body: B },
  libFactory: { lib: L(`function mk() { return (p, h) => verifyPassword(p, h) }\n  const inner = mk()\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libDestrLambda: { lib: L(`const [inner] = [(p, h) => verifyPassword(p, h)]\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libBind: { lib: L(`const inner = verifyPassword.bind(null)\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libAliasStdConst: { lib: L(`const inner = verifyPassword\n  export function check(p, h) { return inner(p, h) }`), body: B },
  libTernaryInside: { lib: L(`export function check(p, h) { return h ? verifyPassword(p, h) : false }`), body: B },
  libReturnsNotNot: { lib: L(`export function check(p, h) { return !!verifyPassword(p, h) }`), body: B },
  libIfInside: { lib: L(`export function check(p, h) {\n    if (!verifyPassword(p, h)) { return false }\n    return true\n  }`), body: B },
  libStrMatchInside: { lib: L(`export function check(p, h) {\n    return match p {\n      "zz" => false\n      else => verifyPassword(p, h)\n    }\n  }`), body: B },
  libFailable: { lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  export type AE:enum = { Bad }\n  export function chk(p, h)! AE {\n    if (!verifyPassword(p, h)) fail .Bad\n    return true\n  }\n}\n`, imports: `import { chk } from "./lib.scrml"`, body: `const ok = chk(pass, row.pw) !{\n      _ :> false\n    }\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  libSomeDirect: { lib: L(`export function check(p, h) { return [h].some((x) => verifyPassword(p, x)) }`), body: B },
  libSql: { lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  export function check(p, h) { return verifyPassword(p, h) }\n  export function pwOf(n) { return ?{\`SELECT pw FROM users WHERE name = \${n}\`}.get().pw }\n}\n`, imports: `import { check, pwOf } from "./lib.scrml"`, body: `if (!check(pass, pwOf(name))) { return "REJECTED" }\n    ${T}` },
};
