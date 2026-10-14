// bare blocks: arm + top level, benign (no async)
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
  bArmAfterVal: M(`{ let a = "1"
        { r = r + a } }`),
  bArmAfterValSemi: M(`{ let a = "1";
        { r = r + a } }`),
  bArmAfterCall: M(`{ r = r + "x"
        { r = r + "y" } }`),
  bArmTwo: M(`{ { r = r + "1" }
        { r = r + "2" } }`),
  bTopFirst: `{ r0 = 1 }
    return "x"`,
  bTopAfterLet: T(`{ r = r + "B" }`),
  bTopAfterLetSemi: `let r = "R";
    { r = r + "B" }
    return r`,
  bTopAfterIf: `let r = "R"
    if (name == "bob") { r = r + "I" }
    { r = r + "B" }
    return r`,
  bTopAfterFor: `let r = "R"
    for (const x of [1]) { r = r + x }
    { r = r + "B" }
    return r`,
  bTopShadow: `let r = "R"
    if (true) { r = r + "I" }
    { const r = "inner"
      name = r }
    return r + name`,
  bTopNested: `let r = "R"
    if (true) { r = r + "I" }
    { { r = r + "N" } }
    return r`,
  bTopAfterReturn: `let r = "R"
    if (true) { return r + "early" }
    { r = r + "B" }
    return r`,
  bTopLast: `let r = "R"
    if (true) { r = r + "I" }
    { r = r + "B" }`,
  bTopSecret: `let r = "R"
    if (true) { r = r + "I" }
    { const x = row.pw
      r = r + "-" }
    return r`,
};
