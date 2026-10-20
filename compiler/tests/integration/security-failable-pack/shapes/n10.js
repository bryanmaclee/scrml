// Probe family `n10` — copied VERBATIM (below this header) from the S468 fix-round-1 dev (`~/.cache/scrml-agent-tmp/s468-failable-alias-and-match/cases/n10.mjs`): by-binding (F5) probes.
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (client: click #wrong / #right and read #out; server: POST the `login` route with p="wrong" / "secret").
// Do not edit a shape to make it pass. See ../pack.js for the classes and ../README.md for the why.

export const SIDE = "client";

// S468 fix round 1 — F5 / by-binding probes. A shape whose callee is a PLAIN function returning
// AuthErr::Denied must NOT be stamped failable (it would read .Denied as .Ok and log in): expected
// "rejected" for both passwords (PASS-DENY).
const L = (decl, pre = "") => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function plain(p) { return p == "secret" }
    function plainDeny(p) { return AuthErr::Denied }
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
const M = " { .Denied :> false  _ :> true }";
export default [
  ["later local shadow (match)", L("function getF2() { return check }\n        const ok = match getF2()(p)" + M + "\n        const check = plain")],
  ["hoisted local getF plain", L("const ok = getF2()(p)\n        function getF2() { return plain }", "    function other() { function getF2() { return check }\n        return getF2()(\"x\") !{ _ :> false } }")],
  ["hoisted local getF failable match", L("const ok = match getF2()(p)" + M + "\n        function getF2() { return check }")],
  ["nested getF match exact", L("function getF2() { return check }\n        const ok = match getF2()(p)" + M)],
  ["param shadow in getF (match)", L("function getF2(check) { return check }\n        const ok = match getF2(plainDeny)(p)" + M)],
  ["top-level getF returns param", L("const ok = match pick(plainDeny)(p)" + M, "    function pick(f) { return f }")],
  ["getF one plain return", L("const ok = match getF2(p)(p)" + M, "    function getF2(q) { if (q == \"x\") { return check }\n        return plain }")],
  ["const lambda returns check", L("const mk = () => check\n        const ok = match mk()(p)" + M)],
  ["const lambda param shadow", L("const mk = (check) => check\n        const ok = match mk(plainDeny)(p)" + M)],
];
