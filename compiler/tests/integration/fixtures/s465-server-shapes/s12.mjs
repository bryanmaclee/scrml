// head-only fail-open: a positive guard in a same-line `{A} {B}` after a value line
export const S = {
  zPos: `let i = 4
    { i = 1 } { if (check(pass, row.pw)) { return "WELCOME" } }
    return "REJECTED"`,
  zPosVP: `let i = 4
    { i = 1 } { if (verifyPassword(pass, row.pw)) { return "WELCOME" } }
    return "REJECTED"`,
  zPosArm: `const k: string = "a"
    let i = 4
    match (k) {
      "a" :> { let j = 1
        { i = 1 } { if (check(pass, row.pw)) { return "WELCOME" } } }
      else :> { i = 2 }
    }
    return "REJECTED"`,
};
