// r4 extra shapes
export const S = {
  tagSub: `const s = String.raw\`\${check(pass, row.pw)}\`
    if (s == "true") { return "WELCOME" }
    return "REJECTED"`,
  tagSubVP: `const s = String.raw\`a\${verifyPassword(pass, row.pw)}b\`
    if (s == "atrueb") { return "WELCOME" }
    return "REJECTED"`,
  tagPlain: `const s = String.raw\`x\${pass}y\`
    if (s == "xrighty") { return "WELCOME" }
    return "REJECTED"`,
  paramDef: `function inner(ok = check(pass, row.pw)) { return ok }
    if (inner()) { return "WELCOME" }
    return "REJECTED"`,
  paramDefPat: `function inner({ ok = check(pass, row.pw) }) { return ok }
    if (inner({})) { return "WELCOME" }
    return "REJECTED"`,
  arrowBlk: `const f = (q) => { return check(q, row.pw) }
    if (f(pass)) { return "WELCOME" }
    return "REJECTED"`,
  matchExpr: `const v = match pass { "x" :> false else :> check(pass, row.pw) }
    if (v) { return "WELCOME" }
    return "REJECTED"`,
  twoBlkSemi: `let i = 0
    { i = 1 }; { if (!check(pass, row.pw)) { return "REJECTED" } }
    return "WELCOME"`,
  destrDefOk: `const { a = 1, b = [2][0] } = {}
    if (a + b == 3 && check(pass, row.pw)) { return "WELCOME" }
    return "REJECTED"`,
};
