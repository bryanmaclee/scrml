const G = `{ if (!check(pass, row.pw)) { return "REJECTED" } }`;
const T = (line) => `let r = "WELCOME"
    let t = 0
    ${line}
    ${G}
    return r`;
const M = (line) => `let r = "WELCOME"
    let t = 0
    const k: string = "a"
    match (k) {
      "a" :> {
        ${line}
        ${G}
      }
      else :> { r = "n" }
    }
    return r`;
export const S = {
  eIfElse: T(`if (t == 1) t = 2 else t = 3`),
  eIfElseB: T(`if (t == 1) { t = 2 } else t = 3`),
  eIfNoElse: T(`if (t == 0) t = 3`),
  eFor1: T(`for (let i = 0; i < 1; i++) t = i`),
  eWhile1: T(`while (t < 0) t = 1`),
  eForOf1: T(`for (const q of [1]) t = q`),
  eLabelFor: T(`lbl: for (const q of [1]) t = q`),
  mIfElse: M(`if (t == 1) t = 2 else t = 3`),
  mFor1: M(`for (const q of [1]) t = q`),
  mIfNoElse: M(`if (t == 0) t = 3`),
};
