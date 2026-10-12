const M = (arm) => `let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> ${arm}
      else :> { r = "n" }
    }
    return r`;
const T = (body) => `let r = "REJECTED"
    ${body}
    return r`;
export const S = {
  wForIn: M(`{ for (const f in { a: 1 }) { if (check(pass, row.pw)) { r = "WELCOME" } } }`),
  wForInTop: T(`for (const f in { a: 1 }) { if (check(pass, row.pw)) { r = "WELCOME" } }`),
  wMulti: M(`{ let a = 1, b = 2
        if (check(pass, row.pw)) { r = "WELCOME" } }`),
  wMultiTop: T(`let a = 1, b = 2
    if (check(pass, row.pw)) { r = "WELCOME" }`),
  wBlock: M(`{ { if (check(pass, row.pw)) { r = "WELCOME" } } }`),
  wBlockTop: T(`{ if (check(pass, row.pw)) { r = "WELCOME" } }`),
  wShift: M(`{ const z = 8 >>> 1
        if (check(pass, row.pw)) { r = "WELCOME" } }`),
  wShiftTop: T(`const z = 8 >>> 1
    if (check(pass, row.pw)) { r = "WELCOME" }`),
  wCForPP: M(`{ for (let i = 0; i < 1; i = i + 1) { if (check(pass, row.pw)) { r = "WELCOME" } } }`),
  wCForStd: M(`{ for (let i = 0; i < 1; i++) { if (verifyPassword(pass, row.pw)) { r = "WELCOME" } } }`),
  wCForVal: `const k: string = "a"
    const r = match (k) {
      "a" :> {
        let ok = false
        for (let i = 0; i < 1; i++) { ok = check(pass, row.pw) }
        ok ? "WELCOME" : "REJECTED"
      }
      else :> "n"
    }
    return r`,
  wLabel: M(`{ blk: { if (check(pass, row.pw)) { r = "WELCOME" } } }`),
};
