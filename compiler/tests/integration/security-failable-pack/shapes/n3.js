// Probe family `n3` — copied VERBATIM (below this header) from S468 fix-round-1 review of 7ecae57eb (`~/.cache/scrml-agent-tmp/s468-rev-failable/n3.mjs`).
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
const H = (subj) => L("const ok = false").replace('onclick=login("wrong")', `onclick=\${ @msg = match ${subj.replace(/P/g,'"wrong"')} { .Denied :> "rejected"  _ :> "LOGGED IN" } }`).replace('onclick=login("secret")', `onclick=\${ @msg = match ${subj.replace(/P/g,'"secret"')} { .Denied :> "rejected"  _ :> "LOGGED IN" } }`);
export default [
  ["handler direct", H("check(P)")],
  ["handler ||", H("(false || check(P))")],
  ["handler ternary", H("(true ? check(P) : false)")],
  ["handler ??", H("(null ?? check(P))")],
  ["lambda direct", L("const f = () => match check(p)" + M + "\n        const ok = f()")],
  ["lambda ||", L("const f = () => match (false || check(p))" + M + "\n        const ok = f()")],
  ["lambda block ||", L("const f = () => { return match (false || check(p))" + M + " }\n        const ok = f()")],
];
