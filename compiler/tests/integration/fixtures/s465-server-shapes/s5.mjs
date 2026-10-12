// a depth-0 brace-head word suppresses the r3 boundary: is every swallowing statement kind refused on the server?
const G = `{ if (!check(pass, row.pw)) { return "REJECTED" } }`;
const T = (line) => `let r = "WELCOME"
    let t = 0
    ${line}
    ${G}
    return r`;
export const S = {
  wAssign: T(`t = row.type`),
  wCompound: T(`t += row.type`),
  wCall: T(`String(row.type)`),
  wCallBare: T(`plain(row.type)`),
  wAnnot: T(`const u: string = row.type`),
  wLetNoInit: T(`let u = row.type`),
  wMember: T(`row.type`),
  wIfOneLine: T(`if (t == 1) t = row.type`),
  wTernary: T(`t = t ? row.type : row.match`),
  wFnKw: T(`const f = function () { return 1 }`),
  wSqlRun: T(`?{\`SELECT 1 WHERE 'type' = 'x'\`}.run()`),
  wArrowFnBody: T(`const f = () => row.type`),
  wUseVar: T(`const use = 1`),
  wDoProp: T(`t = row.do`),
  wForProp: T(`t = row.for + 1`),
  wElseProp: T(`t = row.else`),
};
