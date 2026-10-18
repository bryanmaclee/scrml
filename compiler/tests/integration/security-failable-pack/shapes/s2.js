// Probe family `s2` — copied VERBATIM (below this header) from S468 fix-round-1 review of 7ecae57eb (`~/.cache/scrml-agent-tmp/s468-rev-failable/s2.mjs`).
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: server
// (client: click #wrong / #right and read #out; server: POST the `login` route with p="wrong" / "secret").
// Do not edit a shape to make it pass. See ../pack.js for the classes and ../README.md for the why.

export const SIDE = "server";

const S = (body, pre = "") => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    server function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
${pre}
    server function login(p) {
        ${body}
        return ok ? "LOGGED IN" : "rejected"
    }
    function go() { @msg = login("wrong") !{ _ :> "err" } }
}
<button onclick=go()>go</button>
<p>\${@msg}</p>
`;
export default [
  ["stmt direct", S("let ok = false\n        match check(p) { .Denied :> { ok = false }  _ :> { ok = true } }")],
  ["stmt direct paren", S("let ok = false\n        match (check(p)) { .Denied :> { ok = false }  _ :> { ok = true } }")],
  ["stmt ||", S("let ok = false\n        match (p == \"\" || check(p)) { .Denied :> { ok = false }  _ :> { ok = true } }")],
  ["stmt ??", S("let ok = false\n        match (null ?? check(p)) { .Denied :> { ok = false }  _ :> { ok = true } }")],
  ["stmt ternary", S("let ok = false\n        match (p == \"\" ? false : check(p)) { .Denied :> { ok = false }  _ :> { ok = true } }")],
  ["stmt || Ok arm", S("let ok = false\n        match (p == \"\" || check(p)) { .Denied :> { ok = false }  .Ok(v) :> { ok = v } }")],
  ["stmt || expr arms", S("let ok = false\n        match (p == \"\" || check(p)) { .Denied :> ok = false  _ :> ok = true }")],
];
