// a dropped second bare block that is a GUARD -> fail open?
const M = (arm) => `let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> ${arm}
      else :> { r = "n" }
    }
    return r`;
export const S = {
  gArmTwoBlk: M(`{ { r = "WELCOME" }
        { if (!check(pass, row.pw)) { r = "REJECTED" } } }`),
  gArmTwoBlkV: M(`{ { r = "WELCOME" }
        { if (!verifyPassword(pass, row.pw)) { r = "REJECTED" } } }`),
  gArmBlkIf: M(`{ { r = "WELCOME" }
        if (!check(pass, row.pw)) { r = "REJECTED" } }`),
  gArmThree: M(`{ { r = "WELCOME" }
        { r = "WELCOME" }
        { if (!check(pass, row.pw)) { r = "REJECTED" } } }`),
  gTopTwoBlk: `let r = "REJECTED"
    if (true) { r = "x" }
    { r = "WELCOME" }
    { if (!check(pass, row.pw)) { r = "REJECTED" } }
    return r`,
  gTopBlkIf: `let r = "REJECTED"
    if (true) { r = "x" }
    { r = "WELCOME" }
    if (!check(pass, row.pw)) { r = "REJECTED" }
    return r`,
  gHandler: { fn: `let r = "REJECTED"
    const v = check(pass, row.pw) !{ _ :> { { r = "x" }
        { r = "y" } } }
    if (v) { r = "WELCOME" }
    return r` },
};
