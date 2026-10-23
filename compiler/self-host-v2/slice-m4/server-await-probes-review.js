// server-await-probes-review.js — s468 bootstrap unit U1c, fix round 1: the S239
// reviewer's await probes for frozen ad2a592f0 (scratch: ~/.cache/scrml-agent-tmp/
// s468-rev-u1c/w/s1.js … s4.js), committed VERBATIM (each family in its own scope)
// so they GATE. PA RULING (S468): the 424-shape impl#1 pack is refused wholesale by
// the bootstrap (no `scrml:auth` import), so it is not evidence; U1c's evidence of
// the S467 §13 amendment item 4 is the TRANSLATED probes — server-await-probes.js
// and these. Each shape uses server-await-probes.js `program()` (or its own `src`),
// may name another route (`route`) and other arguments (`wargs` / `rargs`).
// The pinned outcome of each is in server-await-review.test.js (REVIEW_EXPECT).
// Do not edit a shape to make it pass.

// ---- family s1 (reviewer scratch s1.js) ----
const S1 = (() => {
const SQ = "?" + "{";
const R = (c) => `        if (${c}) return "REJECTED";\n        return "WELCOME"`;
const CF = `    function checkF(p: string, h: string)! Denied {\n        if (!check(p, h)) fail .Bad;\n        return true;\n    }`;
return {
  pureFnWrap: { top: `    fn pw(p: string, h: string) -> boolean {\n        return check(p, h);\n    }`, body: R("!pw(pass, row.pw)") },
  chain3: { top: `    function a1(p: string, h: string) -> boolean { return check(p, h); }\n    function a2(p: string, h: string) -> boolean { return a1(p, h); }\n    function a3(p: string, h: string) -> boolean { return a2(p, h); }\n    function a4(p: string, h: string) -> boolean { return !a3(p, h); }`, body: R("a4(pass, row.pw)") },
  mutual: { top: `    function m1(p: string, h: string, n: int) -> boolean {\n        if (n > 0) return m2(p, h, n - 1);\n        return check(p, h);\n    }\n    function m2(p: string, h: string, n: int) -> boolean {\n        return m1(p, h, n);\n    }`, body: R("!m2(pass, row.pw, 3)") },
  whileCond: { body: `        let n: int = 0;\n        while (!check(pass, row.pw)) {\n            return "REJECTED";\n        }\n        return "WELCOME"` },
  forBody: { body: `        for (const x of [1, 2]) {\n            if (!check(pass, row.pw)) return "REJECTED";\n        }\n        return "WELCOME"` },
  elseIf: { body: `        if (name == "") {\n            return "REJECTED";\n        } else if (!check(pass, row.pw)) {\n            return "REJECTED";\n        }\n        return "WELCOME";` },
  template: { body: `        const s: string = "\${check(pass, row.pw)}";\n${R('s != "true"')}` },
  concat: { body: `        const s: string = "v" + check(pass, row.pw);\n${R('s != "vtrue"')}` },
  matchScrut: { body: `        return match check(pass, row.pw) {\n            true :> "WELCOME",\n            false :> "REJECTED"\n        }` },
  matchArm: { body: `        const v: string = match name {\n            "bob" :> check(pass, row.pw) ? "WELCOME" : "REJECTED",\n            _ :> "REJECTED"\n        };\n        return v;` },
  structField: { top: `    type B:struct = { ok: boolean }`, body: `        const b: B = { ok: check(pass, row.pw) };\n${R("!b.ok")}` },
  arrayLit: { body: `        const a: boolean[] = [check(pass, row.pw)];\n${R("!a[0]")}` },
  indexWrite: { body: `        let a: boolean[] = [false];\n        a[0] = check(pass, row.pw);\n${R("!a[0]")}` },
  queryParam: { body: `        const r: Ok = ${SQ}\`SELECT \${check(pass, row.pw)} AS ok\`}.get() !{ _ :> { return "REJECTED"; } };\n${R("r.ok != 1")}` },
  queryParamDup: { body: `        const r: Ok = ${SQ}\`SELECT CASE WHEN \${check(pass, row.pw)} AND \${check(pass, row.pw)} THEN 1 ELSE 0 END AS ok\`}.get() !{ _ :> { return "REJECTED"; } };\n${R("r.ok != 1")}` },
  hostMethod: { body: `        const s: string = String(check(pass, row.pw));\n${R('s != "true"')}` },
  methodOnResult: { body: R(`check(pass, row.pw).toString() != "true"`) },
  defaultParam: { top: `    function g(p: string, h: string, ok: boolean = check(p, h)) -> boolean { return ok }`, body: R("!g(pass, row.pw)") },
  fnArg: { top: `    function app(c: (string, string) -> boolean, p: string, h: string) -> boolean { return c(p, h) }`, body: R("!app(check, pass, row.pw)") },
  mapLambda: { body: `        const a: boolean[] = [row.pw].map(h => check(pass, h));\n${R("!a[0]")}` },
  hostArgCall: { body: R(`![row.pw].includes(pass) && false || !check(pass, row.pw)`) },
  orRight: { body: R(`name == "" || !check(pass, row.pw)`) },
  deferBody: { body: `        defer { check(pass, row.pw); }\n${R("!check(pass, row.pw)")}` },
  deferInWaiting: { body: `        let v: string = "REJECTED";\n        defer { v = "x"; }\n${R("!check(pass, row.pw)")}` },
  failableBare: { top: CF, body: `        const ok: boolean = checkF(pass, row.pw);\n${R("!ok")}` },
  failableUnhandledProp: { top: CF + `\n    function g(p: string, h: string)! Denied {\n        const ok: boolean = checkF(p, h);\n        return ok;\n    }`, body: `        const ok: boolean = g(pass, row.pw) !{ _ :> false };\n${R("!ok")}` },
  bareQueryNoHandler: { top: `    function c2(p: string, h: string)! Denied {\n        const r: Ok = ${SQ}\`SELECT CASE WHEN \${p} = \${h} THEN 1 ELSE 0 END AS ok\`}.get();\n        return r.ok == 1;\n    }`, body: `        const ok: boolean = c2(pass, row.pw) !{ _ :> false };\n${R("!ok")}` },
  bareQueryNonFailable: { top: `    function c3(p: string, h: string) -> boolean {\n        const r: Ok = ${SQ}\`SELECT CASE WHEN \${p} = \${h} THEN 1 ELSE 0 END AS ok\`}.get();\n        return r.ok == 1;\n    }`, body: R("!c3(pass, row.pw)") },
  isGivenPos: { top: `    function look(p: string, h: string) -> Ok | not {\n        const r: Ok = ${SQ}\`SELECT 1 AS ok WHERE \${p} = \${h}\`}.get() !{ _ :> { return not; } };\n        return r;\n    }`, body: R("look(pass, row.pw) is not") },
  nestedFnDecl: { body: `        function inner(p: string, h: string) -> boolean { return check(p, h) }\n${R("!inner(pass, row.pw)")}` },
  arithmetic: { top: `    function cnt(p: string, h: string) -> int {\n        const r: Ok = ${SQ}\`SELECT CASE WHEN \${p} = \${h} THEN 1 ELSE 0 END AS ok\`}.get() !{ _ :> { return 0; } };\n        return r.ok;\n    }`, body: R("cnt(pass, row.pw) * 2 - 1 < 0") },
  unusedResult: { body: `        check(pass, row.pw);\n${R("!check(pass, row.pw)")}` },
  returnCheckDirect: { top: ``, body: `        if (check(pass, row.pw)) return "WELCOME";\n        return "REJECTED"` },
};
})();

