// Probe family `s6` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s6.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const I = `import { check } from "./lib.scrml"\n  type R:enum = { Found(name:string), Missing }`;
const TL = `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + String(v)`;
export const SHAPES = {
  variantStrParen: { imports: I, body: `const r = .Found(name: "a (b)")\n    const v = "ok"\n    ${TL}` },
  arrVariantStrParen: { imports: I, body: `const r = [.Found(name: "a (b)"), .Missing]\n    const v = r.length\n    ${TL}` },
  matchArmsStrParen: { imports: I, body: `const r = R.Missing\n    const v = match r { .Found(n) => "f(" + n + ")" .Missing => "m(x)" }\n    ${TL}` },
  matchArmsCallSafe: { imports: I, body: `const r = R.Missing\n    const v = match r { .Found(n) => String(n) .Missing => String(1) }\n    ${TL}` },
  matchArmsImportedCall: { imports: I, body: `const r = R.Missing\n    const v = match r { .Found(n) => "x" .Missing => check(pass, row.pw) ? "ok" : "bad" }\n    if (v != "ok") { return "REJECTED" }\n    return "WELCOME"` },
  matchStmtImported: { imports: I, body: `const r = R.Missing\n    let v = "bad"\n    match r {\n      .Found(n) => { v = "x" }\n      .Missing => { if (check(pass, row.pw)) { v = "ok" } }\n    }\n    if (v != "ok") { return "REJECTED" }\n    return "WELCOME"` },
  variantPayloadCall: { imports: I, body: `const r = R.Found(String(check(pass, row.pw)))\n    let v = "bad"\n    match r {\n      .Found(n) => { v = n }\n      .Missing => { v = "m" }\n    }\n    if (v != "true") { return "REJECTED" }\n    return "WELCOME"` },
  variantNamedPayloadCall: { imports: I, body: `const r = R.Found(name: String(check(pass, row.pw)))\n    let v = "bad"\n    match r {\n      .Found(n) => { v = n }\n      .Missing => { v = "m" }\n    }\n    if (v != "true") { return "REJECTED" }\n    return "WELCOME"` },
  dotVariantNamedPayloadCall: { imports: I, body: `const r: R = .Found(name: String(check(pass, row.pw)))\n    let v = "bad"\n    match r {\n      .Found(n) => { v = n }\n      .Missing => { v = "m" }\n    }\n    if (v != "true") { return "REJECTED" }\n    return "WELCOME"` },
  returnVariantCall: { imports: I, top: `function g(pass: string, h: string) -> R { return .Found(name: String(check(pass, h))) }`, body: `const r = g(pass, row.pw)\n    let v = "bad"\n    match r {\n      .Found(n) => { v = n }\n      .Missing => { v = "m" }\n    }\n    if (v != "true") { return "REJECTED" }\n    return "WELCOME"` },
  isVariant: { imports: I, body: `const r = check(pass, row.pw) ? R.Found("a") : R.Missing\n    if (r is .Missing) { return "REJECTED" }\n    return "WELCOME"` },
};
