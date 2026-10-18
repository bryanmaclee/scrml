// server-await-probes.js — s468 bootstrap unit U1c: the S467 §13 amendment's
// acceptance item 4, for the shapes the BOOTSTRAP can express.
//
// The impl#1 pack (compiler/tests/integration/security-await-pack/, 424
// reviewer shapes) reaches the waiting call through `scrml:auth`'s
// `verifyPassword`, imports, aliases, re-exports, untyped parameters and the
// legacy declaration form — none of which the bootstrap has (no stdlib import,
// typed parameters only, §66 declarations only); `server-await-pack.test.js`
// measures that pack against the bootstrap as written. THIS file is the
// bootstrap-expressible translation of its question: a server function `f`
// reads bob's row and must REJECT a wrong password, and the check it calls
// WAITS on the server — here because it runs a `?{}` query (the bootstrap's
// waiting value, §13.8 item 2) instead of calling `verifyPassword` (item 3).
// If the server did not await it, `if (!check(…))` would test a Promise —
// always truthy — and the wrong password would get in.
//
// Each shape names a POSITION the waiting value stands in. `expect`:
//   "PASS"     — compiles; wrong → "REJECTED", right → "WELCOME"
//   "REFUSED"  — the compile fails closed with the listed code(s) (a position
//                that cannot wait, §13.8, or one the bootstrap does not lower yet)
// A FAIL (wrong password WELCOMEd) is never an acceptable expectation.

const SQ = "?" + "{";

export const RIGHT = "right-password";
export const WRONG = "wrong-password";

const CHECK = `    function check(p: string, h: string) -> boolean {
        const r: Ok = ${SQ}\`SELECT CASE WHEN \${p} = \${h} THEN 1 ELSE 0 END AS ok\`}.get() !{ _ :> { return false } }
        return r.ok == 1
    }`;

// The program: `top` declares helpers, `body` decides; `f` is routed (the button calls it).
export function program(body, top = "", markup = "") {
  return `<program db="./app.db">
    type User:struct = { name: string, pw: string }
    type Ok:struct = { ok: int }
    type Denied:enum = { Bad, Transport(t: ServerCallError) }
    let <out:string=""/>
${CHECK}
${top}
    function f(name: string, pass: string) -> string {
        const row: User = ${SQ}\`SELECT name, pw FROM users WHERE name = \${name}\`}.get() !{ _ :> { return "REJECTED" } }
${body}
    }
    <main>
        <button id="go" onclick={ @out = f("bob", "x") !{ .Transport(t) :> return } }>f</button>
        <p>\${@out}</p>
${markup}
    </main>
</program>
`;
}

const R = (cond) => `        if (${cond}) return "REJECTED"\n        return "WELCOME"`;