// ---- family s2 (reviewer scratch s2.js) ----
const S2 = (() => {
const SQ = "?" + "{";
const R = (c) => `        if (${c}) return "REJECTED";\n        return "WELCOME"`;
const CF = `    function checkF(p: string, h: string)! Denied {\n        if (!check(p, h)) fail .Bad;\n        return true;\n    }`;
const V = `    type Verd:enum = { Yes, No }\n    function verd(p: string, h: string) -> Verd {\n        if (check(p, h)) return .Yes;\n        return .No;\n    }`;
return {
  matchEnumScrut: { top: V, body: `        return match verd(pass, row.pw) {\n            .Yes :> "WELCOME",\n            .No :> "REJECTED"\n        }` },
  matchEnumArm: { top: V, body: `        const v: string = match verd(pass, row.pw) {\n            .Yes :> check(pass, row.pw) ? "WELCOME" : "REJECTED",\n            .No :> "REJECTED"\n        };\n        return v;` },
  matchStmtArmCall: { top: V, body: `        let v: string = "REJECTED";\n        match verd(pass, row.pw) {\n            .Yes :> { if (check(pass, row.pw)) v = "WELCOME"; },\n            .No :> { v = "REJECTED"; }\n        }\n        return v;` },
  givenSubj: { top: `    function look(p: string, h: string) -> Ok | not {\n        const r: Ok = ${SQ}\`SELECT 1 AS ok WHERE \${p} = \${h}\`}.get() !{ _ :> { return not; } };\n        return r;\n    }`, body: `        given r = look(pass, row.pw) :> {\n            return "WELCOME";\n        }\n        return "REJECTED"` },
  givenBodyWait: { top: `    function look(p: string, h: string) -> Ok | not {\n        const r: Ok = ${SQ}\`SELECT 1 AS ok WHERE \${p} = \${h}\`}.get() !{ _ :> { return not; } };\n        return r;\n    }`, body: `        const o: Ok | not = look(name, name);\n        given r = o :> {\n            if (!check(pass, row.pw)) return "REJECTED";\n            return "WELCOME";\n        }\n        return "REJECTED";` },
  failPayload: { top: `    type DS:enum = { Bad(b: boolean) }\n    function g(p: string, h: string)! DS {\n        fail .Bad(check(p, h));\n    }`, body: `        const v: string = g(pass, row.pw) !{ .Bad(b) :> b ? "WELCOME" : "REJECTED" };\n        return v` },
  argOfHandled: { top: CF, body: `        const ok: boolean = checkF(pass, check(pass, row.pw) ? row.pw : "zz") !{ _ :> false };\n${R("!ok")}` },
  ternaryInArg: { top: `    fn id(b: boolean) -> boolean { return b; }`, body: R(`!id(check(pass, row.pw) ? true : false)`) },
  negUnary: { top: `    function cnt(p: string, h: string) -> int {\n        const r: Ok = ${SQ}\`SELECT CASE WHEN \${p} = \${h} THEN 1 ELSE 0 END AS ok\`}.get() !{ _ :> { return 0; } };\n        return r.ok;\n    }`, body: R("-cnt(pass, row.pw) != -1") },
  serverWritesCell: { body: `        @out = "x";\n${R("!check(pass, row.pw)")}` },
  twoRepServerFn: { top: ``, body: R("!check(pass, row.pw)"), markup: `        <button id="c" onclick={ @out = check("a", "b") ? "y" : "n" !{ .Transport(t) :> return }; }>c</button>` },
  routeCalledInPlace: { top: `    function f2(name: string, pass: string) -> string {\n        return f(name, pass);\n    }`, body: R("!check(pass, row.pw)"), markup: `        <button id="d" onclick={ @out = f2("bob", "x") !{ .Transport(t) :> return }; }>d</button>`, route: "f2" },
  lambdaFilterHelper: { top: `    function anyOk(p: string, hs: string[]) -> boolean {\n        const ok: string[] = hs.filter(h => check(p, h));\n        return ok.length > 0;\n    }`, body: R("!anyOk(pass, [row.pw])") },
  lambdaQuery: { top: `    function anyQ(p: string, hs: string[]) -> int {\n        const ok: string[] = hs.filter(h => ${SQ}\`SELECT 1\`}.get() !{ _ :> false });\n        return ok.length;\n    }`, body: R("anyQ(pass, [row.pw]) == 0") },
  ambientShared: { top: `    function eq(a: string, b: string) -> boolean { return a == b; }`, body: R("!(check(pass, row.pw) && eq(pass, pass))"), markup: `        <p>\${eq("a", "b")}</p>` },
  ambientWaitingRb: { top: `    function amb(p: string) -> string {\n        return f("bob", p);\n    }\n    function g3(p: string) -> string {\n        return amb(p);\n    }`, body: R("!check(pass, row.pw)"), markup: `        <button id="e" onclick={ @out = amb("x"); }>e</button>\n        <button id="h" onclick={ @out = g3("x") !{ .Transport(t) :> return }; }>h</button>` },
  andLeftWait: { body: R(`!check(pass, row.pw) && name == "bob"`) },
  orBothSides: { body: R(`!check(pass, row.pw) || !check(pass, row.pw)`) },
  nestedTernaryTest: { body: `        return (check(pass, row.pw) ? 1 : 0) == 1 ? "WELCOME" : "REJECTED"` },
};
})();

