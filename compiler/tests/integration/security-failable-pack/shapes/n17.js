// Probe family `n17` — S469 (the review of 065fd2035, HIGH-1 + HIGH-2): a quoted attribute value's
// `${ … }` where the compiler's text slicing disagreed with what the browser runs.
//   HIGH-1 — a `}` inside a COMMENT or a REGULAR EXPRESSION in the interpolation closed the slice
//            early: the walk read ` /* ` (naming nothing) while JavaScript ran `check(…)` after it.
//   HIGH-2 — a LINE TERMINATOR inside a quoted template attribute ended the `// template-attr …`
//            comment codegen wrote above its binding, so the rest of the value RAN as code, unread.
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (click #wrong / #right, read #out). Do not edit a shape to make it pass.

export const SIDE = "client";

const ATTR = (value) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    const g = check
}
<button id="wrong" onclick=\${ @msg = document.querySelector("#r").getAttribute("data-v") }>go</button>
<button id="right" onclick=\${ @msg = "rejected" }>go</button>
<p id="r" data-v="${value}">r</p>
<p id="out">\${@msg}</p>
`;

// HIGH-2: the injected line sets window.__inj; #wrong copies it.
const INJ = (sep, callee = "check") => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    const g = check
}
<button id="wrong" onclick=\${ @msg = String(window.__inj) }>go</button>
<button id="right" onclick=\${ @msg = "rejected" }>go</button>
<p id="r" data-v="a \${1}${sep}window.__inj = ${callee}('wrong') ? 'LOGGED IN' : 'rejected';//">r</p>
<p id="out">\${@msg}</p>
`;

export default [
  ["comment holding a brace", ATTR("${ /* } */ check('wrong') ? 'LOGGED IN' : 'rejected' }")],
  ["comment holding a brace, alias", ATTR("${ /* } */ g('wrong') ? 'LOGGED IN' : 'rejected' }")],
  ["regex holding a brace", ATTR("${ 'a'.replace(/}/, '') && check('wrong') ? 'LOGGED IN' : 'rejected' }")],
  ["regex holding a brace, alias", ATTR("${ 'a'.replace(/}/, '') && g('wrong') ? 'LOGGED IN' : 'rejected' }")],
  ["line comment then a call", ATTR("${ 1 // }\n && check('wrong') ? 'LOGGED IN' : 'rejected' }")],
  ["newline injection", INJ("\n")],
  ["carriage-return injection", INJ("\r")],
  ["U+2028 injection", INJ("\u2028")],
  ["U+2029 injection", INJ("\u2029")],
  ["newline injection, alias", INJ("\n", "g")],
];
