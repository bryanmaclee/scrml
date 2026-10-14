// server: remaining text-lowered forms with an async imported call
const T = (body) => `let r = "REJECTED"
    ${body}
    return r`;
export const S = {
  sAs: T(`const ok = check(pass, row.pw) as boolean
    if (ok) { r = "WELCOME" }`),
  sNot: T(`if (not check(pass, row.pw)) { return "REJECTED" }
    r = "WELCOME"`),
  sDestrArr: T(`let a = false
    let b = 0
    ;[a, b] = [check(pass, row.pw), 1]
    if (a) { r = "WELCOME" }`),
  sDestrDecl: T(`const [a, b] = [check(pass, row.pw), 1]
    if (a) { r = "WELCOME" }`),
  sDestrDeclObj: T(`const { a } = { a: check(pass, row.pw) }
    if (a) { r = "WELCOME" }`),
  sDestrDefault: T(`const { a = check(pass, row.pw) } = {}
    if (a) { r = "WELCOME" }`),
  sComputed: T(`const o = { [String(check(pass, row.pw))]: 1 }
    if (o["true"]) { r = "WELCOME" }`),
  sSpread: T(`const arr = [...[check(pass, row.pw)]]
    if (arr[0]) { r = "WELCOME" }`),
  sOptCall: T(`const ok = row?.pw && check(pass, row?.pw)
    if (ok) { r = "WELCOME" }`),
  sTypeof: T(`if (typeof check(pass, row.pw) == "boolean") { if (check(pass, row.pw)) { r = "WELCOME" } }`),
  sIn: T(`const o = { k: 1 }
    if ((check(pass, row.pw) ? "k" : "z") in o) { r = "WELCOME" }`),
  sTernNested: T(`r = check(pass, row.pw) ? (check(pass, row.pw) ? "WELCOME" : "X") : "REJECTED"`),
  sTmplPlain: T(`const s = \`\${check(pass, row.pw)}\`
    if (s == "true") { r = "WELCOME" }`),
  sNegGuard: T(`const s = String.raw\`\${check(pass, row.pw)}\`
    if (s != "false") { r = "WELCOME" }`),
  sNew: T(`const b = new Boolean(check(pass, row.pw))
    if (b.valueOf()) { r = "WELCOME" }`),
  sArrowIIFE: T(`const ok = (() => check(pass, row.pw))()
    if (ok) { r = "WELCOME" }`),
  sAsyncArrow: T(`const f = async () => check(pass, row.pw)
    const ok = await f()
    if (ok) { r = "WELCOME" }`),
  sWhileGuard: T(`let n = 0
    while (n < 1) { n = n + 1
      if (!check(pass, row.pw)) { return "REJECTED" } }
    r = "WELCOME"`),
  sDoGuard: T(`do { if (!check(pass, row.pw)) { return "REJECTED" } } while (false)
    r = "WELCOME"`),
  sLabelBlk: T(`outer: { if (!check(pass, row.pw)) { break outer }
      r = "WELCOME" }`),
  sBlkAfterRet: T(`if (!check(pass, row.pw)) { return "REJECTED" }
    { r = "WELCOME" }`),
  sMemberCall: T(`const ok = [check(pass, row.pw)].includes(true)
    if (ok) { r = "WELCOME" }`),
  sChainCall: T(`const ok = String(check(pass, row.pw)).trim() == "true"
    if (ok) { r = "WELCOME" }`),
};