// ---- family s3 (reviewer scratch s3.js) ----
const S3 = (() => {
const SQ = "?" + "{";
const R = (c) => `        if (${c}) return "REJECTED";\n        return "WELCOME"`;
const PING = `        const pr: Ok = ${SQ}\`SELECT 1 AS ok\`}.get() !{ _ :> { return "REJECTED"; } };\n`;
return {
  twoRepServerFn: { top: `    function cs(p: string, h: string) -> string {\n        if (check(p, h)) return "y";\n        return "n";\n    }`, body: R(`cs(pass, row.pw) != "y"`), markup: `        <button id="c" onclick={ @out = cs("a", "b") !{ .Transport(t) :> return }; }>c</button>` },
  routeCalledInPlace: { top: `    function f2(name: string, pass: string) -> string {\n${PING}        return f(name, pass);\n    }`, body: R("!check(pass, row.pw)"), markup: `        <button id="d" onclick={ @out = f2("bob", "x") !{ .Transport(t) :> return }; }>d</button>`, route: "f2" },
  routeCalledInPlaceNoQ: { top: `    function f3(name: string, pass: string) -> string {\n        return f(name, pass);\n    }`, body: R("!check(pass, row.pw)"), markup: `        <button id="d" onclick={ @out = f3("bob", "x"); }>d</button>`, route: "f3" },
  ambientWaitingRb: { top: `    function amb(p: string) -> string {\n        return f("bob", p);\n    }\n    function g3(p: string) -> string {\n${PING}        return amb(p);\n    }`, body: R("!check(pass, row.pw)"), markup: `        <button id="e" onclick={ @out = amb("x"); }>e</button>\n        <button id="h" onclick={ @out = g3("x") !{ .Transport(t) :> return }; }>h</button>`, route: "g3", wargs: [ "wrong-password" ], rargs: ["right-password"] },
};
})();

