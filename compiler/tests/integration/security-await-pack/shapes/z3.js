export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const BG = R(`!g(pass, row.pw)`);
export const SHAPES = {
  forEachWrite: { body: `let ok = false\n    [row.pw].forEach((h) => { ok = check(pass, h) })\n    ` + R(`!ok`) },
  forEachWriteNeg: { body: `let bad = false\n    [row.pw].forEach((h) => { bad = !check(pass, h) })\n    ` + R(`bad`) },
  sortCb: { body: `const s = [row.pw, "zz"].sort((a, b) => check(pass, a) ? -1 : 1)\n    ` + R(`s[0] != row.pw`) },
  findIndexCb: { body: R(`[row.pw].findIndex((h) => check(pass, h)) < 0`) },
  flatMapCb: { body: `const r = [row.pw].flatMap((h) => [check(pass, h)])\n    ` + R(`!r[0]`) },
  someNeg: { body: R(`[row.pw].some((h) => !check(pass, h))`) },
  filterNeg: { body: R(`[row.pw].filter((h) => !check(pass, h)).length > 0`) },
  mapNegIdx: { body: `const bad = [row.pw].map((h) => !check(pass, h))[0]\n    ` + R(`bad`) },
  reduceRetFn: { body: `const g = [1].reduce((acc, x) => check, null)\n    ` + BG },
  arrayFrom: { body: `const g = Array.from([1], () => check)[0]\n    ` + BG },
  arrayOf: { body: R(`!Array.of(check)[0](pass, row.pw)`) },
  getterObj: { body: `const o = { get v() { return check(pass, row.pw) } }\n    ` + R(`!o.v`) },
  methodObj: { body: `const o = { m() { return check(pass, row.pw) } }\n    ` + R(`!o.m()`) },
  objValues: { body: `const g = Object.values({ a: check })[0]\n    ` + BG },
  awaitlessWhile: { body: `let i = 0\n    let ok = false\n    while (i < 1) { ok = check(pass, row.pw)\n      i = i + 1 }\n    ` + R(`!ok`) },
  condWrite: { body: `let ok = false\n    if (row) { ok = check(pass, row.pw) }\n    ` + R(`!ok`) },
  orAssignWrite: { body: `let ok = false\n    ok ||= check(pass, row.pw)\n    ` + R(`!ok`) },
  nullishCall: { body: `let ok = null\n    ok ??= check(pass, row.pw)\n    ` + R(`!ok`) },
  tryWrite: { body: `let ok = false\n    try { ok = check(pass, row.pw) } catch (e) { ok = false }\n    ` + R(`!ok`) },
  matchWrite: { body: `const ok = match 1 { 1 => check(pass, row.pw), else => false }\n    ` + R(`!ok`) },
  iifeCall: { body: R(`!(() => check(pass, row.pw))()`) },
  iifeBlock: { body: `const ok = (() => { return check(pass, row.pw) })()\n    ` + R(`!ok`) },
  lambdaCalledLocal: { body: `function inner2() { return check(pass, row.pw) }\n    ` + R(`!inner2()`) },
};
