// Probe family `n4` — copied VERBATIM (below this header) from S468 fix-round-1 review of 7ecae57eb (`~/.cache/scrml-agent-tmp/s468-rev-failable/n4.mjs`).
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (client: click #wrong / #right and read #out; server: POST the `login` route with p="wrong" / "secret").
// Do not edit a shape to make it pass. See ../pack.js for the classes and ../README.md for the why.

export const SIDE = "client";

const HD = `type AuthErr:enum = { Denied }
<msg> = "init"
<pw> = "wrong"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
`;
const BTN = `<button id="wrong" onclick=\${ @pw = "wrong" }>w</button>
<button id="right" onclick=\${ @pw = "secret" }>r</button>
`;
const X = (s) => [s.replace(/SUBJ/g, '(false || check(@pw))'), s.replace(/SUBJ/g, 'check(@pw)')];
const mk = (name, body) => { const [a, b] = X(body); return [[name + " ||", HD + a + BTN], [name + " direct", HD + b + BTN]]; };
export default [
  ...mk("markup interp", `<p id="out">\${match SUBJ { .Denied :> "rejected"  _ :> "LOGGED IN" }}</p>\n`),
  ...mk("derived const", `\${ const shown = match SUBJ { .Denied :> "rejected"  _ :> "LOGGED IN" } }\n<p id="out">\${shown}</p>\n`),
  ...mk("if= attr", `<p id="out" >\${ "x" }</p><p if=\${match SUBJ { .Denied :> false  _ :> true }} id="li">LOGGED IN</p>\n`),
  ...mk("ternary interp", `<p id="out">\${(match SUBJ { .Denied :> false  _ :> true }) ? "LOGGED IN" : "rejected"}</p>\n`),
];
