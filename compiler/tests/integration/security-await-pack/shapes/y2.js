export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const L = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
const B = R(`!check(pass, row.pw)`);
const BI = R(`!inner(pass, row.pw)`);
const BG = R(`!g(pass, row.pw)`);
const VO = (s, body = BI) => ({ lib: L(s), imports: `import { inner } from "./lib.scrml"`, body });
const VP = `function vp(p, h) { return verifyPassword(p, h) }\n  `;
export const SHAPES = {
  voIife: VO(`export const inner = (() => (p, h) => verifyPassword(p, h))()`),
  voIifeAlias: VO(VP + `export const inner = (() => vp)()`),
  voFactory: VO(`function mk() { return (p, h) => verifyPassword(p, h) }\n  export const inner = mk()`),
  voFactoryDecl: VO(VP + `function mk() { return vp }\n  export const inner = mk()`),
  voCurriedCall: VO(`const mk = (a) => (p, h) => verifyPassword(p, h)\n  export const inner = mk(1)`),
  voMember: VO(`const o = { k: (p, h) => verifyPassword(p, h) }\n  export const inner = o.k`),
  voIndex: VO(VP + `export const inner = [vp][0]`),
  voSeq: VO(VP + `export const inner = (0, vp)`),
  voCast: VO(VP + `export const inner = vp as any`),
  voMatch: VO(VP + `export const inner = match 1 { 1 => vp, else => (p, h) => false }`),
  voNsMember: { lib: `\${\n  import * as auth from "scrml:auth"\n  export const inner = auth.verifyPassword\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: BI },
  voDirectStd: { lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  export const inner = verifyPassword\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: BI },
  voObjExport: { lib: L(`export const auth = { inner: (p, h) => verifyPassword(p, h) }`), imports: `import { auth } from "./lib.scrml"`, body: R(`!auth.inner(pass, row.pw)`) },
  voLetLater: VO(`export let inner = (p, h) => true\n  inner = (p, h) => verifyPassword(p, h)`),
  voIfWrite: VO(`export let inner = (p, h) => true\n  if (true) { inner = (p, h) => verifyPassword(p, h) }`),
  voAnnotIife: VO(`export const inner: any = (() => (p, h) => verifyPassword(p, h))()`),
  voAsyncAwaitIife: VO(`export const inner = (() => async (p, h) => await verifyPassword(p, h))()`),
  voPromiseValue: VO(`export const inner = verifyPassword("x", "y")`, R(`!(inner)`)),
  // app top-level analogues
  topIfeLit: { top: `const g = (() => (a, b) => check(a, b))()`, body: BG },
  topLetPlainWrite: { top: `let g = (a, b) => true\n  g = check`, body: BG },
  topLetIfLit: { top: `let g = (a, b) => true\n  if (true) { g = (a, b) => check(a, b) }`, body: BG },
  // server fn calling server fn (local async chain)
  localChain: { top: `function c2(a, b) { return check(a, b) }\n  function c3(a, b) { const r = c2(a, b)\n    return r }`, body: R(`!c3(pass, row.pw)`) },
  // correctness: value-only import of a plain const used server-side
  okConst: { lib: `\${\n  export const SECRET = "right-password"\n}\n`, imports: `import { SECRET } from "./lib.scrml"`, body: R(`pass != SECRET`) },
  okConstFromLib2: { lib2: `\${\n  export const S2 = "right-password"\n}\n`, lib: `\${\n  import { S2 } from "./lib2.scrml"\n  export const SECRET = S2\n}\n`, imports: `import { SECRET } from "./lib.scrml"`, body: R(`pass != SECRET`) },
  okConstExprLib2: { lib2: `\${\n  export const S2 = "right-"\n}\n`, lib: `\${\n  import { S2 } from "./lib2.scrml"\n  export const SECRET = S2 + "password"\n}\n`, imports: `import { SECRET } from "./lib.scrml"`, body: R(`pass != SECRET`) },
  okSyncFnLib2: { lib2: `\${\n  export function mk(a) { return a + "password" }\n}\n`, lib: `\${\n  import { mk } from "./lib2.scrml"\n  export const SECRET = mk("right-")\n}\n`, imports: `import { SECRET } from "./lib.scrml"`, body: R(`pass != SECRET`) },
  okSyncArrowLib2: { lib2: `\${\n  export const mk = (a) => a + "password"\n}\n`, lib: `\${\n  import { mk } from "./lib2.scrml"\n  export const SECRET = mk("right-")\n}\n`, imports: `import { SECRET } from "./lib.scrml"`, body: R(`pass != SECRET`) },
  okSyncFnValue: { lib: `\${\n  export const eq = (a, b) => a == b\n}\n`, imports: `import { eq } from "./lib.scrml"`, body: R(`!eq(pass, "right-password")`) },
  okSyncTernary: { lib: `\${\n  export const eq = true ? (a, b) => a == b : (a, b) => false\n}\n`, imports: `import { eq } from "./lib.scrml"`, body: R(`!eq(pass, "right-password")`) },
  okSyncAlias: { lib: `\${\n  function e1(a, b) { return a == b }\n  export const eq = e1\n}\n`, imports: `import { eq } from "./lib.scrml"`, body: R(`!eq(pass, "right-password")`) },
  okSyncLetWrite: { lib: `\${\n  export let eq = (a, b) => false\n  eq = (a, b) => a == b\n}\n`, imports: `import { eq } from "./lib.scrml"`, body: R(`!eq(pass, "right-password")`) },
  okTopSyncAlias: { top: `function e1(a, b) { return a == b }\n  const eq = e1`, body: R(`!eq(pass, "right-password")`) },
  okTopSyncTern: { top: `const eq = true ? (a, b) => a == b : (a, b) => false`, body: R(`!eq(pass, "right-password")`) },
  okEnumServer: { lib: `\${\n  export type Role:enum = { Admin, User }\n  export const R0 = Role.Admin\n}\n`, imports: `import { R0 } from "./lib.scrml"`, body: R(`pass != "right-password" || R0 == null`) },
};
