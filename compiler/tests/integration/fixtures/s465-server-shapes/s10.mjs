const G = `{ if (!check(pass, row.pw)) { return "REJECTED" } }`;
export const S = {
  aArmLvlBlk: `let r = "WELCOME"
    const k: string = "a"
    match (k) {
      "a" :> r = "WELCOME"
      ${G}
      else :> { r = "n" }
    }
    return r`,
  aArmLvlBlkLast: `let r = "WELCOME"
    const k: string = "a"
    match (k) {
      "a" :> r = "WELCOME"
      else :> r = "n"
      ${G}
    }
    return r`,
  aArmValBlk: `const k: string = "a"
    const r = match (k) {
      "a" :> "WELCOME"
      ${G}
      else :> "n"
    }
    return r`,
  aArmBlockThenBlk: `let r = "WELCOME"
    const k: string = "a"
    match (k) {
      "a" :> { r = "WELCOME" }
      ${G}
      else :> { r = "n" }
    }
    return r`,
};