// ---- family s4 (reviewer scratch s4.js) ----
const S4 = (() => {
const SQ = "?" + "{";
const R = (c) => `        if (${c}) return "REJECTED";\n        return "WELCOME"`;
return {
  implicitProp: { top: `    function c4(p: string, h: string)! SqlError {\n        const r: Ok = ${SQ}\`SELECT CASE WHEN \${p} = \${h} THEN 1 ELSE 0 END AS ok\`}.get();\n        return r.ok == 1;\n    }`, body: `        const ok: boolean = c4(pass, row.pw) !{ _ :> false };\n${R("!ok")}` },
  implicitPropChain: { top: `    function c4(p: string, h: string)! SqlError {\n        const r: Ok = ${SQ}\`SELECT CASE WHEN \${p} = \${h} THEN 1 ELSE 0 END AS ok\`}.get();\n        return r.ok == 1;\n    }\n    function c5(p: string, h: string)! SqlError {\n        const v: boolean = c4(p, h)?;\n        return v;\n    }`, body: `        const ok: boolean = c5(pass, row.pw) !{ _ :> false };\n${R("!ok")}` },
  implicitRunStmt: { top: `    function c6(p: string, h: string)! SqlError {\n        ${SQ}\`UPDATE users SET pw = pw WHERE name = \${p}\`}.run();\n        return check(p, h);\n    }`, body: `        const ok: boolean = c6(pass, row.pw) !{ _ :> false };\n${R("!ok")}` },
  matchFailable: { top: `    function c4(p: string, h: string)! SqlError {\n        const r: Ok = ${SQ}\`SELECT CASE WHEN \${p} = \${h} THEN 1 ELSE 0 END AS ok\`}.get();\n        return r.ok == 1;\n    }`, body: `        return match c4(pass, row.pw) {\n            .Ok(x) :> x ? "WELCOME" : "REJECTED",\n            _ :> "REJECTED"\n        }` },
  queryMatch: { body: `        const v: string = match ${SQ}\`SELECT CASE WHEN \${pass} = \${row.pw} THEN 1 ELSE 0 END AS ok\`}.get() {\n            .Ok(r) :> r.ok == 1 ? "WELCOME" : "REJECTED",\n            _ :> "REJECTED"\n        };\n        return v;` },
};
})();

