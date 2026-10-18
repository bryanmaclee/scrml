// Probe family `n7` — copied VERBATIM (below this header) from S468 fix-round-1 review of 7ecae57eb (`~/.cache/scrml-agent-tmp/s468-rev-failable/n7.mjs`).
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (client: click #wrong / #right and read #out; server: POST the `login` route with p="wrong" / "secret").
// Do not edit a shape to make it pass. See ../pack.js for the classes and ../README.md for the why.

export const SIDE = "client";

const L = (decl, pre = "", cell = "") => `type AuthErr:enum = { Denied }
<msg> = "init"
${cell}
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function id(x) { return x }
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
  ["cell holds fn", L("@f = check\n        const ok = @f(p)", "", "<f> = id")],
  ["map returns fns", L("const ok = [1].map((x) => check)[0](p)")],
  ["array from fn elem via id", L("const fs = id([check])\n        const ok = fs[0](p)")],
  ["Object.values", L("const ok = Object.values({ a: 1 }).map(() => check)[0](p)")],
  ["fn-expr alias", L("const g = function (x) { return check(x) !{ _ :> true } }\n        const ok = g(p)")],
  ["ret iife fn-expr", L("const ok = (function () { return check })()(p)")],
  ["closure reassign", L("let g = id\n        const arm = () => { g = check }\n        arm()\n        const ok = g(p)")],
  ["ret lambda block local", L("const mk = () => { const h = check\n return h }\n        const ok = mk()(p)")],
  ["ret through ternary call", L("const ok = (p ? getF : getF)()(p)", "    function getF() { return check }")],
  ["ret through && call", L("const ok = (id && getF)()(p)", "    function getF() { return check }")],
  ["alias via ||= ", L("let g = null\n        g ||= check\n        const ok = g(p)")],
  ["alias via ??= ", L("let g = null\n        g ??= check\n        const ok = g(p)")],
  ["alias destructure default", L("const { g = check } = {}\n        const ok = g(p)")],
  ["alias for-of", L("let ok = false\n        for (const g of [check]) { ok = g(p) }")],
  ["alias param default lambda", L("const t = (f = check) => f(p)\n        const ok = t()")],
];
