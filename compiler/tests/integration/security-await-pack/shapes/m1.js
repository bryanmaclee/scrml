// Probe family `m1` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r7/probes3/m1.mjs`, r7 (S466 await review round 7).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
  export function runIt(cb) { return cb() }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const CHK = `\${\n  import { verifyPassword } from "scrml:auth"\n  export function check(p, h) { return verifyPassword(p, h) }\n}\n`;
const app = (imports, top, body, markupExtra = "") => `<program db="./app.db">
\${
  ${imports}
  ${top}
  function f(name: string, pass: string) {
    const row = ?{\`SELECT name, pw FROM users WHERE name = \${name}\`}.get()
    ${body}
  }
}
<out> = ""
${markupExtra}
<button onclick={ @out = f("bob", "x") }>f</button>
<p>\${@out}</p>
</program>
`;
export const SHAPES = {
  nsImport: { imports: `import * as lib from "./lib.scrml"`, body: R(`!lib.check(pass, row.pw)`) },
  nsImportAlias: { imports: `import * as lib from "./lib.scrml"`, body: `const ok = lib.check(pass, row.pw)\n    ${R("!ok")}` },
  defaultExport: { lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  export default function check(p, h) { return verifyPassword(p, h) }\n}\n`, imports: `import check from "./lib.scrml"`, body: R(`!check(pass, row.pw)`) },
  nestedMarkupFn: { app: app(`import { check } from "./lib.scrml"`, ``, R(`!helper(pass, row.pw)`), `<div>\${\n  function helper(p, h) { return check(p, h) }\n}</div>`) },
  nestedMarkupLambda: { app: app(`import { check } from "./lib.scrml"`, ``, R(`!helper(pass, row.pw)`), `<div>\${\n  const helper = (p, h) => check(p, h)\n}</div>`) },
  nestedMarkupFnAfter: { app: app(`import { check } from "./lib.scrml"`, ``, R(`!helper(pass, row.pw)`), `<section><div>\${\n  function helper(p, h) {\n    if (!check(p, h)) { return false }\n    return true\n  }\n}</div></section>`) },
  topLetAssignLater: { top: `let w = (a, b) => false\n  w = (a, b) => check(a, b)`, body: R(`!w(pass, row.pw)`) },
  chain3: { imports: `import { check } from "./lib2.scrml"`, lib2: `\${\n  export { check } from "./lib3.scrml"\n}\n`, files: { "lib3.scrml": `\${\n  export { check } from "./lib.scrml"\n}\n` }, body: R(`!check(pass, row.pw)`) },
  chain3Alias: { imports: `import { c3 } from "./lib2.scrml"`, lib2: `\${\n  export { c2 as c3 } from "./lib3.scrml"\n}\n`, files: { "lib3.scrml": `\${\n  export { check as c2 } from "./lib.scrml"\n}\n` }, body: R(`!c3(pass, row.pw)`) },
  chain3Star: { imports: `import { check } from "./lib2.scrml"`, lib2: `\${\n  export * from "./lib3.scrml"\n}\n`, files: { "lib3.scrml": `\${\n  export * from "./lib.scrml"\n}\n` }, body: R(`!check(pass, row.pw)`) },
  chain3Wrap: { imports: `import { w2 } from "./lib2.scrml"`, lib2: `\${\n  import { w3 } from "./lib3.scrml"\n  function inner(p, h) { return w3(p, h) }\n  export function w2(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }\n}\n`, files: { "lib3.scrml": `\${\n  import { check } from "./lib.scrml"\n  const w = (p, h) => check(p, h)\n  export function w3(p, h) { return w(p, h) == true }\n}\n` }, body: R(`!w2(pass, row.pw)`) },
  cyclic: { imports: `import { check2 } from "./lib2.scrml"`, lib2: `\${\n  import { check } from "./lib.scrml"\n  export function check2(p, h) { return check(p, h) == true }\n  export function noop() { return 1 }\n}\n`, lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  import { noop } from "./lib2.scrml"\n  export function check(p, h) { return verifyPassword(p, h) }\n}\n`, body: R(`!check2(pass, row.pw)`) },
  schedDestructTop: { top: `const { setTimeout } = { setTimeout: (cb) => cb() }`, body: R(`!setTimeout(() => check(pass, row.pw))`) },
  schedDestructLocal: { body: `const { setTimeout } = { setTimeout: (cb) => cb() }\n    ${R("!setTimeout(() => check(pass, row.pw))")}` },
  schedArrDestructLocal: { body: `const [setTimeout] = [(cb) => cb()]\n    ${R("!setTimeout(() => check(pass, row.pw))")}` },
  schedBlockLet: { body: `if (name == "bob") {\n      let setTimeout = (cb) => cb()\n      if (!setTimeout(() => check(pass, row.pw))) { return "REJECTED" }\n    }\n    ${T}` },
  schedNestedParam: { body: `const run = (setTimeout) => setTimeout(() => check(pass, row.pw))\n    ${R("!run((cb) => cb())")}` },
  schedFnParam: { top: `function g(setTimeout, p, h) { return setTimeout(() => check(p, h)) }`, body: R(`!g((cb) => cb(), pass, row.pw)`) },
  schedImportAlias: { imports: `import { check, runIt as setTimeout } from "./lib.scrml"`, body: R(`!setTimeout(() => check(pass, row.pw))`) },
  schedForOf: { body: `for (const setTimeout of [(cb) => cb()]) {\n      if (!setTimeout(() => check(pass, row.pw))) { return "REJECTED" }\n    }\n    ${T}` },
  schedGlobalWrite: { top: `globalThis.setTimeout = (cb) => cb()`, body: R(`!setTimeout(() => check(pass, row.pw))`) },
  schedMeta: { top: `^{\n    const setTimeout = (cb) => cb()\n  }`, body: R(`!setTimeout(() => check(pass, row.pw))`) },
  schedLocalFnDecl: { body: `function setTimeout(cb) { return cb() }\n    ${R("!setTimeout(() => check(pass, row.pw))")}` },
  schedLibFnShadow: { lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  function setTimeout(cb) { return cb() }\n  export function check(p, h) {\n    if (!setTimeout(() => verifyPassword(p, h))) { return false }\n    return true\n  }\n}\n`, body: R(`!check(pass, row.pw)`) },
  schedLibLocalShadow: { lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  export function check(p, h) {\n    const setTimeout = (cb) => cb()\n    if (!setTimeout(() => verifyPassword(p, h))) { return false }\n    return true\n  }\n}\n`, body: R(`!check(pass, row.pw)`) },
  schedGlobalOk: { body: `setTimeout(() => check(pass, row.pw), 0)\n    ${R("!check(pass, row.pw)")}` },
};
