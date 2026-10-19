// Family la1 (S468, gap g-literal-arm-block-body-unparsed-s468) — a `match` arm whose head is NOT a
// single `.Variant` / `else` / `not`: a §18.16 literal arm (`1 :>`, `-1 :>`, `0x1F :>`, `"bob" :>`,
// `'bob' :>`, `true :>`), an alternation (`1 | 2 :>`, `"a" | "b" :>`, `.A | .B :>`), the `_` wildcard
// alias and the `::V` alias. Before S468 the AST builder kept such an arm as ONE `bare-expr` holding the
// whole arm TEXT, whose exprNode was the leading literal alone, so no analysis read its body:
//   - a `{ … }` block body: `const g = check` inside it was not refused (§13.9.6) and `g(…)` was not
//     awaited (§13.2) — a wrong password answered WELCOME (the review shapes matchArmInF …
//     matchNumArmIfOnly, from the S468 review of #1446: ~/.cache/scrml-agent-tmp/s468-rev-f4fu/drv/p3–p7.mjs);
//   - a single-expression body: `1 :> drive(check, …)` passed the async function to a higher-order
//     function unrefused (§13.2 E-ASYNC-FN-ESCAPES-AS-VALUE) — WELCOME once `drive` was otherwise
//     reachable (the *InlineHofReach shapes; without that, `drive` was never emitted: a 500 by accident).
// Measured on main bbddfd7b9: 29 of these 55 shapes answer a wrong password WELCOME. On the S468 fix
// (the body / result is parsed like every other arm kind, ast-builder.js Form 4 + Inline Form 6): 0.
// Controls kept alongside (direct calls, variant arms, value / return / argument positions).
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
export const SHAPES = {
  // --- the S468 review of #1446, verbatim (FAIL on main unless noted as a control) ---
  matchArmInF: { body: `const n = 1\n    match n {\n      1 => { const g = check\n        ${RG} }\n      else => { return "X" }\n    }\n    return "X"` },
  matchArmNestedFnIf: { top: `function run(p, h) { const n = 1\n    match n {\n      1 => { const g = check\n        if (!g(p, h)) { return false }\n        return true }\n      else => { return false }\n    }\n    return false }`, body: R(`!run(pass, row.pw)`) },
  matchArmInFLet: { body: `const n = 1\n    let g = (a, b) => false\n    match n {\n      1 => { g = check }\n      else => { }\n    }\n    ` + RG },
  matchArmInFLetDecl: { body: `const n = 1\n    match n {\n      1 => { let g = check\n        ${RG} }\n      else => { return "X" }\n    }\n    return "X"` },
  matchArmInFObj: { body: `const n = 1\n    match n {\n      1 => { const o = { g: check }\n        ${R(`!o.g(pass, row.pw)`)} }\n      else => { return "X" }\n    }\n    return "X"` },
  strArm: { body: `match name {\n      "bob" => { const g = check\n        ${RG} }\n      else => { return "X" }\n    }\n    return "X"` },
  strArmColon: { body: `match name {\n      "bob" :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  boolArm: { body: `const ok = true\n    match ok {\n      true => { const g = check\n        ${RG} }\n      else => { return "X" }\n    }\n    return "X"` },
  strArmObj: { body: `match name {\n      "bob" => { const o = [check]\n        ${R(`!o[0](pass, row.pw)`)} }\n      else => { return "X" }\n    }\n    return "X"` },
  matchNumArmIfOnly: { body: `const n = 1\n    match n {\n      1 => { if (true) { const g = check\n          ${RG} } }\n      else => { return "X" }\n    }\n    return "X"` },
  // controls (PASS on main):
  matchArmRealG: { top: `function run(p, h) { const n = 1\n    match n {\n      1 => { const g = check\n        return g(p, h) }\n      else => { return false }\n    }\n    return false }`, body: R(`!run(pass, row.pw)`) },
  strArmDirectCall: { body: `match name {\n      "bob" => { ${R(`!check(pass, row.pw)`)} }\n      else => { return "X" }\n    }\n    return "X"` },
  strArmVar: { body: `match name {\n      "bob" => { const ok = check(pass, row.pw)\n        ${R(`!ok`)} }\n      else => { return "X" }\n    }\n    return "X"` },
  // --- found by the S468 fix: every other arm head the builder kept as text ---
  strArmSingleQuote: { body: `match name {\n      'bob' :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  strArmThinArrow: { body: `match name {\n      "bob" -> { const g = check\n        ${RG} }\n      else -> { return "X" }\n    }\n    return "X"` },
  falseArm: { body: `const ok = false\n    match ok {\n      true :> { return "X" }\n      false :> { const g = check\n        ${RG} }\n    }\n    return "X"` },
  negNumArm: { body: `const n = -1\n    match n {\n      -1 :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  hexNumArm: { body: `const n = 31\n    match n {\n      0x1F :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  floatNumArm: { body: `const n = 1.5\n    match n {\n      1.5 :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  numAltArm: { body: `const n = 2\n    match n {\n      1 | 2 :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  strAltArm: { body: `match name {\n      "al" | "bob" :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  boolAltArm: { body: `const ok = true\n    match ok {\n      true | false :> { const g = check\n        ${RG} }\n    }\n    return "X"` },
  underscoreArm: { body: `const n = 1\n    match n {\n      2 :> { return "X" }\n      _ :> { const g = check\n        ${RG} }\n    }\n    return "X"` },
  underscoreArmFatArrow: { body: `const n = 1\n    match n {\n      _ => { const g = check\n        ${RG} }\n    }\n    return "X"` },
  variantAltArm: { top: ENUM, body: `const n: K = .A\n    match n {\n      .A | .B :> { const g = check\n        ${RG} }\n      .C :> { return "X" }\n    }\n    return "X"` },
  colonVariantArm: { top: ENUM, body: `const n: K = .A\n    match n {\n      ::A :> { const g = check\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  numArmDirectCall: { body: `const n = 1\n    match n {\n      1 :> { ${R(`!check(pass, row.pw)`)} }\n      else :> { return "X" }\n    }\n    return "X"` },
  numArmDirectCallVar: { body: `const n = 1\n    match n {\n      1 :> { const ok = check(pass, row.pw)\n        ${R(`!ok`)} }\n      else :> { return "X" }\n    }\n    return "X"` },
  numAltArmDirectCall: { body: `const n = 2\n    match n {\n      1 | 2 :> { ${R(`!check(pass, row.pw)`)} }\n      else :> { return "X" }\n    }\n    return "X"` },
  numArmInLoop: { body: `let res = "X"\n    for (let i = 0; i < 1; i = i + 1) {\n      const n = 1\n      match n {\n        1 :> { const g = check\n          if (!g(pass, row.pw)) { res = "REJECTED" } else { res = "WELCOME" } }\n        else :> { res = "X" }\n      }\n    }\n    return res` },
  numArmNestedMatch: { body: `const n = 1\n    const m = 2\n    match n {\n      1 :> { match m {\n          2 :> { const g = check\n            ${RG} }\n          else :> { return "X" }\n        } }\n      else :> { return "X" }\n    }\n    return "X"` },
  numArmLambda: { body: `const n = 1\n    match n {\n      1 :> { const g = (a, b) => check(a, b)\n        ${RG} }\n      else :> { return "X" }\n    }\n    return "X"` },
  numArmAssignResult: { body: `const n = 1\n    let ok = false\n    match n {\n      1 :> { ok = check(pass, row.pw) }\n      else :> { ok = false }\n    }\n    ` + R(`!ok`) },
  numArmValueMatch: { body: `const n = 1\n    const ok = match n {\n      1 :> { const g = check\n        g(pass, row.pw) }\n      else :> false\n    }\n    ` + R(`!ok`) },
  numArmValueMatchDirect: { body: `const n = 1\n    const ok = match n {\n      1 :> { const v = check(pass, row.pw)\n        v }\n      else :> false\n    }\n    ` + R(`!ok`) },
  numArmReturnMatch: { top: `function run(p, h) { const n = 1\n    return match n {\n      1 :> { const g = check\n        g(p, h) }\n      else :> false\n    } }`, body: R(`!run(pass, row.pw)`) },
  numArmInlineHof: { top: DRIVE, body: `const n = 1\n    const ok = match n {\n      1 :> drive(check, pass, row.pw)\n      else :> false\n    }\n    ` + R(`!ok`) },
  numAltArmInlineHof: { top: DRIVE, body: `const n = 1\n    const ok = match n {\n      1 | 2 :> drive(check, pass, row.pw)\n      else :> false\n    }\n    ` + R(`!ok`) },
  boolArmInlineHof: { top: DRIVE, body: `const b = true\n    const ok = match b {\n      true :> drive(check, pass, row.pw)\n      false :> false\n    }\n    ` + R(`!ok`) },
  strArmInlineHof: { top: DRIVE, body: `const ok = match name {\n      "bob" :> drive(check, pass, row.pw)\n      else :> false\n    }\n    ` + R(`!ok`) },
  variantAltArmInlineHof: { top: ENUM + `\n  ` + DRIVE, body: `const k: K = .A\n    const ok = match k {\n      .A | .B :> drive(check, pass, row.pw)\n      .C :> false\n    }\n    ` + R(`!ok`) },
  numArmInlineHofReach: { top: DRIVE + `\n  function never(a, b) { return false }`, body: `const y = never("a", "b")\n    const z = drive(never, "x", "y")\n    const n = 1\n    const ok = match n {\n      1 :> drive(check, pass, row.pw)\n      else :> false\n    }\n    ` + R(`!ok`) },
  numAltArmInlineHofReach: { top: DRIVE + `\n  function never(a, b) { return false }`, body: `const y = never("a", "b")\n    const z = drive(never, "x", "y")\n    const n = 1\n    const ok = match n {\n      1 | 2 :> drive(check, pass, row.pw)\n      else :> false\n    }\n    ` + R(`!ok`) },
  boolArmInlineHofReach: { top: DRIVE + `\n  function never(a, b) { return false }`, body: `const y = never("a", "b")\n    const z = drive(never, "x", "y")\n    const b = true\n    const ok = match b {\n      true :> drive(check, pass, row.pw)\n      false :> false\n    }\n    ` + R(`!ok`) },
  variantAltArmInlineHofReach: { top: ENUM + `\n  ` + DRIVE + `\n  function never(a, b) { return false }`, body: `const y = never("a", "b")\n    const z = drive(never, "x", "y")\n    const k: K = .A\n    const ok = match k {\n      .A | .B :> drive(check, pass, row.pw)\n      .C :> false\n    }\n    ` + R(`!ok`) },
  numArmInlineStmtHof: { top: DRIVE, body: `const n = 1\n    let ok = false\n    match n {\n      1 :> { ok = drive(check, pass, row.pw) }\n      else :> { ok = false }\n    }\n    ` + R(`!ok`) },
  numArmReturnMatchTest: { top: `function run(p, h) { const n = 1\n    return match n {\n      1 :> { const g = check\n        const ok = g(p, h)\n        ok ? "yes" : "no" }\n      else :> "no"\n    } }`, body: R(`run(pass, row.pw) == "no"`) },
  variantArmReturnMatchTest: { top: ENUM + `\n  function run(p, h) { const k: K = .A\n    return match k {\n      .A :> { const g = check\n        const ok = g(p, h)\n        ok ? "yes" : "no" }\n      else :> "no"\n    } }`, body: R(`run(pass, row.pw) == "no"`) },
  numArmArgMatchTest: { top: `function run(p, h) { const n = 1\n    const s = String(match n {\n      1 :> { const g = check\n        const ok = g(p, h)\n        ok ? "yes" : "no" }\n      else :> "no"\n    })\n    return s }`, body: R(`run(pass, row.pw) == "no"`) },
  numArmValueMatchTest: { body: `const n = 1\n    const s = match n {\n      1 :> { const g = check\n        const ok = g(pass, row.pw)\n        ok ? "yes" : "no" }\n      else :> "no"\n    }\n    ` + R(`s == "no"`) },
  productArmLiteral: { body: `const a = 1\n    const b = 2\n    match (a, b) {\n      (1, 2) :> { const g = check\n        ${RG} }\n      (_, _) :> { return "X" }\n    }\n    return "X"` },
  productArmWildcardBlock: { body: `const a = 1\n    const b = 2\n    match (a, b) {\n      (2, 2) :> { return "X" }\n      _ :> { const g = check\n        ${RG} }\n    }\n    return "X"` },
  strArmHelperReturn: { top: `function run(nm: string, p, h) { match nm {\n      "bob" :> { const g = check\n        return g(p, h) }\n      else :> { return false }\n    }\n    return false }`, body: R(`!run(name, pass, row.pw)`) },
  // gap g-server-match-arm-same-file-peer-call-not-defined-s465 (S465 review probe c3 `mPeer`): a
  // same-file server fn called from a literal arm's block had no peer callable (500, ReferenceError).
  peerCallInStrArm: { top: `function peer(p, h) { const row2 = ?{\`SELECT pw FROM users WHERE name = 'bob'\`}.get()\n    return check(p, h) }`, body: `let r = "REJECTED"\n    const k: string = name\n    match k {\n      "bob" :> { if (peer(pass, row.pw)) { r = "WELCOME" } }\n      else :> { r = "X" }\n    }\n    return r` },
  // gap g-nested-match-in-string-arm-block-unlowered-s467: a match nested in a string arm's block
  // (E-STMT-UNEXPECTED-TOKEN on the server before S468).
  nestedMatchInStrArm: { body: `let r = "REJECTED"\n    const k: string = name\n    const ok: boolean = check(pass, row.pw)\n    match k {\n      "bob" :> { match ok {\n          true :> { r = "WELCOME" }\n          else :> { r = "REJECTED" }\n        } }\n      else :> { r = "X" }\n    }\n    return r` },
};
