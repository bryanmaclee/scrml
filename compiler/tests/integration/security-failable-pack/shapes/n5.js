// Probe family `n5` — copied VERBATIM (below this header) from S468 fix-round-1 review of 7ecae57eb (`~/.cache/scrml-agent-tmp/s468-rev-failable/n5.mjs`).
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
    function plain(p) { return p == "secret" }
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
  // false-refusal probes: want OK, wrong->rejected, right->LOGGED IN
  ["FR guard alias ternary", L("const g = p ? check : plain\n        const ok = g(p) !{ .Denied :> false }")],
  ["FR ? through alias in ! fn", L("const ok = w(p) !{ _ :> false }", "    function w(p)! -> AuthErr { const g = p ? check : plain\n        const v = g(p)?\n        return v }")],
  ["FR match alias ternary", L("const g = p ? check : plain\n        const ok = match g(p) { .Denied :> false  _ :> true }")],
  ["FR getF guarded", L("const ok = getF()(p) !{ .Denied :> false }", "    function getF() { return check }")],
  ["FR nested same-name getF (plain)", L("function getF() { return plain }\n        const ok = getF()(p)", "    function other() { function getF() { return check }\n        return getF()(\"x\") !{ _ :> false } }")],
  ["FN nested same-name getF (failable)", L("function getF() { return check }\n        const ok = getF()(p)", "    function other() { function getF() { return plain }\n        return getF()(\"x\") }")],
  ["FN global getF plain, local getF failable", L("function getF() { return check }\n        const ok = getF()(p)", "    function getF() { return plain }")],
  ["FR reassigned away after use", L("let g = check\n        const a = g(p) !{ _ :> false }\n        g = plain\n        const ok = g(p)")],
  ["FR other function's local alias", L("const g = plain\n        const ok = g(p)", "    function other() { const g = check\n        return g(\"x\") !{ _ :> false } }")],
  ["FR param shadow returns", L("const ok = t(plain)", "    function t(getF) { return getF(\"secret\") == false ? false : getF(\"wrong\") }\n    function getF() { return check }")],
  ["FR && left fn", L("const g = check && plain\n        const ok = g(p)")],
  ["FR lambda param named check", L("const ok = ((check) => check(p))(plain)")],
  ["FR local check shadow ternary", L("const check = plain\n        const g = p ? check : plain\n        const ok = g(p)")],
  ["FR block lambda returns shadow", L("const mk = (check) => { return check }\n        const ok = mk(plain)(p)")],
  ["FR module let reassigned to plain", L("const ok = gg(p)", "    let gg = check\n    gg = plain")],
  ["FR ternary result not fn", L("const g = p ? 1 : 2\n        const ok = plain(p) && g == 1")],
  ["FR returns value of handled call", L("const ok = getV(p)", "    function getV(p) { return check(p) !{ _ :> false } }")],
];
