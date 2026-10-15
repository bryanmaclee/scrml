// Probe family `s3` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s3.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const C = `check(pass, row.pw)`;
export const SHAPES = {
  orAssign: { body: `let ok = false\n    ok ||= ${C}\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  andAssign: { body: `let ok = true\n    ok &&= ${C}\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  nullAssign: { body: `let ok = not\n    ok ??= ${C}\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  plusAssign: { body: `let s = ""\n    s += ${C}\n    if (s != "true") { return "REJECTED" }\n    ${T}` },
  ifNoBrace: { body: `if (!${C}) return "REJECTED"\n    ${T}` },
  doWhile: { body: `let n = 0\n    do { n = n + 1 } while (!${C} && n < 3)\n    if (n > 1) { return "REJECTED" }\n    ${T}` },
  semicolons: { body: `const ok = ${C}; if (!ok) { return "REJECTED" }; ${T}` },
  oneLineIf: { body: `if (!${C}) { return "REJECTED" } else { ${T} }` },
  elseIf: { body: `if (pass == "zzz") { return "Z" } else if (!${C}) { return "REJECTED" }\n    ${T}` },
  nestedTernary: { body: `return pass == "" ? "E" : ${C} ? "WELCOME" : "REJECTED"` },
  returnMultiline: { body: `return (${C}\n      ? "WELCOME"\n      : "REJECTED")` },
  matchExpr: { body: `const ok = ${C}\n    const v = match ok { true => "WELCOME" else => "REJECTED" }\n    return v` },
  matchSubjectCall: { body: `const v = match ${C} { true => "WELCOME" else => "REJECTED" }\n    return v` },
  isSome: { body: `const ok = ${C}\n    if (ok is some && ok) { return "WELCOME" }\n    return "REJECTED"` },
  notOp: { body: `if (not ${C}) { return "REJECTED" }\n    ${T}` },
  inlineFnInIf: { body: `if (!((a, b) => a && b)(${C}, true)) { return "REJECTED" }\n    ${T}` },
  arrWithCall: { body: `const xs = [1, 2].map((x) => x + 1)\n    if (!${C}) { return "REJECTED" }\n    ${T}` },
  objMethod: { body: `const o = { go(a, b) { return check(a, b) } }\n    if (!o.go(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  objArrowProp: { body: `const o = { go: (a, b) => check(a, b) }\n    if (!o.go(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  fnExprLocal: { body: `const w = function (a, b) { return check(a, b) }\n    if (!w(pass, row.pw)) { return "REJECTED" }\n    ${T}` },
  reduceCb: { body: `const ok = [row.pw].reduce((acc, h) => acc && check(pass, h), true)\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  filterLen: { body: `const ok = [row.pw].filter((h) => check(pass, h)).length > 0\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  everyCb: { body: `if (![row.pw].every((h) => check(pass, h))) { return "REJECTED" }\n    ${T}` },
  mapThenIdx: { body: `if (![row.pw].map((h) => check(pass, h))[0]) { return "REJECTED" }\n    ${T}` },
  flatMapCb: { body: `if (![row.pw].flatMap((h) => [check(pass, h)])[0]) { return "REJECTED" }\n    ${T}` },
  findLastCb: { body: `if (![row.pw].findLast((h) => check(pass, h))) { return "REJECTED" }\n    ${T}` },
  arrayFrom: { body: `const a = Array.from([row.pw], (h) => check(pass, h))\n    if (!a[0]) { return "REJECTED" }\n    ${T}` },
  promiseAllish: { body: `const [a, b] = [${C}, ${C}]\n    if (!a) { return "REJECTED" }\n    ${T}` },
  objDestr: { body: `const { ok } = { ok: ${C} }\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  forCStyle: { body: `let ok = false\n    for (let i = 0; i < 1 && ${C}; i = i + 1) { ok = true }\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  whileBody: { body: `let ok = false\n    let n = 0\n    while (n < 1) { ok = ${C}\n      n = n + 1 }\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  errHandle: { body: `const ok = ${C} !{ _ :> { return "ERR" } }\n    if (!ok) { return "REJECTED" }\n    ${T}` },
  jsonStringify: { body: `if (JSON.stringify({ a: ${C} }) != "{\\"a\\":true}") { return "REJECTED" }\n    ${T}` },
  consoleThen: { body: `console.log(${C})\n    if (!${C}) { return "REJECTED" }\n    ${T}` },
};
