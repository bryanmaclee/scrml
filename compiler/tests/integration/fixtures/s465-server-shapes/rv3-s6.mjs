const M = (arm) => `let r = "R"
    const k: string = "a"
    match (k) {
      "a" :> ${arm}
      else :> { r = "n" }
    }
    return r`;
export const S = {
  xLabelArm: M(`{ blk: { r = "inlabel" } }`),
  xLabelTop: `let r = "R"
    blk: { r = "inlabel" }
    return r`,
  xLabelLoopArm: M(`{ outer: for (const i of [1, 2]) { for (const j of [1, 2]) { if (j == 2) { continue outer } r = r + i + j } } }`),
  xLabelLoopTop: `let r = "R"
    outer: for (const i of [1, 2]) { for (const j of [1, 2]) { if (j == 2) { continue outer } r = r + i + j } }
    return r`,
  xCForArmPlain: M(`{ for (let i = 0; i < 3; i++) { r = r + i } }`),
  xBlockArmPlain: M(`{ { r = "inner" } }`),
};