export const SHAPES = {
  // ---- a function body: every statement position (§13.8 (i)) ----
  direct: { body: R("!check(pass, row.pw)"), expect: "PASS" },
  constLocal: { body: `        const ok: boolean = check(pass, row.pw)\n${R("!ok")}`, expect: "PASS" },
  letReassign: { body: `        let ok: boolean = false\n        ok = check(pass, row.pw)\n${R("!ok")}`, expect: "PASS" },
  compareFalse: { body: R("check(pass, row.pw) == false"), expect: "PASS" },
  compareNotTrue: { body: R("check(pass, row.pw) != true"), expect: "PASS" },
  doubleNot: { body: R("!(!(!check(pass, row.pw)))"), expect: "PASS" },
  orLeft: { body: R(`!check(pass, row.pw) || name == ""`), expect: "PASS" },
  ternaryTest: { body: `        return check(pass, row.pw) ? "WELCOME" : "REJECTED"`, expect: "PASS" },
  returnDirect: { top: `    function accept(p: string, h: string) -> boolean {\n        return check(p, h)\n    }`, body: R("!accept(pass, row.pw)"), expect: "PASS" },
  argOfPure: { top: `    fn verdict(b: boolean) -> string {\n        if (b) return "WELCOME"\n        return "REJECTED"\n    }`, body: `        return verdict(check(pass, row.pw))`, expect: "PASS" },
  argBeforeLiteral: { top: `    fn both(a: boolean, b: boolean) -> boolean { return a && b }`, body: R("!both(check(pass, row.pw), true)"), expect: "PASS" },
  argAfterLocal: { top: `    fn both(a: boolean, b: boolean) -> boolean { return a && b }`, body: `        const yes: boolean = name == "bob"\n${R("!both(yes, check(pass, row.pw))")}`, expect: "PASS" },
  twoWaits: { top: `    fn both(a: boolean, b: boolean) -> boolean { return a && b }`, body: R("!both(check(pass, row.pw), check(pass, row.pw))"), expect: "PASS" },
  nestedIf: { body: `        if (name == "bob") {\n            if (!check(pass, row.pw)) return "REJECTED"\n        }\n        return "WELCOME"`, expect: "PASS" },
  elseBranch: { body: `        if (name == "") {\n            return "REJECTED"\n        } else {\n            if (!check(pass, row.pw)) return "REJECTED"\n        }\n        return "WELCOME"`, expect: "PASS" },
  joinAfterIf: { body: `        let verdict: string = "REJECTED"\n        if (name == "bob") {\n            if (check(pass, row.pw)) verdict = "WELCOME"\n        }\n        return verdict`, expect: "PASS" },
  // ---- through server-side helpers (§12.2 Trigger 5: no trigger of their own, called only from the server) ----
  helper1: { top: `    function w1(p: string, h: string) -> boolean {\n        return check(p, h)\n    }`, body: R("!w1(pass, row.pw)"), expect: "PASS" },
  helper2: { top: `    function w1(p: string, h: string) -> boolean {\n        return check(p, h)\n    }\n    function w2(p: string, h: string) -> boolean {\n        return w1(p, h) == true\n    }`, body: R("!w2(pass, row.pw)"), expect: "PASS" },
  helperIf: { top: `    function w3(p: string, h: string) -> boolean {\n        if (!check(p, h)) {\n            return false\n        }\n        return true\n    }`, body: R("!w3(pass, row.pw)"), expect: "PASS" },
  helperLocal: { top: `    function w4(p: string, h: string) -> boolean {\n        const v: boolean = check(p, h)\n        return v\n    }`, body: R("!w4(pass, row.pw)"), expect: "PASS" },
  helperRecursive: { top: `    function w5(p: string, h: string, n: int) -> boolean {\n        if (n > 0) return w5(p, h, n - 1)\n        return check(p, h)\n    }`, body: R("!w5(pass, row.pw, 2)"), expect: "PASS" },
  helperQueryParam: { top: `    function same(p: string, h: string) -> int {\n        const r: Ok = ${SQ}\`SELECT CASE WHEN \${p} = \${h} THEN 1 ELSE 0 END AS ok\`}.get() !{ _ :> { return 0 } }\n        return r.ok\n    }`, body: R("same(pass, row.pw) != 1"), expect: "PASS" },
  // ---- a failable (`!`) waiting check, handled every way (§19.4.3) ----
  failableGuard: { top: `    function checkF(p: string, h: string)! Denied {\n        if (!check(p, h)) fail .Bad\n        return true\n    }`, body: `        const ok: boolean = checkF(pass, row.pw) !{ _ :> false }\n${R("!ok")}`, expect: "PASS" },
  failableGuardReturn: { top: `    function checkF(p: string, h: string)! Denied {\n        if (!check(p, h)) fail .Bad\n        return true\n    }`, body: `        checkF(pass, row.pw) !{ _ :> { return "REJECTED" } }\n        return "WELCOME"`, expect: "PASS" },
  failableMatch: { top: `    function checkF(p: string, h: string)! Denied {\n        if (!check(p, h)) fail .Bad\n        return true\n    }`, body: `        const v: string = match checkF(pass, row.pw) {\n            .Ok(x) :> "WELCOME"\n            _ :> "REJECTED"\n        }\n        return v`, expect: "PASS" },
  // ---- positions that cannot wait (§13.8 "everywhere else … a compile error") or that the bootstrap does not lower ----
  andRight: { body: R(`name == "bob" && !check(pass, row.pw)`), expect: "REFUSED", codes: ["E-BOOTSTRAP-UNSUPPORTED"] },
  ternaryBranch: { body: `        return name == "bob" ? (check(pass, row.pw) ? "WELCOME" : "REJECTED") : "REJECTED"`, expect: "REFUSED", codes: ["E-BOOTSTRAP-UNSUPPORTED"] },
  lambdaFilter: { body: `        const ok: string[] = [row.pw].filter(h => check(pass, h))\n${R("ok.length == 0")}`, expect: "REFUSED", codes: ["E-BOOTSTRAP-UNSUPPORTED"] },
  armBody: { top: `    function checkF(p: string, h: string)! Denied {\n        if (!check(p, h)) fail .Bad\n        return true\n    }`, body: `        const ok: boolean = checkF(pass, row.pw) !{ _ :> check(pass, row.pw) }\n${R("!ok")}`, expect: "REFUSED", codes: ["E-BOOTSTRAP-UNSUPPORTED"] },
  fnValueAlias: { body: `        const c = check\n${R("!c(pass, row.pw)")}`, expect: "REFUSED", codes: ["E-BOOTSTRAP-UNSUPPORTED"] },
  valuePosition: { body: R("!check(pass, row.pw)"), markup: `        <p>\${check("a", "b")}</p>`, expect: "REFUSED", codes: ["E-VALUE-SERVER-CALL"] },
};
