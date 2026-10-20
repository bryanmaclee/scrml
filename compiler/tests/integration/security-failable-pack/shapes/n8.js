// Probe family `n8` — copied VERBATIM (below this header) from S468 fix-round-1 review of 7ecae57eb (`~/.cache/scrml-agent-tmp/s468-rev-failable/n8.mjs`).
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
export default [
  ["enum value ternary arm", L("const ok = match (p == \"wrong\" ? AuthErr::Denied : check(p)) { .Denied :> false  _ :> true }")],
  ["enum value ternary arm dot", L("const ok = match (p == \"wrong\" ? .Denied : check(p)) { .Denied :> false  _ :> true }")],
  ["enum value || ", L("const ok = match (plainDeny(p) || check(p)) { .Denied :> false  _ :> true }")],
  ["enum value stmt", L("let ok = true\n        match (p == \"wrong\" ? AuthErr::Denied : check(p)) { .Denied :> { ok = false }  _ :> { ok = true } }")],
  ["control plain enum match", L("const ok = match (p == \"wrong\" ? AuthErr::Denied : AuthErr::Denied) { .Denied :> false }")],
];
