// bare block after a value whose statement contains a brace-head WORD used as a plain identifier/property
const G = `{ if (!check(pass, row.pw)) { return "REJECTED" } }`;
const T = (line) => `let r = "WELCOME"
    ${line}
    ${G}
    return r`;
const M = (line) => `let r = "WELCOME"
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
  uType: T(`const t = row.type`),
  uUse: T(`const t = row.use`),
  uMatch: T(`const t = row.match`),
  uServer: T(`const t = row.server`),
  uDo: T(`const t = row.do`),
  uWhen: T(`const t = row.when`),
  uImport: T(`const t = row.import`),
  uElse: T(`const t = row.else`),
  uFor: T(`const t = row.for`),
  uClass: T(`const t = row.class`),
  uFnStr: T(`const t = "function"`),
  uPlain: T(`const t = row.name`),
  mType: M(`const t = row.type`),
  mDo: M(`const t = row.do`),
  mPlain: M(`const t = row.name`),
};
