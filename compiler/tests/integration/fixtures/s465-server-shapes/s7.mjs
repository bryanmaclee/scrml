const T = (blk) => `let r = "WELCOME"
    let i = 4
    ${blk}
    return r`;
export const S = {
  bStr: T(`{ const s = "}"
      if (!check(pass, row.pw)) { return "REJECTED" } }`),
  bTpl: T(`{ const s = \`a\${ "}" }b\`
      if (!check(pass, row.pw)) { return "REJECTED" } }`),
  bRegex: T(`{ const ok = /}/.test("}")
      if (!check(pass, row.pw)) { return "REJECTED" } }`),
  bDivPost: T(`{ i++
      const q = i / 2
      if (!check(pass, row.pw)) { return "REJECTED" } }`),
  bDivAfterPostSameLine: T(`{ const q = (i++) / 2 / 1
      if (!check(pass, row.pw)) { return "REJECTED" } }`),
  bComment: T(`{ // a } comment
      if (!check(pass, row.pw)) { return "REJECTED" } }`),
  bBlockComment: T(`{ /* } */ if (!check(pass, row.pw)) { return "REJECTED" } }`),
  bTwoSameLine: T(`{ if (!check(pass, row.pw)) { return "REJECTED" } } { r = "WELCOME" }`),
  bTwoSemi: T(`{ i = 1 }; { if (!check(pass, row.pw)) { return "REJECTED" } }`),
  bObjInBlk: T(`{ const o = { a: 1 }
      if (!check(pass, row.pw)) { return "REJECTED" } }`),
};
