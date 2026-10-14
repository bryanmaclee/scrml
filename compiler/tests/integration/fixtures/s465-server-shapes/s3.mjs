// destructuring-pattern defaults and other pattern positions with an async imported call
const T = (body) => `let r = "REJECTED"
    ${body}
    return r`;
const M = (arm) => `let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> { ${arm} }
      else :> { r = "n" }
    }
    return r`;
export const S = {
  vObjDef: T(`const { a = verifyPassword(pass, row.pw) } = {}
    if (a) { r = "WELCOME" }`),
  vArrDef: T(`const [a = verifyPassword(pass, row.pw)] = []
    if (a) { r = "WELCOME" }`),
  vLetObjDef: T(`let { a = verifyPassword(pass, row.pw) } = {}
    if (a) { r = "WELCOME" }`),
  vNestDef: T(`const { o: { a = verifyPassword(pass, row.pw) } } = { o: {} }
    if (a) { r = "WELCOME" }`),
  vRenameDef: T(`const { x: a = verifyPassword(pass, row.pw) } = {}
    if (a) { r = "WELCOME" }`),
  vForOfDef: T(`for (const { a = verifyPassword(pass, row.pw) } of [{}]) { if (a) { r = "WELCOME" } }`),
  vArmObjDef: M(`const { a = verifyPassword(pass, row.pw) } = {}
        if (a) { r = "WELCOME" }`),
  vNegObjDef: T(`const { a = verifyPassword(pass, row.pw) } = {}
    if (!a) { return "REJECTED" }
    r = "WELCOME"`),
  vAsgDef: T(`let a = false
    ;({ a = verifyPassword(pass, row.pw) } = {})
    if (a) { r = "WELCOME" }`),
  vArrowParamDef: T(`const f = (z = verifyPassword(pass, row.pw)) => z
    if (f()) { r = "WELCOME" }`),
  vComputedKey: T(`const { [String(verifyPassword(pass, row.pw))]: a = 0 } = { "true": 1 }
    if (a) { r = "WELCOME" }`),
  vInitCall: T(`const { a } = { a: verifyPassword(pass, row.pw) }
    if (a) { r = "WELCOME" }`),
  vInitArr: T(`const [a] = [verifyPassword(pass, row.pw)]
    if (a) { r = "WELCOME" }`),
};