// ---- family s5 (s469 #1471 review HIGH-1): a function declared `-> T | not` that FALLS OFF
// THE END yields JS `undefined`; the absence arm tested `=== null`, so `undefined` took the
// PRESENT arm — a wrong password WELCOMEd. Now the fall-off is refused (fail closed) and the
// absence test is `== null`. The `ret*` shapes write `return not` and must PASS.
const S5 = (() => {
const A = `    type Acct:struct = { name: string }`;
const FIND = (tail) => `${A}\n    function find(p: string, h: string) -> Acct | not {\n        const u: Acct = { name: "bob" };\n        if (p == h) return u;${tail};\n    }`;
const SFIND = (tail) => `    function find(p: string, h: string) -> string | not {\n        if (p == h) return "bob";${tail};\n    }`;
const EFIND = (tail) => `    type Verd:enum = { Yes, No }\n    function find(p: string, h: string) -> Verd | not {\n        if (p == h) return .Yes;${tail};\n    }`;
const VAL = `        return match find(pass, row.pw) {\n            not :> "REJECTED",\n            else :> "WELCOME"\n        }`;
const STMT = `        let v: string = "REJECTED";\n        match find(pass, row.pw) {\n            not :> v = "REJECTED",\n            _ :> v = "WELCOME"\n        }\n        return v;`;
const ENUM = `        return match find(pass, row.pw) {\n            .Yes :> "WELCOME",\n            .No :> "REJECTED",\n            not :> "REJECTED"\n        };`;
const RN = ";\n        return not;";
return {
  fallOffValue: { top: FIND(""), body: VAL },
  fallOffStmt: { top: FIND(""), body: STMT },
  fallOffString: { top: SFIND(""), body: STMT },
  fallOffEnum: { top: EFIND(""), body: ENUM },
  retValue: { top: FIND(RN), body: VAL },
  retStmt: { top: FIND(RN), body: STMT },
  retString: { top: SFIND(RN), body: STMT },
  retEnum: { top: EFIND(RN), body: ENUM },
  // #1471 delta review: HIGH-A a `!` function's success path falling off; HIGH-B an unannotated
  // function falling off, and `== not` (E-EQ-002); MED-C a bare `return` in a `-> T` function
  failableFallOff: { top: `    function role(p: string, h: string)! Denied {\n        if (p == h) return "user";\n    }`, body: `        return match role(pass, row.pw) {\n            .Ok(v) :> "WELCOME",\n            _ :> "REJECTED"\n        }` },
  failableFails: { top: `    function role(p: string, h: string)! Denied {\n        if (p == h) return "user";\n        fail .Bad;\n    }`, body: `        return match role(pass, row.pw) {\n            .Ok(v) :> "WELCOME",\n            _ :> "REJECTED"\n        }` },
  unannotatedFallOff: { top: `    function look(p: string, h: string) {\n        if (p == h) return "user";\n    }`, body: `        if (look(pass, row.pw) is not) return "REJECTED";\n        return "WELCOME"` },
  eqNot: { top: `    function look(p: string, h: string) -> string | not {\n        if (p == h) return "user";\n        return not;\n    }`, body: `        if (look(pass, row.pw) == not) return "REJECTED";\n        return "WELCOME"` },
  // #1471 round 2 (bryan: "Always explicit"): HIGH-1 a bare `return` in a `!` function is a
  // success with no value; a bare `return` in `-> T | not` is not `not`; MED-2 a no-value
  // callee's result read as a value (`!{}` initializer, `.Ok(v)`, a plain initializer)
  bareReturnFailable: { top: `    function role(p: string, h: string)! Denied {\n        if (p != h) return;\n        return "user";\n    }`, body: `        return match role(pass, row.pw) {\n            .Ok(v) :> "WELCOME",\n            _ :> "REJECTED"\n        }` },
  bareReturnMaybe: { top: `    function look(p: string, h: string) -> string | not {\n        if (p != h) return;\n        return "user";\n    }`, body: `        if (look(pass, row.pw) is not) return "REJECTED";\n        return "WELCOME"` },
  noValueGuard: { top: `    function chk(p: string, h: string)! Denied {\n        if (p != h) fail .Bad;\n    }`, body: `        const r: string = chk(pass, row.pw) !{ _ :> "REJECTED" };\n        if (r == "REJECTED") return "REJECTED";\n        return "WELCOME"` },
  noValueOk: { top: `    function chk(p: string, h: string)! Denied {\n        if (p != h) fail .Bad;\n    }`, body: `        return match chk(pass, row.pw) {\n            .Ok(v) :> "WELCOME" + v,\n            _ :> "REJECTED"\n        }` },
  noValueOkUnbound: { top: `    function chk(p: string, h: string)! Denied {\n        if (p != h) fail .Bad;\n    }`, body: `        let v: string = "REJECTED";\n        match chk(pass, row.pw) {\n            .Ok(_) :> v = "WELCOME",\n            _ :> v = "REJECTED"\n        }\n        return v;` },
  noValuePlain: { top: `    function nothing(p: string, h: string) {\n        if (p == h) {\n            const z: int = 1;\n        }\n    }`, body: `        const s: string = nothing(pass, row.pw);\n        if (s is not) return "REJECTED";\n        return "WELCOME"` },
  // #1471 round 3: `void` is a TYPE — a wrapper that `return`s a void call is not a value
  wrapFailable: { top: `    function audit(p: string) {\n        if (p == "") return;\n    }\n    function role(p: string, h: string)! Denied {\n        if (p == h) return "user";\n        return audit(p);\n    }`, body: `        return match role(pass, row.pw) {\n            .Ok(v) :> "WELCOME",\n            _ :> "REJECTED"\n        }` },
  wrapTyped: { top: `    function audit(p: string) {\n        if (p == "") return;\n    }\n    function role(p: string, h: string) -> string {\n        if (p == h) return "user";\n        return audit(p);\n    }`, body: `        if (role(pass, row.pw) == "user") return "WELCOME";\n        return "REJECTED"` },
  wrapUnannotated: { top: `    function audit(p: string) {\n        if (p == "") return;\n    }\n    function role(p: string, h: string) {\n        if (p == h) return "user";\n        return audit(p);\n    }`, body: `        if (role(pass, row.pw) is not) return "REJECTED";\n        return "WELCOME"` },
  wrapVoid: { top: `    function nothing(p: string) {\n        if (p == "") return;\n    }\n    function w(p: string) {\n        return nothing(p);\n    }`, body: `        const s: string = w(pass);\n        if (s is not) return "REJECTED";\n        return "WELCOME"` },
  bareReturn: { top: `    function role(p: string, h: string) -> string {\n        if (p == h) return "user";\n        return;\n    }`, body: `        if (role(pass, row.pw) == "user") return "WELCOME";\n        return "REJECTED"` },
};
})();

export const REVIEW_SHAPES = {};
for (const [fam, shapes] of Object.entries({ s1: S1, s2: S2, s3: S3, s4: S4, s5: S5 })) {
  for (const [name, s] of Object.entries(shapes)) REVIEW_SHAPES[fam + "/" + name] = s;
}
