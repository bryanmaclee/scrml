export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const L = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
const BI = R(`!inner(pass, row.pw)`);
const L2 = L(`export function vp(p, h) { return verifyPassword(p, h) }`);
const VI = (s) => ({ lib2: L2, lib: `\${\n  import { vp } from "./lib2.scrml"\n  ${s}\n}\n`, imports: `import { inner } from "./lib.scrml"`, body: BI });
export const SHAPES = {
  vo2Iife: VI(`export const inner = (() => vp)()`),
  vo2IifeLit: VI(`export const inner = (() => (p, h) => vp(p, h))()`),
  vo2Curried: VI(`const mk = (a) => (p, h) => vp(p, h)\n  export const inner = mk(1)`),
  vo2Seq: VI(`export const inner = (0, vp)`),
  vo2Bind: VI(`export const inner = vp.bind(null)`),
  vo2Member: VI(`export const inner = { k: vp }.k`),
  vo2Opt: VI(`export const inner = vp ?? null`),
  vo2Paren: VI(`export const inner = (vp)`),
  vo2Annot: VI(`export const inner: any = (() => vp)()`),
  vo2Lambda: VI(`export const inner = (p, h) => vp(p, h)`),
  okLib2ServerConst: { lib2: L(`export function vp(p, h) { return verifyPassword(p, h) }\n  export const S2 = "right-password"`), lib: `\${\n  import { S2 } from "./lib2.scrml"\n  export const SECRET = S2\n}\n`, imports: `import { SECRET } from "./lib.scrml"`, body: R(`pass != SECRET`) },
  okLib2ServerLet: { lib2: L(`export function vp(p, h) { return verifyPassword(p, h) }\n  export const S2: string = "right-password"`), lib: `\${\n  import { S2 } from "./lib2.scrml"\n  export const SECRET = S2\n}\n`, imports: `import { SECRET } from "./lib.scrml"`, body: R(`pass != SECRET`) },
};
