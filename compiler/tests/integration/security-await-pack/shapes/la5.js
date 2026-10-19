// Family la5 (S469 r4, filed — not fixed in #1450) — a `match` written INSIDE a larger expression
// (`Boolean(match …)`, `JSON.stringify(match …)`) is carried by the expression parser as raw arm
// TEXT and lowered to a SYNCHRONOUS value IIFE:
//   - on the CLIENT, a server-call arm value is not awaited: `if (Boolean(match n { 1 :> inner(…)
//     else :> false }))` emits `return _scrml_fetch_inner_N ( name , pass );` inside the IIFE, so
//     the branch tests a Promise — always taken (gap g-match-value-position-server-call-no-autoawait);
//   - a failable (`!`) call inside a raw OBJECT arm (`{ ok: chk(p) }`) gets no E-ERROR-002, so a
//     failure object (truthy) reads as success (gap g-raw-match-arm-object-failable-call-unhandled-s469).
// The client shapes are UNJUDGED by this server-route instrument (the decision runs in the client);
// see known-fail.js.
export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const mk = (decl, extra = "") => `<program db="./app.db">
\${
  import { check } from "./lib.scrml"
  ${extra}
  ${decl}
}
<out> = ""
<button onclick={ @out = f("bob", "x") }>f</button>
<p>\${@out}</p>
</program>
`;
const ROW = "const row = ?{`SELECT name, pw FROM users WHERE name = ${name}`}.get()";
const INNER = `function inner(name, pass) { ${ROW}\n    return check(pass, row.pw) }`;
const CHK = `type E:enum = { Bad }\n  function chk(p, h)! -> E { if (!check(p, h)) { fail .Bad }\n    return true }`;
export const SHAPES = {
  // client f: the raw value-IIFE returns an unawaited Promise (always truthy)
  rawClientSrvCall: { app: mk(`function f(name: string, pass: string) {\n    const n = 1\n    if (Boolean(match n {\n      1 :> inner(name, pass)\n      else :> false\n    })) { return "WELCOME" }\n    return "REJECTED"\n  }`, INNER) },
  rawClientSrvCallObj: { app: mk(`function f(name: string, pass: string) {\n    const n = 1\n    const o = JSON.parse(JSON.stringify(match n {\n      1 :> { v: inner(name, pass) }\n      else :> { v: false }\n    }))\n    return o.v ? "WELCOME" : "REJECTED"\n  }`, INNER) },
  // client f: a failable call inside a raw object arm — no E-ERROR-002, the failure object is truthy
  rawClientObjFailable: { app: mk(`function f(name: string, pass: string) {\n    const n = 1\n    const o = JSON.parse(JSON.stringify(match n {\n      1 :> { ok: chkC(pass) }\n      2 :> { ok: inner(name, pass) }\n      else :> { ok: false }\n    }))\n    return o.ok ? "WELCOME" : "REJECTED"\n  }`, INNER + `\n  type E:enum = { Bad }\n  function chkC(p: string)! -> E { if (p == "") { fail .Bad }\n    return p == "right-password" }`) },
  // server f: a failable call inside a raw object arm, never handled (refused today, but as
  // E-CODEGEN-INVALID-LOGIC — a compiler-defect code — not E-ERROR-002)
  rawObjFailable: { top: CHK, body: `const n = 1\n    const o = JSON.parse(JSON.stringify(match n {\n      1 :> { ok: chk(pass, row.pw) }\n      else :> { ok: false }\n    }))\n    if (!o.ok) { return "REJECTED" }\n    return "WELCOME"` },
};

