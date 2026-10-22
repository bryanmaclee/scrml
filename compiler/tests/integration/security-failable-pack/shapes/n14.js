// Probe family `n14` — S469 (template-literal interpolation): an unhandled failable call inside a
// template literal's `${ … }` interpolation, in shapes the interpolation reader turned into an escape
// hatch with NO source text (a sequence, a block-bodied arrow / function expression, a tagged
// template whose tag is not a name, a tagged template whose tag is a failable function or an alias).
// Found by the #1444 review: each compiled with no error, and a wrong password logged in (the walker's
// empty-text early return was fail-open). Data, not logic: the default export is a list of
// [name, scrml source, extraFiles?]. Side: client (click #wrong / #right, read #out).
// Do not edit a shape to make it pass.

export const SIDE = "client";

const L = (decl) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    const g = check
    function login(p) {
        ${decl}
        const ok = s == "Y"
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;
// Markup: the interpolation renders at mount; #wrong copies the rendered verdict into #out.
const MARKUP = (interp) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    const g = check
}
<button id="wrong" onclick=\${ @msg = document.querySelector("#r").textContent }>go</button>
<button id="right" onclick=\${ @msg = "rejected" }>go</button>
<p id="r">${interp}</p>
<p id="out">\${@msg}</p>
`;
export default [
  ["sequence", L('const s = `${(check(p), 1) ? "Y" : "N"}`')],
  ["arrow IIFE", L('const s = `${(() => { return check(p) })() ? "Y" : "N"}`')],
  ["function IIFE alias", L('const s = `${(function(){ return g(p) })() ? "Y" : "N"}`')],
  ["String.raw nested alias", L("const s = `${String.raw`${g(p) ? 'Y' : 'N'}`}`")],
  ["alias tag", L('const s = `${g`${p}` ? "Y" : "N"}`')],
  ["check tag", L('const s = `${check`${p}` ? "Y" : "N"}`')],
  ["expression arrow sequence", L('const s = `${(() => (check(p), 1))() ? "Y" : "N"}`')],
  ["no template: expression arrow sequence", L('const s = (() => (check(p), 1))() ? "Y" : "N"')],
  ["no template: arrow IIFE", L('const s = (() => { return check(p) })() ? "Y" : "N"')],
  ["markup arrow IIFE", MARKUP('${`${(() => { return check("wrong") })() ? "LOGGED IN" : "rejected"}`}')],
];
