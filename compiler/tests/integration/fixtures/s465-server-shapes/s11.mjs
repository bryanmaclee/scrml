const T = (body) => `let r = "R"
    ${body}
    return r`;
export const S = {
  cShadow: T(`for (let i = 0; i < 2; i++) { const i2 = i * 10
      r = r + i2 }`),
  cRedecl: T(`for (let i = 0; i < 2; i++) { let k = i
      k = k + 1
      r = r + k }`),
  cOuterSame: T(`let i = 100
    for (let i = 0; i < 2; i++) { r = r + i }
    r = r + i`),
  cAssignOuter: T(`let j = 0
    for (let i = 0; i < 3; i++) { j = i }
    r = r + j`),
  cNoDecl: T(`let i = 7
    for (i = 0; i < 2; i++) { r = r + i }
    r = r + i`),
  cNestedSame: T(`for (let i = 0; i < 2; i++) { for (let i = 5; i < 6; i++) { r = r + i } r = r + i }`),
  cAfterLoopName: T(`for (let i = 0; i < 2; i++) { r = r + i }
    let i = 9
    r = r + i`),
};
