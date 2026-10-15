// Probe family `s7` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s7.mjs`, r5 (S465 await review round 5).
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
  isVariantCall: S(`const r: R = R.Found(name.trim())\n    const v = r is .Found`),
  isSomeCall: S(`const v = name.trim() is some`),
  isNotCall: S(`const v = name.trim() is not`),
  notCall: S(`const v = not name.includes("z")`),
  enumColon: S(`const r = R::Missing\n    const v = String(r == R.Missing)`),
  matchExprArrow: S(`const r: R = R.Found(name.trim())\n    const v = match r {\n      .Found(n) :> n.toUpperCase()\n      .Missing :> "m"\n    }`),
  matchExprStr: S(`const r: R = R.Found("a")\n    const v = match r {\n      .Found(n) :> "f(" + n + ")"\n      .Missing :> "m(x)"\n    }`),
  matchImported: { imports: I, body: `const r: R = R.Missing\n    const v = match r {\n      .Found(n) :> "x"\n      .Missing :> check(pass, row.pw) ? "ok" : "bad"\n    }\n    if (v != "ok") { return "REJECTED" }\n    return "WELCOME"` },
  fnLambda: S(`const g = fn(x) => x.trim()\n    const v = g(" a ")`),
  rangeLoop: S(`let v = 0\n    for (const i of [1, 2, 3].map((x) => x * 2)) { v = v + i }`),
  optionalChain: S(`const v = row?.name?.trim()`),
  nullishChain: S(`const v = (row?.nick ?? "none").toUpperCase()`),
  spreadObj: S(`const o = { ...row, z: name.trim() }\n    const v = o.z`),
  regexCall: S(`const v = /b(o)b/.exec(name)[1]`),
  strParenTernary: S(`const v = name == "(" ? "p" : name.trim()`),
  tmplNested: S(`const v = \`\${name.trim()} (\${String(1)})\``),
  handledSql: S(`const r2 = ?{\`SELECT name FROM users WHERE name = \${name.trim()}\`}.get() !{ _ :> { return "E" } }\n    const v = r2.name`),
  chainedArr: S(`const v = [3, 1, 2].sort((a, b) => a - b).join(",")`),
  objMethodSync: S(`const o = { up(s) { return s.toUpperCase() } }\n    const v = o.up("a")`),
  newDate: S(`const v = new Date(0).getTime()`),
  jsonParse: S(`const v = JSON.parse("{\\"a\\": 1}").a`),
  arrowBlockSync: S(`const g = (s) => { const t = s.trim()\n      return t.toUpperCase() }\n    const v = g(" a ")`),
  arrowBlockStrParen: S(`const g = (s) => { return "(" + s + ")" }\n    const v = g("a")`),
  arrowBlockIfElse: S(`const g = (s) => { if (s == "a") { return "A(1)" } else { return s.trim() } }\n    const v = g("a")`),
  arrowBlockForOf: S(`const g = (xs) => { let t = 0\n      for (const x of xs) { t = t + x }\n      return t }\n    const v = g([1, 2])`),
  arrowBlockWhile: S(`const g = (n) => { let t = 0\n      while (t < n) { t = t + 1 }\n      return t }\n    const v = g(3)`),
  arrowBlockMatch: S(`const g = (r) => { return match r { .Found(n) :> n .Missing :> "m" } }\n    const v = g(R.Found("q"))`),
  arrowBlockNested: S(`const g = (xs) => { return xs.map((x) => { return x * 2 }).join("-") }\n    const v = g([1, 2])`),
  arrowBlockTemplate: S(`const g = (s) => { return \`<\${s.trim()}>\` }\n    const v = g(" a ")`),
  arrowBlockRegex: S(`const g = (s) => { return s.replace(/\\(/g, "[") }\n    const v = g("a(")`),
  arrowBlockComment: S(`const g = (s) => {\n      // call f(x) here\n      return s.trim() }\n    const v = g(" a ")`),
  arrowBlockReturnObj: S(`const g = (s) => { return { a: s.trim() } }\n    const v = g(" a ").a`),
  arrowBlockLetDestr: S(`const g = (o) => { const { a, b } = o\n      return a + b }\n    const v = g({ a: 1, b: 2 })`),
  arrowBlockClosureCapt: S(`const k = 5\n    const g = (s) => { return String(k) + s.trim() }\n    const v = g(" a ")`),
  fnDeclLocalSync: S(`function g(s) { return s.trim() + "(x)" }\n    const v = g(" a ")`),
};
