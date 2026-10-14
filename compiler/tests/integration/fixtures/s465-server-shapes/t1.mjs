// arm-value and arm-block shapes vs top-level equivalents (async-call reach)
const M = (arm) => `let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> ${arm}
      else :> { r = "n" }
    }
    return r`;
const V = (val) => `const k: string = "a"
    const r = match (k) {
      "a" :> ${val}
      else :> "n"
    }
    return r`;
const T = (body) => `let r = "REJECTED"
    ${body}
    return r`;
export const S = {
  aSeqVal: V(`(0, check(pass, row.pw)) ? "WELCOME" : "REJECTED"`),
  aSeqTop: T(`const ok = (0, check(pass, row.pw))
    if (ok) { r = "WELCOME" }`),
  aSeqArm: M(`{ const ok = (0, check(pass, row.pw))
        if (ok) { r = "WELCOME" } }`),
  aIIFEVal: V(`(() => check(pass, row.pw))() ? "WELCOME" : "REJECTED"`),
  aTmplVal: V(`\`\${check(pass, row.pw)}\` == "true" ? "WELCOME" : "REJECTED"`),
  aAndVal: V(`check(pass, row.pw) && "WELCOME" || "REJECTED"`),
  aNotVal: V(`!check(pass, row.pw) ? "REJECTED" : "WELCOME"`),
  aArrVal: V(`[check(pass, row.pw)][0] ? "WELCOME" : "REJECTED"`),
  aObjVal: V(`{ ok: check(pass, row.pw) }.ok ? "WELCOME" : "REJECTED"`),
  aWhileArm: M(`{ let i = 0
        while (i < 1 && check(pass, row.pw)) { r = "WELCOME"
          i = i + 1 } }`),
  aDoArm: M(`{ let ok = false
        do { ok = check(pass, row.pw) } while (false)
        if (ok) { r = "WELCOME" } }`),
  aCForTest: M(`{ for (let i = 0; i < 1 && check(pass, row.pw); i++) { r = "WELCOME" } }`),
  aCForUpd: M(`{ let ok = false
        for (let i = 0; i < 1; ok = check(pass, row.pw)) { i = 5 }
        if (ok) { r = "WELCOME" } }`),
  aCForInit: M(`{ for (let ok = check(pass, row.pw), i = 0; i < 1; i++) { if (ok) { r = "WELCOME" } } }`),
  aCForInit1: M(`{ for (let ok = check(pass, row.pw); ok; ok = false) { r = "WELCOME" } }`),
  aCForInitTop: T(`for (let ok = check(pass, row.pw); ok; ok = false) { r = "WELCOME" }`),
  aCForNoDecl: M(`{ let ok = false
        for (ok = check(pass, row.pw); ok; ok = false) { r = "WELCOME" } }`),
  aCForEmpty: M(`{ for (;;) { if (check(pass, row.pw)) { r = "WELCOME" }
          break } }`),
  aCForEmptyTop: T(`for (;;) { if (check(pass, row.pw)) { r = "WELCOME" }
      break }`),
  aTernStmt: M(`{ r = check(pass, row.pw) ? "WELCOME" : "REJECTED" }`),
  aNestedBlk: M(`{ { { if (check(pass, row.pw)) { r = "WELCOME" } } } }`),
  aBlkConst: M(`{ const ok = false
        { const ok = check(pass, row.pw)
          if (ok) { r = "WELCOME" } } }`),
};
