// Probe family `s1` — copied VERBATIM (below this header) from S468 fix-round-1 review of 7ecae57eb (`~/.cache/scrml-agent-tmp/s468-rev-failable/s1.mjs`).
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
    server function id(x) { return x }
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
const C = (body, pre = "") => S(body, pre).replace(/server function check/, "function check").replace(/server function id/, "function id");
export default [
  ["srv ctl const", S("const ok = check(p)")],
  ["srv ctl match", S("const ok = match check(p) { .Denied :> false  _ :> true }")],
  ["srv match ||", S("const ok = match (p == \"\" || check(p)) { .Denied :> false  _ :> true }")],
  ["srv match ??", S("const ok = match (null ?? check(p)) { .Denied :> false  _ :> true }")],
  ["srv match && right", S("const ok = match (p != \"\" && check(p)) { .Denied :> false  _ :> true }")],
  ["srv match ternary", S("const ok = match (p == \"\" ? false : check(p)) { .Denied :> false  _ :> true }")],
  ["srv match alias", S("const g = check\n        const ok = match g(p) { .Denied :> false  _ :> true }")],
  ["srv match alias ternary", S("const g = p ? check : id\n        const ok = match g(p) { .Denied :> false  _ :> true }")],
  ["srv match stmt ||", S("let ok = false\n        match (p == \"\" || check(p)) { .Denied :> { ok = false }  _ :> { ok = true } }")],
  ["srv alias ternary value", S("const g = p ? check : id\n        const ok = g(p)")],
  ["srv ret fn value", S("const ok = getF()(p)", "    server function getF() { return check }")],
  ["srv apply value", S("const ok = apply(check)", "    server function apply(f) { return f(\"wrong\") }")],
  ["srv curried", S("const mk = () => () => check\n        const ok = mk()()(p)")],
  ["srv id(check)", S("const ok = id(check)(p)")],
  ["srv-in client-check match ||", C("const ok = match (p == \"\" || check(p)) { .Denied :> false  _ :> true }")],
  ["srv-in client-check apply", C("const ok = apply(check)", "    function apply(f) { return f(\"wrong\") }")],
];
