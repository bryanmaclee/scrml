// Probe family `n9` — copied VERBATIM (below this header) from the S468 fix-round-1 dev (`~/.cache/scrml-agent-tmp/s468-failable-alias-and-match/cases/n9.mjs`): the F1 class through a NAME.
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (client: click #wrong / #right and read #out; server: POST the `login` route with p="wrong" / "secret").
// Do not edit a shape to make it pass. See ../pack.js for the classes and ../README.md for the why.

export const SIDE = "client";

// S468 fix round 1 — F1 through a NAME: a callee that may be a plain function returning a plain enum value
const L = (decl, pre = "") => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function plainDeny(p) { return AuthErr::Denied }
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
const M = " { .Denied :> false  _ :> true }";
export default [
  ["mixed ternary alias plainDeny", L("const g = p == \"wrong\" ? plainDeny : check\n        const ok = match g(p)" + M)],
  ["mixed || alias", L("const g = plainDeny || check\n        const ok = match g(p)" + M)],
  ["mixed getF", L("const ok = match getF(p)(p)" + M, "    function getF(q) { if (q == \"wrong\") { return plainDeny }\n return check }")],
  ["mixed callee ternary", L("const ok = match (p == \"wrong\" ? plainDeny : check)(p)" + M)],
  ["exact alias", L("const g = check\n        const ok = match g(p)" + M)],
  ["exact getF", L("const ok = match getF()(p)" + M, "    function getF() { return check }")],
  ["let alias reassigned plain", L("let g = check\n        if (p == \"wrong\") { g = plainDeny }\n        const ok = match g(p)" + M)],
  ["direct", L("const ok = match check(p)" + M)],
  ["multi mixed alias", L("const g = p == \"wrong\" ? plainDeny : check\n        const ok = match (g(p), 1) { (.Denied, _) :> false  _ :> true }")],
  ["multi plainDeny direct", L("const ok = match (plainDeny(p), 1) { (.Denied, _) :> false  _ :> true }")],
  ["stmt mixed alias", L("const g = p == \"wrong\" ? plainDeny : check\n        let ok = false\n        match g(p) { .Denied :> { ok = false }  _ :> { ok = true } }")],
];
