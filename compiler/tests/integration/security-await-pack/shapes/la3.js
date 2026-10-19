// Family la3 (S469 fix round 2) — the S239 re-review of s468-literal-arm-block-p0 @ 435d55cd4.
// A genuine one-statement BLOCK arm `{ ok; }` (its result is `ok`, §18.5) was read as the
// shorthand OBJECT `{ ok: ok }` — truthy — because the r1 object-arm reader rebuilt
// `{ <expr> }` from the statement text, which had lost the `;`. `const allowed = match … { 1 :> {
// ok; } … }` then `if (!allowed)` never fired and a wrong password got in (FAIL on 435d55cd4; main
// emits `= ok`). Every head form and position the review hit: literal, number / string alternation,
// `.A`, `::A`, multi-scrutinee `_`, `const` / `let` declaration, a multi-line block, and `return`
// position (`.A`, `::A`, literal, multi-scrutinee `_`). Fix round 2 decides object-vs-block from the
// arm's TOKENS in the parser (a top-level `;` = a statement list = a block): every shape REJECTS.
// Controls: `{ ok; ok }`, `{ const t = ok; t }`, a keyed object arm read through its field.
export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const ENUM = `type K:enum = { A, B, C }`;
const OK = `const ok = check(pass, row.pw)\n    `;
// `const allowed = match <scrut> { <head> { ok; } <rest> }` then the gate.
const decl = (scrut, head, rest = `else :> false`, kw = "const", top) => ({
  top,
  body: OK + `${scrut}\n    ${kw} allowed = match ${scrut.split(" ")[1].replace(/:$/, "")} {\n      ${head} { ok; }\n      ${rest}\n    }\n    ` + R(`!allowed`),
});
// `function run(ok) { … return match … { <head> { ok; } … } }` then the gate on run(ok).
const ret = (scrut, head, rest = `else :> false`, top = "") => ({
  top: top + `\n  function run(ok) { ${scrut}\n    return match ${scrut.split(" ")[1].replace(/:$/, "")} {\n      ${head} { ok; }\n      ${rest}\n    } }`,
  body: OK + R(`!run(ok)`),
});
const MS = `(2, 2) :> false`;
export const SHAPES = {
  semiLit: decl(`const n = 1`, `1 :>`),
  semiNeg: decl(`const n = -1`, `-1 :>`),
  semiAltNum: decl(`const n = 1`, `1 | 2 :>`),
  semiAltStr: decl(`const s: string = name`, `"bob" | "amy" :>`),
  semiStr: decl(`const s: string = name`, `"bob" :>`),
  semiBool: decl(`const b = true`, `true :>`),
  semiVariant: decl(`const k: K = .A`, `.A :>`, `else :> false`, "const", ENUM),
  semiColonV: decl(`const k: K = .A`, `::A :>`, `else :> false`, "const", ENUM),
  semiVarAlt: decl(`const k: K = .A`, `.A | .B :>`, `.C :> false`, "const", ENUM),
  semiWild: decl(`const n = 1`, `_ :>`, ``),
  semiElse: decl(`const n = 1`, `2 :> false\n      else :>`, ``),
  semiLet: decl(`const n = 1`, `1 :>`, `else :> false`, "let"),
  semiLetVariant: decl(`const k: K = .A`, `.A :>`, `else :> false`, "let", ENUM),
  semiMultiLine: { body: OK + `const n = 1\n    const allowed = match n {\n      1 :> {\n        ok;\n      }\n      else :> false\n    }\n    ` + R(`!allowed`) },
  semiMultiLineV: { top: ENUM, body: OK + `const k: K = .A\n    const allowed = match k {\n      .A :> {\n        ok;\n      }\n      else :> false\n    }\n    ` + R(`!allowed`) },
  semiMsWild: { body: OK + `const a = 1\n    const b = 2\n    const allowed = match (a, b) {\n      ${MS}\n      _ :> { ok; }\n    }\n    ` + R(`!allowed`) },
  semiMsElse: { body: OK + `const a = 1\n    const b = 2\n    const allowed = match (a, b) {\n      ${MS}\n      else :> { ok; }\n    }\n    ` + R(`!allowed`) },
  semiRetLit: ret(`const n = 1`, `1 :>`),
  semiRetVariant: ret(`const k: K = .A`, `.A :>`, `else :> false`, ENUM),
  semiRetColonV: ret(`const k: K = .A`, `::A :>`, `else :> false`, ENUM),
  semiRetAltStr: ret(`const s: string = "bob"`, `"bob" | "amy" :>`),
  semiRetMsWild: { top: `function run(ok) { const a = 1\n    const b = 2\n    return match (a, b) {\n      ${MS}\n      _ :> { ok; }\n    } }`, body: OK + R(`!run(ok)`) },
  semiStmtAssign: { body: OK + `const n = 1\n    let allowed = false\n    match n {\n      1 :> { allowed = ok; }\n      else :> { allowed = false; }\n    }\n    ` + R(`!allowed`) },
  // controls
  ctlTwoStmts: decl(`const n = 1`, `1 :> { ok; ok }\n      2 :>`, `else :> false`),
  ctlConstTail: { body: OK + `const n = 1\n    const allowed = match n {\n      1 :> { const t = ok\n        t }\n      else :> false\n    }\n    ` + R(`!allowed`) },
  ctlKeyedObj: { body: OK + `const n = 1\n    const o = match n {\n      1 :> { v: ok }\n      else :> { v: false }\n    }\n    ` + R(`!o.v`) },
  ctlKeyedObjSemiTail: { body: OK + `const n = 1\n    const o = match n {\n      1 :> { v: ok, }\n      else :> { v: false }\n    }\n    ` + R(`!o.v`) },
};
