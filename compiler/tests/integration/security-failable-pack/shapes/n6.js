// Probe family `n6` — copied VERBATIM (below this header) from S468 fix-round-1 review of 7ecae57eb (`~/.cache/scrml-agent-tmp/s468-rev-failable/n6.mjs`).
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (client: click #wrong / #right and read #out; server: POST the `login` route with p="wrong" / "secret").
// Do not edit a shape to make it pass. See ../pack.js for the classes and ../README.md for the why.

export const SIDE = "client";

const L = (decl) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    server function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function login(p) {
        ${decl}
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="w" onclick=login("wrong")>go</button>
<p id="out">\${@msg}</p>
`;
export default [
  ["cli->srv expr direct", L("const ok = match check(p) { .Denied :> false  _ :> true }")],
  ["cli->srv expr ||", L("const ok = match (false || check(p)) { .Denied :> false  _ :> true }")],
  ["cli->srv expr ternary", L("const ok = match (p == \"\" ? false : check(p)) { .Denied :> false  _ :> true }")],
  ["cli->srv stmt direct", L("let ok = false\n        match check(p) { .Denied :> { ok = false }  _ :> { ok = true } }")],
  ["cli->srv stmt ||", L("let ok = false\n        match (false || check(p)) { .Denied :> { ok = false }  _ :> { ok = true } }")],
];
