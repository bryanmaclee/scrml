// Family la4 (S469 fix round 3) — ruling S469 "Compile error": a match-arm brace body that is
// exactly ONE bare shorthand name, `{ ok }` (no `;`), is E-MATCH-ARM-SHORTHAND-AMBIGUOUS (§18.5).
// Read as the object `{ ok: ok }` it is truthy, so `const allowed = match … { <head> { ok } … }`
// then `if (!allowed)` let a wrong password in on 435d55cd4 / ae833fb26. Every head form, in
// declaration (`const` / `let`), `return` and argument position (a `match` inside a call, whose
// arms the expression parser carries as text), plus a statement-position and a lambda-body match.
// Every shape must be PASS-REFUSED.
export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const ENUM = `type K:enum = { A, B, C }`;
const OK = `const ok = check(pass, row.pw)\n    `;
// [name, scrutinee decl, subject, arm head, rest arms, needs ENUM]
const HEADS = [
  ["Lit", `const n = 1`, `n`, `1 :>`, `else :> false`, false],
  ["Neg", `const n = -1`, `n`, `-1 :>`, `else :> false`, false],
  ["AltNum", `const n = 1`, `n`, `1 | 2 :>`, `else :> false`, false],
  ["Str", `const s: string = name`, `s`, `"bob" :>`, `else :> false`, false],
  ["AltStr", `const s: string = name`, `s`, `"bob" | "amy" :>`, `else :> false`, false],
  ["Bool", `const b = true`, `b`, `true :>`, `else :> false`, false],
  ["Variant", `const k: K = .A`, `k`, `.A :>`, `else :> false`, true],
  ["ColonV", `const k: K = .A`, `k`, `::A :>`, `else :> false`, true],
  ["VarAlt", `const k: K = .A`, `k`, `.A | .B :>`, `.C :> false`, true],
  ["Else", `const n = 1`, `n`, `2 :> false\n      else :>`, ``, false],
  ["Wild", `const n = 1`, `n`, `2 :> false\n      _ :>`, ``, false],
  ["MsWild", `const a = 1\n    const b = 2`, `(a, b)`, `(2, 2) :> false\n      _ :>`, ``, false],
];
const arms = (head, rest) => `      ${head} { ok }\n${rest ? `      ${rest}\n` : ""}`;
export const SHAPES = {};
for (const [nm, scrut, subj, head, rest, en] of HEADS) {
  const top = en ? ENUM : undefined;
  SHAPES[`shDecl${nm}`] = { top, body: OK + `${scrut}\n    const allowed = match ${subj} {\n${arms(head, rest)}    }\n    ` + R(`!allowed`) };
  SHAPES[`shLet${nm}`] = { top, body: OK + `${scrut}\n    let allowed = match ${subj} {\n${arms(head, rest)}    }\n    ` + R(`!allowed`) };
  SHAPES[`shRet${nm}`] = {
    top: (en ? ENUM + "\n  " : "") + `function run(ok, name) { ${scrut}\n    return match ${subj} {\n${arms(head, rest)}    } }`,
    body: OK + R(`!run(ok, name)`),
  };
  SHAPES[`shArg${nm}`] = { top, body: OK + `${scrut}\n    const allowed = Boolean(match ${subj} {\n${arms(head, rest)}    })\n    ` + R(`!allowed`) };
}
SHAPES.shStmt = { body: OK + `const n = 1\n    let allowed = false\n    match n {\n      1 :> { ok }\n      else :> { allowed = false; }\n    }\n    ` + R(`!allowed`) };
// S469 r4 — §18.19 PRODUCT arms (`(p1, p2) :> { … }`) kept their body as text, so `{ ok }` there
// was neither refused nor classified (WELCOME on 187294fd8 and on main). Now read by the same arm
// reader: `{ ok }` / `{ ok, }` REFUSED; `{ ok; }` a block that REJECTS.
const P2 = `const a = 1\n    const b = 2`;
const prod = (kw, head, body, rest) => ({ body: OK + `${P2}\n    ${kw} allowed = match (a, b) {\n      ${head} :> ${body}\n      ${rest}\n    }\n    ` + R(`!allowed`) });
SHAPES.prodDecl = prod("const", "(1, 2)", "{ ok }", "(_, _) :> false");
SHAPES.prodDeclWild = prod("const", "(2, 2) :> false\n      (_, _)", "{ ok }", "");
SHAPES.prodDeclTrailComma = prod("const", "(1, 2)", "{ ok, }", "(_, _) :> false");
SHAPES.prodLet = prod("let", "(1, _)", "{ ok }", "(_, _) :> false");
SHAPES.prodStr = { body: OK + `const s: string = name\n    const b = 1\n    const allowed = match (s, b) {\n      ("bob", 1) :> { ok }\n      (_, _) :> false\n    }\n    ` + R(`!allowed`) };
SHAPES.prodRet = { top: `function run(ok) { const a = 1\n    const b = 2\n    return match (a, b) {\n      (1, 2) :> { ok }\n      (_, _) :> false\n    } }`, body: OK + R(`!run(ok)`) };
SHAPES.prodArg = { body: OK + `${P2}\n    const allowed = Boolean(match (a, b) {\n      (1, 2) :> { ok }\n      (_, _) :> false\n    })\n    ` + R(`!allowed`) };
SHAPES.prodSemiRejects = prod("const", "(1, 2)", "{ ok; }", "(_, _) :> false");
SHAPES.prodKeyedRejects = { body: OK + `${P2}\n    const o = match (a, b) {\n      (1, 2) :> { v: ok }\n      (_, _) :> { v: false }\n    }\n    ` + R(`!o.v`) };
SHAPES.shLambda = { body: OK + `const pick = (x) => match x {\n      1 :> { ok }\n      else :> false\n    }\n    ` + R(`!pick(1)`) };