// S469 r5 — the S239 delta re-review of r4 (5c795a428): a `!` call inside a §18.19 PRODUCT-arm
// BLOCK got no E-ERROR-002 — r4 carried the block on a `match-arm-inline` as `structuredBody`, a
// field the E-ERROR-002 walk never visited — so the error object (truthy) let a wrong password in.
// Now a `match-arm-block` (`body`), the shape every analysis walks: each prodBlkFailable* shape is
// REFUSED with E-ERROR-002.
const AUTH = `type AuthErr:enum = { Bad }\n  function chk(p, h)! -> AuthErr { if (!check(p, h)) { fail .Bad }\n    return true }`;
const KE = `type K:enum = { A, B(n: number) }`;
const pb = (scrut, head, body, rest = `(_, _) :> false`, kw = "const", top = AUTH) => ({
  top,
  body: `${scrut}\n    ${kw} allowed = match (a, b) {\n      ${head} :> ${body}\n      ${rest}\n    }\n    if (!allowed) { return "REJECTED" }\n    return "WELCOME"`,
});
const AB = `const a = 1\n    const b = 2`;
Object.assign(SHAPES, {
  prodBlkFailable: pb(AB, "(1, 2)", "{ chk(pass, row.pw) }"),
  prodBlkFailableLet: pb(AB, "(1, 2)", "{ chk(pass, row.pw) }", `(_, _) :> false`, "let"),
  prodBlkFailableTail: pb(AB, "(1, 2)", "{ const v = chk(pass, row.pw)\n        v }"),
  prodBlkFailableAlt: pb(AB, "(1 | 2, 2)", "{ chk(pass, row.pw) }"),
  prodBlkFailableStr: pb(`const a: string = name\n    const b = 1`, `("bob", 1)`, "{ chk(pass, row.pw) }"),
  prodBlkFailableVariant: pb(`const a: K = K.B(3)\n    const b = 2`, "(.B(n), 2)", "{ chk(pass, row.pw) }", `(_, _) :> false`, "const", AUTH + "\n  " + KE),
  prodBlkFailableColonV: pb(`const a: K = .A\n    const b = 2`, "(::A, 2)", "{ chk(pass, row.pw) }", `(_, _) :> false`, "const", AUTH + "\n  " + KE),
  prodBlkFailableWildLast: pb(AB, "(2, 2) :> false\n      (_, _)", "{ chk(pass, row.pw) }", ``),
  prodBlkFailableStmt: { top: AUTH, body: `${AB}\n    let allowed = false\n    match (a, b) {\n      (1, 2) :> { allowed = chk(pass, row.pw) }\n      (_, _) :> { allowed = false }\n    }\n    if (!allowed) { return "REJECTED" }\n    return "WELCOME"` },
  // a server call / a cell read inside a SERVER product block: must reject or be refused
  prodBlkServerCall: { top: `function inner2(p, h) { return check(p, h) }`, body: `${AB}\n    const allowed = match (a, b) {\n      (1, 2) :> { const v = inner2(pass, row.pw)\n        v }\n      (_, _) :> false\n    }\n    if (!allowed) { return "REJECTED" }\n    return "WELCOME"` },
  prodBlkCellRead: { top: `<gate> = true`, body: `${AB}\n    const allowed = match (a, b) {\n      (1, 2) :> { const g = @gate\n        g && check(pass, row.pw) }\n      (_, _) :> false\n    }\n    if (!allowed) { return "REJECTED" }\n    return "WELCOME"` },
  // §13.9.6 / §13.2: an async function aliased / stored inside a product block
  prodBlkAlias: { body: `${AB}\n    const allowed = match (a, b) {\n      (1, 2) :> { const g = check\n        g(pass, row.pw) }\n      (_, _) :> false\n    }\n    if (!allowed) { return "REJECTED" }\n    return "WELCOME"` },
  prodBlkObjStore: { body: `${AB}\n    const allowed = match (a, b) {\n      (1, 2) :> { const o = { g: check }\n        o.g(pass, row.pw) }\n      (_, _) :> false\n    }\n    if (!allowed) { return "REJECTED" }\n    return "WELCOME"` },
  prodBlkHof: { top: `function drive(cb, p, h) { if (cb(p, h)) { return true }\n    return false }\n  function never(a, b) { return false }`, body: `const y = drive(never, "x", "y")\n    ${AB}\n    const allowed = match (a, b) {\n      (1, 2) :> { drive(check, pass, row.pw) }\n      (_, _) :> false\n    }\n    if (!allowed) { return "REJECTED" }\n    return "WELCOME"` },
  // LOW (review, pre-existing): a helper whose product block calls a same-file failable peer
  prodBlkPeerHelper: { top: AUTH + `\n  function h(p, hh) { const a = 1\n    const b = 2\n    return match (a, b) {\n      (1, 2) :> { const r = chk(p, hh) !{ .Bad :> false }\n        r }\n      (_, _) :> false\n    } }`, body: `if (!h(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` },
  prodBlkPeerHelperSingle: { top: AUTH + `\n  function h(p, hh) { const a = 1\n    return match a {\n      1 :> { const r = chk(p, hh) !{ .Bad :> false }\n        r }\n      else :> false\n    } }`, body: `if (!h(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` },
  prodBlkPeerHelperPlain: { top: AUTH + `\n  function h(p, hh) { const r = chk(p, hh) !{ .Bad :> false }\n    return r }`, body: `if (!h(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"` },
  // LOW (review): a nested product match inside a product block yielded undefined
  prodBlkNested: { body: `${AB}\n    const allowed = match (a, b) {\n      (1, 2) :> { match (b, a) {\n        (_, _) :> { const v = check(pass, row.pw)\n          v }\n      } }\n      (_, _) :> false\n    }\n    if (!allowed) { return "REJECTED" }\n    return "WELCOME"` },
});
