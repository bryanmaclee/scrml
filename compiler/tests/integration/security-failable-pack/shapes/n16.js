// Probe family `n16` — S469 (the review of 834e41cba, F1 + F2): two more readers the failable walk did
// not share with codegen.
//   F1 — a LABELED BLOCK in a function-expression body (`() => { a: { return check(p) } }`): the walk's
//        lenient statement parser read `a: { … }` as the bare expression `a`, dropped the block and
//        reported the body readable — the call inside was never seen.
//   F2 — a QUOTED attribute value with a `${ … }` interpolation (`<p data-v="${check("wrong") ? … }">`):
//        the attribute walk skipped string-valued attributes, while codegen emits the interpolation as
//        JavaScript.
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (click #wrong / #right, read #out). Do not edit a shape to make it pass.

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
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;

// F2: the attribute renders at mount with the WRONG password; #wrong copies it into #out.
const ATTR = (attr, value, read = `getAttribute("${attr}")`) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    const g = check
}
<button id="wrong" onclick=\${ @msg = document.querySelector("#r").${read} }>go</button>
<button id="right" onclick=\${ @msg = "rejected" }>go</button>
<p id="r" ${attr}="${value}">r</p>
<p id="out">\${@msg}</p>
`;
// F2 inside other markup containers: `body` renders #r.
const HELD = (body) => `type AuthErr:enum = { Denied }
<msg> = "init"
<xs> = ["wrong"]
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
<button id="wrong" onclick=\${ @msg = document.querySelector("#r").getAttribute("data-v") }>go</button>
<button id="right" onclick=\${ @msg = "rejected" }>go</button>
${body}
<p id="out">\${@msg}</p>
`;
const V = (call) => `\${${call} ? "LOGGED IN" : "rejected"}`;

export default [
  // F1
  ["labeled block in a template IIFE", L('const s = `${(() => { a: { return check(p) } })() ? "Y" : "N"}`\n        const ok = s == "Y"')],
  ["labeled block in an arrow", L('const h = (q) => { a: { return check(q) } }\n        const ok = h(p)')],
  ["labeled block in a function expression", L('const h = function (q) { a: { return check(q) } }\n        const ok = h(p)')],
  ["labeled block through an alias", L('const h = (q) => { a: { return g(q) } }\n        const ok = h(p)')],
  ["labeled loop in an arrow", L('const h = (q) => { outer: for (const x of [q]) { return check(x) } }\n        const ok = h(p)')],
  // F2
  ["data-* attribute", ATTR("data-v", V('check("wrong")'))],
  ["class attribute", ATTR("class", V('check("wrong")'))],
  ["href attribute", ATTR("href", V('check("wrong")'))],
  ["title attribute through an alias", ATTR("title", V('g("wrong")'))],
  ["attribute .map callback", ATTR("data-v", '${["wrong"].map(x => check(x) ? "LOGGED IN" : "rejected").join("")}')],
  ["attribute tagged template", ATTR("data-v", V('g`${"wrong"}`'))],
  ["attribute String.raw", ATTR("data-v", "${String.raw`${check(\"wrong\") ? 'LOGGED IN' : 'rejected'}`}")],
  ["attribute sequence", ATTR("data-v", V('(check("wrong"), 1)'))],
  ["attribute IIFE", ATTR("data-v", V('(() => { return check("wrong") })()'))],
  ["attribute text around the interpolation", ATTR("data-v", 'x ${check("wrong") ? "LOGGED IN" : "rejected"} y', 'getAttribute("data-v").slice(2, -2)')],
  ["attribute in markup an expression holds", HELD(`<div>\${ @xs.length > 0 ? <p id="r" data-v="\${check('wrong') ? 'LOGGED IN' : 'rejected'}">r</p> : "" }</div>`)],
  ["attribute in markup a function returns", HELD(`\${\n    function mk() { return <p id="r" data-v="\${check('wrong') ? 'LOGGED IN' : 'rejected'}">r</p> }\n}\n<div>\${mk()}</div>`)],
  ["attribute in an <each> row", HELD('<each in=@xs as x><p id="r" data-v="${check(x) ? "LOGGED IN" : "rejected"}">r</p></each>')],
  ["attribute in a component", HELD('const Row = <p id="r" data-v="${check("wrong") ? "LOGGED IN" : "rejected"}">r</p>\n<Row/>')],
];
