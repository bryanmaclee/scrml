// Probe family `n11` — S469 (PR #1444 fix round 1, agent 2): a `match` on a failable result written
// INSIDE an event-handler attribute, every handler value form × every container the handler sits in.
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (click #wrong / #right and read #out). Do not edit a shape to make it pass.
//
// Found while fixing g-match-failable-subject-in-handler-attribute-not-discriminated-s468: the pack's
// one handler shape (n3 "handler direct") was a sample of a wider hole — every ONE-statement handler
// value (`${ … }`, a one-line braced value, a braced value holding one `match` statement, an expression
// arrow) was checked by TS on a re-parsed COPY while codegen lowered the value's own node (or re-read
// its text), so the stamp never reached the lowering. Measured on 181012c20 (top level): expr handler,
// braced one-line, braced stmt match and arrow expr all LOGGED IN on a wrong password.

export const SIDE = "client";

const PAGE = (wrong, right, wrap) => `type AuthErr:enum = { Denied }
<msg> = "init"
<xs> = [1]
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
${wrap(`<button id="wrong" ${wrong}>go</button>`, "W")}
${wrap(`<button id="right" ${right}>go</button>`, "R")}
<p id="out">\${@msg}</p>
`;
const M = (p) => `match check("${p}") { .Denied :> "rejected"  _ :> "LOGGED IN" }`;
const FORMS = [
  ["expr handler", (p) => `onclick=\${ @msg = ${M(p)} }`],
  ["braced one-line", (p) => `onclick={ @msg = ${M(p)} }`],
  ["braced multi", (p) => `onclick={\n    @msg = ${M(p)}\n    @msg = @msg\n}`],
  ["braced stmt match", (p) => `onclick={\n    match check("${p}") { .Denied :> { @msg = "rejected" }  _ :> { @msg = "LOGGED IN" } }\n}`],
  ["arrow block", (p) => `onclick=\${() => { @msg = ${M(p)} }}`],
  ["arrow expr", (p) => `onclick=\${() => @msg = ${M(p)}}`],
  ["const in braced", (p) => `onclick={\n    const r = ${M(p)}\n    @msg = r\n}`],
];
const WRAPS = [
  ["top", (b) => b],
  ["each", (b) => `<each in=@xs as x>${b}</each>`],
  ["component", (b, k) => `\${ const Wc${k} = <div>${b}</div> }\n<Wc${k}/>`],
  ["if", (b) => `<div if=\${@msg != "zzz"}>${b}</div>`],
];

const shapes = [];
for (const [form, attr] of FORMS) {
  for (const [where, wrap] of WRAPS) shapes.push([`${form} (${where})`, PAGE(attr("wrong"), attr("secret"), wrap)]);
}
export default shapes;
