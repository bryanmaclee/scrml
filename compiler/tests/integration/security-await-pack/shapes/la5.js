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
