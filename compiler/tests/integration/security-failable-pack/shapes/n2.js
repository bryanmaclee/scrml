// Probe family `n2` — copied VERBATIM (below this header) from S468 fix-round-1 review of 7ecae57eb (`~/.cache/scrml-agent-tmp/s468-rev-failable/n2.mjs`).
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
const SM = " { .Denied :> { ok = false }  _ :> { ok = true } }";
const Ls = (pre) => (d) => L(d, pre);
const SV = (decl) => L(decl).replace(/function check/, "server function check");
export default [
  ["stmt direct", L("let ok = false\n        match check(p)" + SM)],
  ["stmt ||", L("let ok = false\n        match (p == \"\" || check(p))" + SM)],
  ["stmt ternary", L("let ok = false\n        match (p == \"\" ? false : check(p))" + SM)],
  ["stmt alias", L("const g = check\n        let ok = false\n        match g(p)" + SM)],
  ["stmt alias in block", L("let ok = false\n        if (p != \"zz\") { const g = check\n match g(p)" + SM + " }")],
  ["expr ||", L("const ok = match (p == \"\" || check(p))" + M)],
  ["expr || truthy left", L("const ok = match (p != \"\" || check(p))" + M)],
  ["expr ?? ", L("const ok = match (null ?? check(p))" + M)],
  ["expr && right", L("const ok = match (p != \"\" && check(p))" + M)],
  ["expr ternary", L("const ok = match (p == \"\" ? false : check(p))" + M)],
  ["expr nested ||", L("const ok = match (false || (false || check(p)))" + M)],
  ["expr paren", L("const ok = match ((check(p)))" + M)],
  ["expr ! not", L("const ok = !(match (false || check(p))" + M + ")")],
  ["expr alias", L("const g = check\n        const ok = match g(p)" + M)],
  ["expr alias ternary", L("const g = p ? check : id\n        const ok = match g(p)" + M)],
  ["expr getF", L("const ok = match getF()(p)" + M, "    function getF() { return check }")],
  ["expr curried", L("const mk = () => () => check\n        const ok = match mk()()(p)" + M)],
  ["expr id(check)", L("const ok = match id(check)(p)" + M)],
  ["expr apply", L("const ok = match apply(check)" + M, "    function apply(f) { return f(\"wrong\") }")],
  ["expr in lambda", L("const f = () => match (false || check(p))" + M + "\n        const ok = f()")],
  ["expr in map", L("const ok = [p].map((q) => match (false || check(q))" + M + ")[0]")],
  ["expr in block", L("let ok = false\n        if (p != \"zz\") { ok = match (false || check(p))" + M + " }")],
  ["expr in if cond", L("let ok = false\n        if (match (false || check(p))" + M + ") { ok = true }")],
  ["expr in while cond", L("let ok = false\n        while (match (false || check(p))" + M + ") { ok = true\n break }")],
  ["expr Ok binds", L("const ok = match (false || check(p)) { .Denied :> false  .Ok(v) :> v }")],
  ["expr Ok binds left value", L("const ok = match (p == \"wrong\" || check(p)) { .Denied :> false  .Ok(v) :> v }")],
  ["multi direct", L("const ok = match (check(p), 1) { (.Denied, _) :> false  _ :> true }")],
  ["multi ||", L("const ok = match (false || check(p), 1) { (.Denied, _) :> false  _ :> true }")],
  ["multi second", L("const ok = match (1, check(p)) { (_, .Denied) :> false  _ :> true }")],
  ["multi alias", L("const g = check\n        const ok = match (g(p), 1) { (.Denied, _) :> false  _ :> true }")],
  ["multi alias ternary", L("const g = p ? check : id\n        const ok = match (g(p), 1) { (.Denied, _) :> false  _ :> true }")],
  ["two failables ||", L("const ok = match (check(\"zz\") || check(p)) { .Denied :> false  _ :> true }")],
  ["mixed enum ||", L("const ok = match (other(p) || check(p)) { .Denied :> false  _ :> true }", "    function other(p)! -> AuthErr { if (p == \"\") fail AuthErr::Denied\n return false }")],
  ["markup interp match ||", L("const ok = false").replace('<p id="out">${@msg}</p>', '<p id="out">${match (false || check("wrong")) { .Denied :> "rejected"  _ :> "LOGGED IN" }}</p>')],
  ["handler inline match ||", L("const ok = false").replace('onclick=login("wrong")', 'onclick=${ @msg = match (false || check("wrong")) { .Denied :> "rejected"  _ :> "LOGGED IN" } }')],
];
