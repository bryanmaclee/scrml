// C-for loop-variable reassignment inside the body (arm vs top level)
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
  fAsgArm: M(`{ for (let i = 0; i < 10; i++) { i = i + 4
          r = r + i } }`),
  fAsgTop: T(`for (let i = 0; i < 10; i++) { i = i + 4
      r = r + i }`),
  fAsgArmIf: M(`{ for (let i = 0; i < 10; i++) { if (i == 0) { i = 7 }
          r = r + i } }`),
  fAsgTopIf: T(`for (let i = 0; i < 10; i++) { if (i == 0) { i = 7 }
      r = r + i }`),
  fUpdArm: M(`{ for (let i = 0; i < 1; i = i + 1) { r = r + i } }`),
};
