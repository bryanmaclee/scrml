const T = (body) => `let r = "REJECTED"
    ${body}
    return r`;
export const S = {
  qObjMeth: T(`const o = { m() { return check(pass, row.pw) } }
    if (o.m()) { r = "WELCOME" }`),
  qMatchSubj: T(`const v = match (check(pass, row.pw)) {
      true :> "WELCOME"
      false :> "REJECTED"
    }
    r = v`),
  qGiven: T(`const ok = check(pass, row.pw)
    given ok => { r = "WELCOME" }`),
  qTxn: T(`transaction { if (check(pass, row.pw)) { r = "WELCOME" } }`),
  qBlkAfterTern: T(`const z = pass == "x" ? 1 : 2
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterCallLine: T(`const z = String(pass)
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterIdx: T(`const z = [1][0]
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterTypeKw: T(`const z: string = pass
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterNot: T(`let z = not
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterIsSome: T(`const z = pass is some
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterPost: T(`let i = 0
    i++
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterSql: T(`const c = ?{\`SELECT 1 AS one\`}.get()
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterArrow: T(`const f = (q) => q
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterFnExpr: T(`const f = function (q) { return q }
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterMatchExpr: T(`const k: string = "a"
    const v = match k {
      "a" :> 1
      else :> 2
    }
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterIfExpr: T(`const v = if (pass == "q") { 1 } else { 2 }
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  qBlkAfterTypeProp: T(`const v = row.type
    { if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
};
