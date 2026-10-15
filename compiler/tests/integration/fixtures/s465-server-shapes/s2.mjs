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
  pObjDef: T(`const { a = check(pass, row.pw) } = {}
    if (a) { r = "WELCOME" }`),
  pArrDef: T(`const [a = check(pass, row.pw)] = []
    if (a) { r = "WELCOME" }`),
  pLetObjDef: T(`let { a = check(pass, row.pw) } = {}
    if (a) { r = "WELCOME" }`),
  pNestDef: T(`const { o: { a = check(pass, row.pw) } } = { o: {} }
    if (a) { r = "WELCOME" }`),
  pRenameDef: T(`const { x: a = check(pass, row.pw) } = {}
    if (a) { r = "WELCOME" }`),
  pForOfDef: T(`for (const { a = check(pass, row.pw) } of [{}]) { if (a) { r = "WELCOME" } }`),
  pArmObjDef: M(`const { a = check(pass, row.pw) } = {}
        if (a) { r = "WELCOME" }`),
  pNegObjDef: T(`const { a = check(pass, row.pw) } = {}
    if (!a) { return "REJECTED" }
    r = "WELCOME"`),
  pAsgDef: T(`let a = false
    ;({ a = check(pass, row.pw) } = {})
    if (a) { r = "WELCOME" }`),
  pArrowParamDef: T(`const f = (z = check(pass, row.pw)) => z
    if (f()) { r = "WELCOME" }`),
  pComputedKey: T(`const { [String(check(pass, row.pw))]: a = 0 } = { "true": 1 }
    if (a) { r = "WELCOME" }`),
  pInitCall: T(`const { a } = { a: check(pass, row.pw) }
    if (a) { r = "WELCOME" }`),
  pInitArr: T(`const [a] = [check(pass, row.pw)]
    if (a) { r = "WELCOME" }`),
};
