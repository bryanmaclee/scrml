// labels on loops (arm + top) and async in loop headers
const M = (arm) => `let r = "R"
    const k: string = "a"
    match (k) {
      "a" :> ${arm}
      else :> { r = "n" }
    }
    return r`;
const T = (body) => `let r = "R"
    ${body}
    return r`;
export const S = {
  lBrkArm: M(`{ outer: for (let i = 0; i < 3; i++) { for (const j of [1, 2]) { if (i == 1) { break outer } r = r + i + j } } }`),
  lBrkTop: T(`outer: for (let i = 0; i < 3; i++) { for (const j of [1, 2]) { if (i == 1) { break outer } r = r + i + j } }`),
  lNestArm: M(`{ a: for (const i of [1, 2]) { b: for (let j = 0; j < 3; j++) { for (;;) { if (j == 1) { continue a }
            if (j == 0) { continue b }
            break } } } }`),
  lWhileArm: M(`{ let n = 0
        w: while (n < 3) { n = n + 1
          for (const j of [1]) { if (n == 2) { continue w } r = r + n } } }`),
  lAsyncArm: M(`{ outer: for (let i = 0; i < 2; i++) { if (check(pass, row.pw)) { r = "WELCOME"
            break outer } } }`),
  lAsyncTop: T(`outer: for (let i = 0; i < 2; i++) { if (check(pass, row.pw)) { r = "WELCOME"
        break outer } }`),
  lForOfAsync: M(`{ for (const x of [check(pass, row.pw)]) { if (x) { r = "WELCOME" } } }`),
};
