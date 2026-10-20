// Probe family `n13` — S469 (PR #1444 fix round 2): an event handler reaching `check` through a `const`
// alias — the one value read of a failable function impl#1 accepts (E-IMPL1-FAILABLE-FN-VALUE refuses the
// rest), so its handler uses must be checked like the function's own name. Data, not logic: the default
// export is a list of [name, scrml source, extraFiles?]. Side: client (click #wrong / #right, read #out).
// Do not edit a shape to make it pass.
//
// Found S469 fix round 2: `const h = check` + `onclick={ h("wrong")⏎ @msg = "LOGGED IN" }` compiled
// (the handler checks read the callee by NAME, `fnCanFail.has`, not through the alias): the error was
// discarded and the next statement logged in. Each handler here logs in after the call, so an
// accepted-but-unhandled call shows LOGGED IN on a wrong password.

export const SIDE = "client";

const PAGE = (wrong, right, wrap = (b) => b) => `type AuthErr:enum = { Denied }
<msg> = "init"
<xs> = [1]
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    const h = check
}
${wrap(`<button id="wrong" ${wrong}>go</button>`)}
${wrap(`<button id="right" ${right}>go</button>`)}
<p id="out">\${@msg}</p>
`;
const EACH = (b) => `<each in=@xs as x>${b}</each>`;
const SEQ = (p) => `onclick={\n    h("${p}")\n    @msg = "LOGGED IN"\n}`;
const GUARDED = (p) => `onclick={\n    h("${p}") !{ .Denied :> @msg = "rejected" }\n    @msg = @msg == "rejected" ? "rejected" : "LOGGED IN"\n}`;
export default [
  ["alias call then log in", PAGE(SEQ("wrong"), SEQ("secret"))],
  ["alias call then log in (each)", PAGE(SEQ("wrong"), SEQ("secret"), EACH)],
  ["alias call-ref", PAGE(`onclick=h("wrong")`, `onclick=h("secret")`)],
  ["alias reference", PAGE(`onclick=h`, `onclick=h`)],
  ["alias handled", PAGE(GUARDED("wrong"), GUARDED("secret"))],
];
