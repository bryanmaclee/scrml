// Probe family `n1` — copied VERBATIM (below this header) from S468 fix-round-1 review of 7ecae57eb (`~/.cache/scrml-agent-tmp/s468-rev-failable/n1.mjs`).
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (client: click #wrong / #right and read #out; server: POST the `login` route with p="wrong" / "secret").
// Do not edit a shape to make it pass. See ../pack.js for the classes and ../README.md for the why.

export const SIDE = "client";

const L = (decl, pre = "") => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function id(x) { return x }
    function apply(f) { return f("wrong") }
${pre}
    function login(p) {
        ${decl}
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;
export default [
  ["ctl match direct", L("const ok = match check(p) { .Ok(x) :> x  .Denied :> false }")],
  // alias shapes
  ["alias paren", L("const g = (check)\n        const ok = g(p)")],
  ["alias ternary nested", L("const g = p ? (p ? check : id) : id\n        const ok = g(p)")],
  ["alias ?? ", L("const g = null ?? check\n        const ok = g(p)")],
  ["alias && ", L("const g = id && check\n        const ok = g(p)")],
  ["alias || left falsy-ish", L("const g = id || check\n        const ok = g(p)")],
  ["alias cast", L("const g = check as any\n        const ok = g(p)")],
  ["alias chain 3", L("const a = check\n        const b = p ? a : id\n        const c = b || id\n        const ok = c(p)")],
  ["alias let reassign later block", L("let g = id\n        if (p != \"\") { g = check }\n        const ok = g(p)")],
  ["alias let reassign in else", L("let g = id\n        if (p == \"\") { g = id } else { g = check }\n        const ok = g(p)")],
  ["alias reassign in while", L("let g = id\n        let n = 0\n        while (n < 1) { g = check\n n = n + 1 }\n        const ok = g(p)")],
  ["alias in loop (pre)", L("let g = id\n        let ok = false\n        for (const x of [1, 2]) { ok = g(p)\n g = check }")],
  ["alias via closure write", L("let g = id\n        const arm = () => { g = check }\n        arm()\n        const ok = g(p)")],
  ["alias via module fn write", L("const ok = gg(p)", "    let gg = id\n    function arm() { gg = check }\n    arm()")],
  ["alias seq/comma", L("const g = (0, check)\n        const ok = g(p)")],
  ["alias assign-expr", L("let h = id\n        const g = (h = check)\n        const ok = g(p)")],
  ["alias chained assign", L("let h = id\n        let g = id\n        g = h = check\n        const ok = g(p)")],
  ["alias destructure arr", L("const [g] = [check]\n        const ok = g(p)")],
  ["alias param default", L("const ok = t(p)", "    function t(p, f = check) { return f(p) }")],
  ["alias apply (pre)", L("const ok = apply(check)")],
  ["alias apply lambda", L("const ok = ((f) => f(p))(check)")],
  ["alias map callback", L("const ok = [p].map(check)[0]")],
  ["alias filter callback", L("const ok = [p].filter(check).length > 0")],
  ["alias some callback", L("const ok = [p].some(check)")],
  // returned fns
  ["ret direct", L("const ok = getF()(p)", "    function getF() { return check }")],
  ["ret helper chain", L("const ok = h2()(p)", "    function getF() { return check }\n    function h1() { return getF() }\n    function h2() { return h1() }")],
  ["ret helper chain rev order", L("const ok = h2()(p)", "    function h2() { return h1() }\n    function h1() { return getF() }\n    function getF() { return check }")],
  ["ret via local", L("const ok = getF()(p)", "    function getF() { const g = check\n        return g }")],
  ["ret ternary", L("const ok = getF(p)(p)", "    function getF(p) { return p ? check : id }")],
  ["ret lambda wrap", L("const ok = getF()(p)", "    function getF() { return (x) => check(x) }")],
  ["ret lambda", L("const mk = () => check\n        const ok = mk()(p)")],
  ["ret lambda block", L("const mk = () => { return check }\n        const ok = mk()(p)")],
  ["ret lambda curried", L("const mk = () => () => check\n        const ok = mk()()(p)")],
  ["ret fn curried", L("const ok = getF()()(p)", "    function getF() { return () => check }")],
  ["ret fn shorthand", L("const ok = getF()(p)", "    fn getF() { check }")],
  ["ret via param identity", L("const ok = id(check)(p)")],
  ["ret via param identity alias", L("const g = id(check)\n        const ok = g(p)")],
  ["ret via if-branch", L("const ok = getF(p)(p)", "    function getF(p) { if (p == \"\") { return id }\n        return check }")],
  ["ret second return", L("const ok = getF(p)(p)", "    function getF(p) { if (p == \"zz\") return id\n        return check }")],
  ["ret iife", L("const ok = (() => check)()(p)")],
  ["ret iife block", L("const ok = (function () { return check })()(p)")],
  ["ret recursive", L("const ok = getF(1)(p)", "    function getF(n) { if (n > 0) return getF(n - 1)\n        return check }")],
  ["ret through apply", L("const ok = apply2(getF)(p)", "    function getF() { return check }\n    function apply2(f) { return f() }")],
  // value result shapes through operators (not aliases)
  ["seq", L("let ok = false\n        ok = (0, check(p))")],
  ["paren double", L("const ok = ((check(p)))")],
  ["array spread", L("const ok = [...[check(p)]][0]")],
  ["obj spread", L("const o = { ...{ v: check(p) } }\n        const ok = o.v")],
  ["template", L("const ok = `${check(p)}` == \"true\"")],
  ["not", L("const ok = !!check(p)")],
  ["closure capture", L("const f = () => check(p)\n        const ok = f()")],
  ["map cb result", L("const ok = [p].map((x) => check(x))[0]")],
  ["struct field", L("const ok = { a: check(p) }.a")],
  ["cell write read", L("@tmp = check(p)\n        const ok = @tmp")],
];
