// Probe family `s1` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s1.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
export const SHAPES = {
  direct: { body: `if (!check(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  alias: { imports: `import { check as ck } from "./lib.scrml"`, body: `if (!ck(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  reexport: { imports: `import { check } from "./lib2.scrml"`, lib2: `\${\n  export { check } from "./lib.scrml"\n}\n`, body: `if (!check(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  reexportWrap: { imports: `import { check2 } from "./lib2.scrml"`, lib2: `\${\n  import { check } from "./lib.scrml"\n  export function check2(a, b) { return check(a, b) }\n}\n`, body: `if (!check2(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  optCall: { body: `if (!check?.(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  tmpl: { body: `const s = \`\${check(pass, row.pw)}\`\n    if (s != "true") { return "REJECTED" }\n    ${T}` },
  ternary: { body: `return check(pass, row.pw) ? "WELCOME" : "REJECTED"` },
  logical: { body: `const ok = row && check(pass, row.pw)\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  orFallback: { body: `const ok = check(pass, row.pw) || false\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  nullish: { body: `const ok = check(pass, row.pw) ?? false\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  spreadArgs: { body: `const args = [pass, row.pw]\n    if (!check(...args)) { return "REJECTED" }\n    ${T}` },
  stringCoerce: { body: `if (String(check(pass, row.pw)) != "true") { return "REJECTED" }\n    ${T}` },
  assignLater: { body: `let ok = false\n    ok = check(pass, row.pw)\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  objLit: { body: `const o = { ok: check(pass, row.pw) }\n    if (!o.ok) { return "REJECTED" }\n    ${T}` },
  arrLit: { body: `const a = [check(pass, row.pw)]\n    if (!a[0]) { return "REJECTED" }\n    ${T}` },
  newWrap: { body: `const o = new Object({ ok: check(pass, row.pw) })\n    if (!o.ok) { return "REJECTED" }\n    ${T}` },
  newArgs: { body: `const m = new Map([["ok", check(pass, row.pw)]])\n    if (!m.get("ok")) { return "REJECTED" }\n    ${T}` },
  localAlias: { body: `const fn = check\n    if (!fn(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  localLambdaWrap: { body: `const fn = (a, b) => check(a, b)\n    if (!fn(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  localBlockLambdaWrap: { body: `const fn = (a, b) => { return check(a, b) }\n    if (!fn(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  localFnDecl: { body: `function w(a, b) { return check(a, b) }\n    if (!w(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  topFnWrap: { top: `function w(a, b) { return check(a, b) }`, body: `if (!w(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  topLambdaWrap: { top: `const w = (a, b) => check(a, b)`, body: `if (!w(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  someCb: { body: `if (![1].some((x) => check(pass, row.pw))) { return "REJECTED" }\n    ${T}` },
  findCb: { body: `const hit = [row.pw].find((h) => check(pass, h))\n    if (!hit) { return "REJECTED" }\n    ${T}` },
  sortCb: { body: `const z = [1, 2].sort((a, b) => check(pass, row.pw) ? 1 : -1)\n    if (z[0] == 1) { return "REJECTED" }\n    ${T}` },
  defaultParam: { body: `const g = (ok = check(pass, row.pw)) => ok\n    if (!g()) { return "REJECTED" }\n    ${T}` },
  destrDefault: { body: `const { ok = check(pass, row.pw) } = {}\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  arrDestrDefault: { body: `const [ok = check(pass, row.pw)] = []\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  chained: { body: `if (check(pass, row.pw).toString() != "true") { return "REJECTED" }\n    ${T}` },
  whileCond: { body: `let n = 0\n    while (!check(pass, row.pw) && n < 1) { n = n + 1 }\n    if (n > 0) { return "REJECTED" }\n    ${T}` },
  forOf: { body: `let good = false\n    for (const h of [row.pw]) { if (check(pass, h)) { good = true } }\n    if (!good) { return "REJECTED" }\n    ${T}` },
  matchArm: { body: `const ok = check(pass, row.pw)\n    match ok {\n      true => { return "WELCOME" }\n      else => { return "REJECTED" }\n    }` },
  compareEq: { body: `if (check(pass, row.pw) == false) { return "REJECTED" }\n    ${T}` },
  notIs: { body: `if (check(pass, row.pw) is not true) { return "REJECTED" }\n    ${T}` },
  doubleNeg: { body: `const ok = !!check(pass, row.pw)\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  commaSeq: { body: `let ok = false\n    for (let i = 0, j = check(pass, row.pw); i < 1; i++) { ok = j }\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  iife: { body: `const ok = (() => check(pass, row.pw))()\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  callInIndex: { body: `const t = { true: "Y", false: "N" }\n    if (t[check(pass, row.pw)] != "Y") { return "REJECTED" }\n    ${T}` },
  tagged: { body: `const tg = (s, v) => v\n    if (!tg\`x\${check(pass, row.pw)}\`) { return "REJECTED" }\n    ${T}` },
};
