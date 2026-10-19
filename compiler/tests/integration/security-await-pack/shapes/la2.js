// Family la2 (S468 fix round 1) — the S239 review of s468-literal-arm-block-p0 @ 4369d0bb9, verbatim
// (~/.cache/scrml-agent-tmp/s468-rev-litarm/atk1–atk5.mjs). What it probes, by finding:
//   F1 — an OBJECT-LITERAL block arm storing an async function (`1 :> { g: check }`, `.A :> { g: check }`)
//        in declaration / `let` / `return` / server-function positions (obj*). FAIL on 4369d0bb9 (the
//        analyses and codegen read the arm's value differently); objReturnVariant FAIL on main too.
//   F2 — a multi-scrutinee `_ :> { … }` / `else :> { … }` BLOCK arm whose body was dropped (ms*Deny*).
//   F3 — a comment inside an arm head (cmt*, comment*): the arm fell to the text path.
//   F4/F5 — heads the compiler cannot classify (mixed literal + variant, `(1)`, `1 | not`, template
//        literals): silently dropped arms, now E-PARSE-001.
//   plus the review's controls (rawArms, product arms, guards, literal oddities, leave arms…).
// On the fix-round-1 branch: 0 FAIL.
export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const RG = R(`!g(pass, row.pw)`);
const ENUM = `type K:enum = { A, B, C }`;
const DRIVE = `function drive(cb, p, h) { if (cb(p, h)) { return true }\n    return false }`;
const REACH = DRIVE + `\n  function never(a, b) { return false }`;
const RB = `const y = never("a", "b")\n    const z = drive(never, "x", "y")\n    `;
const blk = (head, scrut = `const n = 1`, top) => ({ top, body: `${scrut}\n    match n {\n      ${head} { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` });
const D = (head, pre = `const a = 1`, top) => ({ top, body: `${pre}\n    match a {\n      ${head} { if (!check(pass, row.pw)) { return "REJECTED" } }\n      else :> { }\n    }\n    return "WELCOME"` });
export const SHAPES = {
  // ---- review file atk1.mjs
  // mixed heads
  mixedHeadBlk: { top: ENUM, body: `const n: K = .A\n    match n {\n      .A | 1 :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  mixedHeadInlineHof: { top: ENUM + "\n  " + REACH, body: RB + `const n: K = .A\n    const ok = match n {\n      .A | 1 :> drive(check, pass, row.pw)\n      else :> false\n    }\n    ` + R(`!ok`) },
  mixedHeadNum: { body: `const n = 1\n    match n {\n      1 | .A :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  // rawArms (match inside larger expression)
  rawArgDirect: { top: REACH, body: RB + `const n = 1\n    const ok = Boolean(match n {\n      1 :> { const g = check\n        g(pass, row.pw) }\n      else :> false\n    })\n    ` + R(`!ok`) },
  rawArgHof: { top: REACH, body: RB + `const n = 1\n    const ok = Boolean(match n {\n      1 :> drive(check, pass, row.pw)\n      else :> false\n    })\n    ` + R(`!ok`) },
  rawArgVariantHof: { top: ENUM + "\n  " + REACH, body: RB + `const k: K = .A\n    const ok = Boolean(match k {\n      .A :> drive(check, pass, row.pw)\n      else :> false\n    })\n    ` + R(`!ok`) },
  rawArgVariantBlk: { top: ENUM, body: `const k: K = .A\n    const ok = Boolean(match k {\n      .A :> { const g = check\n        g(pass, row.pw) }\n      else :> false\n    })\n    ` + R(`!ok`) },
  rawArray: { body: `const n = 1\n    const ok = [match n {\n      1 :> { const g = check\n        g(pass, row.pw) }\n      else :> false\n    }][0]\n    ` + R(`!ok`) },
  rawNot: { body: `const n = 1\n    const bad = !match n {\n      1 :> { const g = check\n        g(pass, row.pw) }\n      else :> false\n    }\n    if (bad) { return "REJECTED" }\n    ${T}` },
  rawTernary: { body: `const n = 1\n    const ok = true ? match n {\n      1 :> { const g = check\n        g(pass, row.pw) }\n      else :> false\n    } : false\n    ` + R(`!ok`) },
  rawParen: { body: `const n = 1\n    const ok = (match n {\n      1 :> { const g = check\n        g(pass, row.pw) }\n      else :> false\n    })\n    ` + R(`!ok`) },
  rawTemplate: { body: `const n = 1\n    const s = \`\${match n {\n      1 :> { const g = check\n        g(pass, row.pw) ? "yes" : "no" }\n      else :> "no"\n    }}\`\n    ` + R(`s == "no"`) },
  rawAnd: { body: `const n = 1\n    const ok = true && match n {\n      1 :> { const g = check\n        g(pass, row.pw) }\n      else :> false\n    }\n    ` + R(`!ok`) },
  rawIfCond: { body: `const n = 1\n    if (!match n {\n      1 :> { const g = check\n        g(pass, row.pw) }\n      else :> false\n    }) { return "REJECTED" }\n    ${T}` },
  rawReturnArg: { top: `function run(p, h) { const n = 1\n    return Boolean(match n {\n      1 :> { const g = check\n        g(p, h) }\n      else :> false\n    }) }`, body: R(`!run(pass, row.pw)`) },
  rawObj: { body: `const n = 1\n    const o = { ok: match n {\n      1 :> { const g = check\n        g(pass, row.pw) }\n      else :> false\n    } }\n    ` + R(`!o.ok`) },
  // product arms
  prodInlineHof: { top: REACH, body: RB + `const a = 1\n    const b = 2\n    const ok = match (a, b) {\n      (1, 2) :> drive(check, pass, row.pw)\n      (_, _) :> false\n    }\n    ` + R(`!ok`) },
  prodBlockValue: { body: `const a = 1\n    const b = 2\n    const ok = match (a, b) {\n      (1, 2) :> { const g = check\n        g(pass, row.pw) }\n      (_, _) :> false\n    }\n    ` + R(`!ok`) },
  // guards
  guardArm: { body: `const n = 1\n    match n {\n      1 if true :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  // comments / multi-line heads
  commentBeforeArrow: blk(`1 /* c */ :>`),
  commentAfterArrow: blk(`1 :> /* c */`),
  lineCommentAfterArrow: { body: `const n = 1\n    match n {\n      1 :> // c\n      { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  multiLineHead: { body: `const n = 2\n    match n {\n      1 |\n      2 :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  multiLineHead2: { body: `const n = 2\n    match n {\n      1\n      | 2 :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  braceNextLine: { body: `const n = 1\n    match n {\n      1 :>\n      { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  // literal oddities
  bigintArm: blk(`1n :>`, `const n = 1n`),
  negHexArm: blk(`-0x1 :>`, `const n = -1`),
  expArm: blk(`1e0 :>`),
  nullArm: blk(`null :>`, `const n = null`),
  undefArm: blk(`undefined :>`, `const n = undefined`),
  strColonArm: blk(`":>{" :>`, `const n = ":>{"`),
  strBraceArm: blk(`"}" :>`, `const n = "}"`),
  strPipeArm: blk(`"a|b" | "c" :>`, `const n = "a|b"`),
  strEscQuote: blk(`"b\\"ob" :>`, `const n = "b\\"ob"`),
  strEscQuoteNoMatch: { body: `const n = "zzz"\n    match n {\n      "b\\"ob" :> { return "X" }\n      else :> { const g = check\n        ${RG} }\n    }\n    return "X"` },
  tmplArm: blk("`1` :>", `const n = "1"`),
  tmplInterpArm: blk("`${name}` :>", `const n = "bob"`),
  litElseAlt: blk(`1 | else :>`, `const n = 5`),
  notAlt: blk(`1 | not :>`),
  identArm: blk(`one :>`),
  // nested match in literal arm, alias
  nestedInNested: { body: `const n = 1\n    const m = 2\n    match n {\n      1 :> { match m {\n          2 | 3 :> { const g = check\n            ${RG} }\n          else :> { return "X" }\n        } }\n      else :> { return "X" }\n    }\n    return "X"` },
  nestedValueInArm: { body: `const n = 1\n    match n {\n      1 :> { const ok = match n {\n          1 :> { const g = check\n            g(pass, row.pw) }\n          else :> false\n        }\n        ${R(`!ok`)} }\n      else :> { return "X" }\n    }\n    return "X"` },
  // object literal arm values
  objArmDecl: { body: `const n = 1\n    const o = match n {\n      1 :> { g: check }\n      else :> { g: check }\n    }\n    ` + R(`!o.g(pass, row.pw)`) },
  objArmDeclVariant: { top: ENUM, body: `const n: K = .A\n    const o = match n {\n      .A :> { g: check }\n      else :> { g: check }\n    }\n    ` + R(`!o.g(pass, row.pw)`) },
  objArmStmtReturn: { top: `function run(p, h) { const n = 1\n    const o = match n {\n      1 :> { ok: check(p, h) }\n      else :> { ok: false }\n    }\n    return o.ok }`, body: R(`!run(pass, row.pw)`) },
  objArmDirectCall: { body: `const n = 1\n    const o = match n {\n      1 :> { ok: check(pass, row.pw) }\n      else :> { ok: false }\n    }\n    ` + R(`!o.ok`) },
  // inline value alias
  inlineAlias: { body: `const n = 1\n    const g = match n {\n      1 :> check\n      else :> check\n    }\n    ` + RG },
  inlineAliasAlt: { body: `const n = 1\n    const g = match n {\n      1 | 2 :> check\n      else :> check\n    }\n    ` + RG },
  inlineArrow: { body: `const n = 1\n    const g = match n {\n      1 :> (a, b) => check(a, b)\n      else :> (a, b) => false\n    }\n    ` + RG },
  // lambda / nested fn
  lambdaMatch: { top: `const run = (p, h) => match 1 {\n      1 :> { const g = check\n        g(p, h) }\n      else :> false\n    }`, body: R(`!run(pass, row.pw)`) },
  fnExprMatch: { body: `const run = function (p, h) { const n = 1\n      match n {\n        1 :> { const g = check\n          return g(p, h) }\n        else :> { return false }\n      }\n      return false }\n    ` + R(`!run(pass, row.pw)`) },
  innerFnMatch: { body: `function run(p, h) { const n = 1\n      match n {\n        1 :> { const g = check\n          return g(p, h) }\n        else :> { return false }\n      }\n      return false }\n    ` + R(`!run(pass, row.pw)`) },
  // leave-stmt arms
  leaveReturnArm: { top: `function run(p, h) { const n = 1\n    match n {\n      1 :> return check(p, h)\n      else :> return false\n    }\n    return false }`, body: R(`!run(pass, row.pw)`) },
  // arm with paren-wrapped literal
  parenLitArm: blk(`(1) :>`),
  // underscore inline alias
  underscoreInlineHof: { top: REACH, body: RB + `const n = 1\n    const ok = match n {\n      2 :> false\n      _ :> drive(check, pass, row.pw)\n    }\n    ` + R(`!ok`) },
  // literal arm in for-of / while
  whileArm: { body: `let r = "X"\n    let i = 0\n    while (i < 1) {\n      i = i + 1\n      match i {\n        1 :> { const g = check\n          if (!g(pass, row.pw)) { r = "REJECTED" } else { r = "WELCOME" } }\n        else :> { r = "X" }\n      }\n    }\n    return r` },
  // match with ; separators between arms
  semiSep: { body: `const n = 1\n    match n {\n      1 :> { const g = check\n        ${RG} };\n      else :> { return "X" }\n    }\n    return "X"` },
  // single-line arms
  oneLine: { body: `const n = 1\n    match n { 1 :> { const g = check; ${R(`!g(pass, row.pw)`).replace(/\n\s*/g, "; ")} } else :> { return "X" } }\n    return "X"` },
  // ---- review file atk2.mjs
  cmtVariant: { top: ENUM, body: `const n: K = .A\n    match n {\n      .A /* c */ :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  cmtElse: { body: `const n = 1\n    match n {\n      2 :> { return "X" }\n      else /* c */ :> { const g = check\n        ${RG} }\n    }\n    return "X"` },
  cmtAltMid: { body: `const n = 2\n    match n {\n      1 | /* c */ 2 :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  cmtLineBeforeArrow: { body: `const n = 1\n    match n {\n      1 // c\n      :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  cmtStrHead: { body: `match name {\n      "bob" /* c */ :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  cmtInlineHof: { top: `function drive(cb, p, h) { if (cb(p, h)) { return true }\n    return false }\n  function never(a, b) { return false }`, body: `const y = never("a", "b")\n    const z = drive(never, "x", "y")\n    const n = 1\n    const ok = match n {\n      1 /* c */ :> drive(check, pass, row.pw)\n      else :> false\n    }\n    ` + R(`!ok`) },
  objReturnVariant: { top: ENUM + `\n  function pick() { const k: K = .A\n    return match k {\n      .A :> { g: check }\n      else :> { g: check }\n    } }`, body: R(`!pick().g(pass, row.pw)`) },
  objReturnLit: { top: `function pick() { const k = 1\n    return match k {\n      1 :> { g: check }\n      else :> { g: check }\n    } }`, body: R(`!pick().g(pass, row.pw)`) },
  objInlineParen: { body: `const n = 1\n    const o = match n {\n      1 :> ({ g: check })\n      else :> ({ g: check })\n    }\n    ` + R(`!o.g(pass, row.pw)`) },
  objDeclLet: { body: `const n = 1\n    let o = match n {\n      1 :> { g: check }\n      else :> { g: check }\n    }\n    ` + R(`!o.g(pass, row.pw)`) },
  objDeclArr: { body: `const n = 1\n    const o = match n {\n      1 :> { g: [check] }\n      else :> { g: [check] }\n    }\n    ` + R(`!o.g[0](pass, row.pw)`) },
  objDeclNested: { body: `const n = 1\n    const o = match n {\n      1 :> { a: { g: check } }\n      else :> { a: { g: check } }\n    }\n    ` + R(`!o.a.g(pass, row.pw)`) },
  objDeclShorthand: { body: `const n = 1\n    const o = match n {\n      1 :> { check }\n      else :> { check }\n    }\n    ` + R(`!o.check(pass, row.pw)`) },
  objDeclStr: { body: `const o = match name {\n      "bob" :> { g: check }\n      else :> { g: check }\n    }\n    ` + R(`!o.g(pass, row.pw)`) },
  objDeclWild: { body: `const n = 1\n    const o = match n {\n      _ :> { g: check }\n    }\n    ` + R(`!o.g(pass, row.pw)`) },
  objStmtVariant: { top: ENUM, body: `const k: K = .A\n    let o = null\n    o = match k {\n      .A :> { g: check }\n      else :> { g: check }\n    }\n    ` + R(`!o.g(pass, row.pw)`) },
  objArgVariant: { top: ENUM + `\n  function use(o, p, h) { return o.g(p, h) }`, body: `const k: K = .A\n    const ok = use(match k {\n      .A :> { g: check }\n      else :> { g: check }\n    }, pass, row.pw)\n    ` + R(`!ok`) },
  objHofCb: { top: `function drive(o, p, h) { if (o.g(p, h)) { return true }\n    return false }\n  function never(a, b) { return false }`, body: `const z = drive({ g: never }, "x", "y")\n    const n = 1\n    const o = match n {\n      1 :> { g: check }\n      else :> { g: never }\n    }\n    const ok = drive(o, pass, row.pw)\n    ` + R(`!ok`) },
  // ---- review file atk3.mjs
  msWildDeny: { body: `const a = 1\n    const b = 2\n    match (a, b) {\n      (9, 9) :> { return "X" }\n      _ :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n    }\n    return "WELCOME"` },
  msWildDenyElse: { body: `const a = 1\n    const b = 2\n    match (a, b) {\n      (9, 9) :> { return "X" }\n      else :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n    }\n    return "WELCOME"` },
  msProdWildDeny: { body: `const a = 1\n    const b = 2\n    match (a, b) {\n      (9, 9) :> { return "X" }\n      (_, _) :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n    }\n    return "WELCOME"` },
  msWildDenyDecl: { body: `const a = 1\n    const b = 2\n    const ok = match (a, b) {\n      (9, 9) :> true\n      _ :> { const v = check(pass, row.pw)\n        v }\n    }\n    if (ok == false) { return "REJECTED" }\n    return "WELCOME"` },
  msWildDenyDeclElse: { body: `const a = 1\n    const b = 2\n    const ok = match (a, b) {\n      (9, 9) :> true\n      else :> { const v = check(pass, row.pw)\n        v }\n    }\n    if (ok == false) { return "REJECTED" }\n    return "WELCOME"` },
  msLitAltWild: { body: `const a = 1\n    const b = 2\n    match (a, b) {\n      (9, 9) :> { return "X" }\n      _ | else :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n    }\n    return "WELCOME"` },
  singleWildDeny: { body: `const a = 1\n    match a {\n      9 :> { return "X" }\n      _ :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n    }\n    return "WELCOME"` },
  litDeny: { body: `const a = 1\n    match a {\n      1 | 2 :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n      else :> { return "X" }\n    }\n    return "WELCOME"` },
  colonVDeny: { top: `type K:enum = { A, B }`, body: `const k: K = .A\n    match k {\n      ::A :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n      ::B :> { return "X" }\n    }\n    return "WELCOME"` },
  mixedDeny: { top: `type K:enum = { A, B }`, body: `const k = 1\n    match k {\n      1 | .A :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n      else :> { return "X" }\n    }\n    return "WELCOME"` },
  cmtDeny: { body: `const a = 1\n    match a {\n      1 /* c */ :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n      else :> { return "X" }\n    }\n    return "WELCOME"` },
  cmtVarDeny: { top: `type K:enum = { A, B }`, body: `const k: K = .A\n    match k {\n      .A /* c */ :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n      .B :> { return "X" }\n    }\n    return "WELCOME"` },
  parenDeny: { body: `const a = 1\n    match a {\n      (1) :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n      else :> { return "X" }\n    }\n    return "WELCOME"` },
  tmplDeny: { body: `match name {\n      \`bob\` :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n      else :> { return "X" }\n    }\n    return "WELCOME"` },
  notAltDeny: { body: `const a = 1\n    match a {\n      1 | not :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n      else :> { return "X" }\n    }\n    return "WELCOME"` },
  // ---- review file atk4.mjs
  cpsLitAlias: { body: `const n = 1\n    @out = "busy"\n    match n {\n      1 :> { const g = check\n        if (!g(pass, row.pw)) { return "REJECTED" } }\n      else :> { return "X" }\n    }\n    return "WELCOME"` },
  cpsLitObj: { body: `const n = 1\n    @out = "busy"\n    const o = match n {\n      1 :> { g: check }\n      else :> { g: check }\n    }\n    if (!o.g(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` },
  cpsMsWild: { body: `const a = 1\n    @out = "busy"\n    match (a, a) {\n      (9, 9) :> { return "X" }\n      _ :> { if (!check(pass, row.pw)) { return "REJECTED" } }\n    }\n    return "WELCOME"` },
  derivedObj: { top: `const <pick> = match 1 {\n      1 :> { g: check }\n      else :> { g: check }\n    }`, body: `if (!@pick.g(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` },
  serverFnObjRet: { top: `server function pick2() { const n = 1\n    return match n {\n      1 :> { g: check }\n      else :> { g: check }\n    } }`, body: `const o = pick2()\n    if (!o.g(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` },
  // ---- review file atk5.mjs
  mixedDrop: D(`1 | .A :>`, `const a = 1`, `type K:enum = { A, B }`),
  parenDrop: D(`(1) :>`),
  notAltDrop: D(`1 | not :>`),
  strMixedDrop: D(`"bob" | .A :>`, `const a = name`, `type K:enum = { A, B }`),
  tmplDrop: D("`bob` :>", `const a = name`),
};
