const G = `{ if (!check(pass, row.pw)) { return "REJECTED" } }`;
const T = (blk) => `let r = "WELCOME"
    let i = 4
    ${blk}
    return r`;
const M = (blk) => `let r = "WELCOME"
    const k: string = "a"
    match (k) {
      "a" :> { ${blk} }
      else :> { r = "n" }
    }
    return r`;
export const S = {
  xTwo: T(`${G} { i = 1 }`),
  xTwoFirst: T(`{ i = 1 } ${G}`),
  xBlkThenStmt: T(`${G} i = 2`),
  xBlkThenCall: T(`${G} String(i)`),
  xThree: T(`{ i = 1 } ${G} { i = 2 }`),
  xNested: T(`{ { i = 1 } ${G} }`),
  xArmTwo: M(`${G} { i = 1 }`),
  xArmNested: M(`{ { i = 1 } ${G} }`),
  xFirstStmt: `${G} { r = "x" }
    return "WELCOME"`,
  xBlkPos: T(`{ i = 1 } ${G.replace('!check', 'check').replace('"REJECTED"', '"WELCOME"')}
    return "REJECTED"`),
  xIfBody: T(`if (i == 4) { ${G} { i = 1 } }`),
  xForBody: T(`for (const q of [1]) { ${G} { i = 1 } }`),
};
