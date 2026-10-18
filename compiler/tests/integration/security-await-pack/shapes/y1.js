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
const IF = `export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`;
const VO = (s) => ({ lib: L(s), imports: `import { inner } from "./lib.scrml"`, body: BI });
export const SHAPES = {
  // comma / sequence
  topSeqApp: { top: `const g = (0, check)`, body: BG },
  libSeq: { lib: L(`function vp(p, h) { return verifyPassword(p, h) }\n  const inner = (0, vp)\n  ` + IF), body: B },
  // bind
  topBindApp: { top: `const g = check.bind(null)`, body: BG },
  libBind: { lib: L(`const inner = verifyPassword.bind(null)\n  ` + IF), body: B },
  voBind: VO(`function vp(p, h) { return verifyPassword(p, h) }\n  export const inner = vp.bind(null)`),
  // IIFE
  topIifeApp: { top: `const g = (() => check)()`, body: BG },
  topIifeLitApp: { top: `const g = (() => (a, b) => check(a, b))()`, body: BG },
  libIife: { lib: L(`const inner = (() => (p, h) => verifyPassword(p, h))()\n  ` + IF), body: B },
  voIife: VO(`export const inner = (() => (p, h) => verifyPassword(p, h))()`),
  // member of object
  topMemberApp: { top: `const o = { k: check }\n  const g = o.k`, body: BG },
  topIndexApp: { top: `const g = [check][0]`, body: BG },
  libMember: { lib: L(`const o = { k: verifyPassword }\n  const inner = o.k\n  ` + IF), body: B },
  // match expression arms
  topMatchApp: { top: `const g = match 1 { 1 => check, else => (a, b) => false }`, body: BG },
  // local scope reassign
  localReassign: { body: `let g = (a, b) => true\n    g = check\n    ` + BG },
  localReassignLoop: { body: `let g = (a, b) => true\n    for (const i of [1]) { g = check }\n    ` + BG },
  localAlias: { body: `const g = check\n    ` + BG },
  localSeq: { body: `const g = (0, check)\n    ` + BG },
  localBind: { body: `const g = check.bind(null)\n    ` + BG },
  localIife: { body: `const g = (() => check)()\n    ` + BG },
  localMember: { body: `const o = { k: check }\n    ` + R(`!o.k(pass, row.pw)`) },
  // nested function-scope reassign of a top-level let
  topLetNestedWrite: { top: `let g = (a, b) => true\n  function setG() { g = check }\n  setG()`, body: BG },
  topLetIfWrite: { top: `let g = (a, b) => true\n  if (true) { g = check }`, body: BG },
  // default param
  defaultParam: { app: null, top: `function h(p, w, v = check) { return v(p, w) }`, body: R(`!h(pass, row.pw)`) },
  // destructured exports
  libDestructExport: { lib: L(`const o = { inner: (p, h) => verifyPassword(p, h) }\n  export const { inner } = o\n  ` + IF), body: B },
  voDestructExport: VO(`const o = { inner: (p, h) => verifyPassword(p, h) }\n  export const { inner } = o`),
  // namespace import of a lib
  nsImport: { imports: `import * as lib from "./lib.scrml"`, body: R(`!lib.check(pass, row.pw)`) },
  // re-export chain 3 modules
  reexport3: { lib2: L(`export function check(p, h) { return verifyPassword(p, h) }`), files: { "lib3.scrml": `\${\n  export { check } from "./lib2.scrml"\n}\n` }, lib: `\${\n  export { check } from "./lib3.scrml"\n}\n`, body: B },
  chain3const: { lib2: L(`export const vp = (p, h) => verifyPassword(p, h)`), files: { "lib3.scrml": `\${\n  import { vp } from "./lib2.scrml"\n  export const vq = (p, h) => vp(p, h)\n}\n` }, lib: `\${\n  import { vq } from "./lib3.scrml"\n  export const check = (p, h) => vq(p, h)\n}\n`, body: B },
  chain3alias: { lib2: L(`export const vp = (p, h) => verifyPassword(p, h)`), files: { "lib3.scrml": `\${\n  import { vp } from "./lib2.scrml"\n  export const vq = vp\n}\n` }, lib: `\${\n  import { vq } from "./lib3.scrml"\n  export const check = vq\n}\n`, body: B },
  // binding from imported async value
  importedAsyncAlias: { lib2: L(`export function vp(p, h) { return verifyPassword(p, h) }`), lib: `\${\n  import { vp } from "./lib2.scrml"\n  const inner = vp\n  ${IF}\n}\n`, body: B },
  // getter
  getter: { lib: L(`const o = { get f() { return (p, h) => verifyPassword(p, h) } }\n  export function check(p, h) { if (!o.f(p, h)) { return false }\n    return true }`), body: B },
  // Map storage
  mapStore: { lib: L(`const m = new Map()\n  m.set("k", verifyPassword)\n  export function check(p, h) { if (!m.get("k")(p, h)) { return false }\n    return true }`), body: B },
  // logical assign at top
  topLetOrAssign: { top: `let g = null\n  g ||= check`, body: BG },
  // async written fn decl export var
  libVar: { lib: L(`var inner = (p, h) => verifyPassword(p, h)\n  ` + IF), body: B },
  // template / type cast
  topAsCast: { top: `const g = check as any`, body: BG },
  // call through Reflect/apply
  applyCall: { body: R(`!check.apply(null, [pass, row.pw])`) },
  callCall: { body: R(`!check.call(null, pass, row.pw)`) },
  // spread args
  spreadArgs: { body: `const a = [pass, row.pw]\n    ` + R(`!check(...a)`) },
  // optional call
  optCall: { body: R(`!check?.(pass, row.pw)`) },
  // negation via comparison
  eqFalse: { body: R(`check(pass, row.pw) == false`) },
  // passing through array method
  someCall: { body: R(`![1].some(() => check(pass, row.pw))`) },
  // promise in ternary
  ternUse: { body: `const ok = true ? check(pass, row.pw) : false\n    ` + R(`!ok`) },
};
