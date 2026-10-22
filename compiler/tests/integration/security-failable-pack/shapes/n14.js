// Probe family `n14` — S469 (s469-engine-effect-failable): a failable call in a body the compiler kept as
// RAW TEXT inside an `<engine>` or a `<match>` — a state-child `effect=`, the opener `effect=`, an
// `<onTransition>` body or `if=` guard, a `(state × message)` arm, a state-child / match-arm body, an
// `<onTimeout after=${…}>` delay, a `:`-shorthand body, a `<match>` arm body and the handlers in it
// (codegen lowered those from its own re-parse, which the walk never stamped). Data, not logic: the default export is a list
// of [name, scrml source]. Side: client (click #wrong / #right, read #out). Do not edit a shape to make
// it pass.
//
// Found S469: `<A rule=.B effect=${ @msg = check("wrong") ? "LOGGED IN" : "rejected" }>` compiled — the
// effect body was never walked for failable calls (§19.4.3, E-ERROR-002) and was emitted verbatim; the
// error object is truthy, so a wrong password logged in. The same for the opener `effect=` and for
// `(1, check("wrong"))`. Each button stores its password in `@pw`, then moves the engine to `.B` (or
// sends it a message); the body under test reads `check(@pw)`.

export const SIDE = "client";

const HEAD = `type AuthErr:enum = { Denied }
type S:enum = { A, B }
type M:enum = { Go }
<msg> = "init"
<pw> = ""
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
`;
const BTN = (act = "@s = .B") => `<button id="wrong" onclick={
    @pw = "wrong"
    ${act}
}>go</button>
<button id="right" onclick={
    @pw = "secret"
    ${act}
}>go</button>
`;
const OUT = `<p id="out">\${@msg}</p>\n`;
// A page whose engine is `body` (the state-children / hooks between the opener and the closer).
const ENG = (body, opener = "", act) => HEAD + BTN(act) + OUT + `<engine for=S initial=.A${opener}>\n${body}\n</engine>\n`;
const TERN = `@msg = check(@pw) ? "LOGGED IN" : "rejected"`;
// The state-child `effect=` (§51.0.H Form 1) of `.A`, fired on leaving `.A`.
const EFF = (e) => ENG(`<A rule=.B effect=\${ ${e} }><p>a</p></A>\n<B rule=.A><p>b</p></B>`);
// The opener `effect=` (§51.0.H Form 3), boot-only: no password reaches it, so it reads the literal.
const OPENER = (e) => HEAD + BTN() + OUT + `<engine for=S initial=.A effect=\${ ${e} }>\n<A rule=.B><p>a</p></A>\n<B rule=.A><p>b</p></B>\n</engine>\n`;
// An `<onTransition>` hook (§51.0.H Form 2) inside `.A`, or directly in the engine body.
const HOOK = (attrs, body) => ENG(`<A rule=.B>\n<p>a</p>\n<onTransition ${attrs}>\${ ${body} }</>\n</A>\n<B rule=.A><p>b</p></B>`);
const DIRECT = (attrs, body) => ENG(`<onTransition ${attrs}>\${ ${body} }</>\n<A rule=.B><p>a</p></A>\n<B rule=.A><p>b</p></B>`);
// A `(state × message)` arm (§51.0.S).
const ARM = (arm) => ENG(`<A rule=.B>\n.Go :> ${arm}\n</A>\n<B rule=.A>\n_ :> @s\n</B>`, " accepts=M", "@s.advance(.Go)");
// A state-child body that renders #out itself.
const BODY = (b) => HEAD + BTN() + `<engine for=S initial=.A>\n<A rule=.B><p id="out">\${@msg}</p></A>\n<B rule=.A>${b}</B>\n</engine>\n`;
// A `:`-shorthand state-child body that renders #out's text itself (one line: #out holds only it).
const SHORT = (b) => HEAD + BTN() + `<div id="out"><engine for=S initial=.A><A rule=.B : "rejected"><B rule=.A : ${b}></engine></div>\n`;
const MSHORT = (b) => HEAD + `<st> = S.A\n` + BTN("@st = S.B") + `<div id="out"><match for=S on=@st><A : "rejected"><B : ${b}></match></div>\n`;
// A `<match>` arm body that renders #out itself.
// A `<match>` / engine arm that is showing from the start and holds the buttons (handlers inside an arm body).
const MHANDLER = (wrong, right) => HEAD + `<st> = S.B\n<p id="out">\${@msg}</p>\n<match for=S on=@st>\n<A><p>a</p></A>\n<B><button id="wrong" ${wrong}>go</button><button id="right" ${right}>go</button></B>\n</match>\n`;
const EHANDLER = (wrong, right) => HEAD + `<p id="out">\${@msg}</p>\n<engine for=S initial=.B>\n<A rule=.B><p>a</p></A>\n<B rule=.A><button id="wrong" ${wrong}>go</button><button id="right" ${right}>go</button></B>\n</engine>\n`;
const MRENDER = (b) => HEAD + `<st> = S.A\n` + BTN("@st = S.B") + `<div id="out"><match for=S on=@st><A>rejected</A><B>${b}</B></match></div>\n`;
const HM = (p) => `onclick=\${ @msg = match check("${p}") { .Denied :> "rejected"  _ :> "LOGGED IN" } }`;
const HMSEQ = (p) => `onclick={\n    @pw = "${p}"\n    @msg = match check(@pw) { .Denied :> "rejected"  _ :> "LOGGED IN" }\n}`;
const HSEQ = (p) => `onclick={\n    check("${p}")\n    @msg = "LOGGED IN"\n}`;
const MATCH = (b) => HEAD + `<st> = S.A\n` + BTN("@st = S.B") + `<match for=S on=@st>\n<A><p id="out">\${@msg}</p></A>\n<B>${b}</B>\n</match>\n`;

export default [
  // --- state-child effect= ---
  ["effect ternary", EFF(TERN)],
  ["effect comma", EFF(`@msg = (1, check(@pw)) ? "LOGGED IN" : "rejected"`)],
  ["effect statement then log in", EFF(`check(@pw)\n    @msg = "LOGGED IN"`)],
  ["effect string hides close", EFF(`@msg = "}" + (check(@pw) ? "LOGGED IN" : "rejected")`)],
  ["effect string hides close (bare)", EFF(`@msg = "}" == "}" && check(@pw) ? "LOGGED IN" : "rejected"`)],
  ["effect comment hides close", EFF(`@msg = /* } */ check(@pw) ? "LOGGED IN" : "rejected"`)],
  ["effect template hides close", EFF("@msg = `}` == `}` && check(@pw) ? \"LOGGED IN\" : \"rejected\"")],
  ["effect match", EFF(`@msg = match check(@pw) { .Denied :> "rejected"  _ :> "LOGGED IN" }`)],
  ["effect arrow", EFF(`@msg = (() => check(@pw))() ? "LOGGED IN" : "rejected"`)],
  ["effect handled", EFF(`@msg = (check(@pw) !{ _ :> false }) ? "LOGGED IN" : "rejected"`)],
  ["effect handled statement", EFF(`check(@pw) !{ .Denied :> @msg = "rejected" }\n    @msg = @msg == "rejected" ? "rejected" : "LOGGED IN"`)],
  // --- opener effect= ---
  ["opener ternary", OPENER(`@msg = check("wrong") ? "LOGGED IN" : "rejected"`)],
  ["opener comma", OPENER(`@msg = (1, check("wrong")) ? "LOGGED IN" : "rejected"`)],
  ["opener statement then log in", OPENER(`check("wrong")\n    @msg = "LOGGED IN"`)],
  ["opener string hides close", OPENER(`@msg = "}" + (check("wrong") ? "LOGGED IN" : "rejected")`)],
  ["opener comment hides close", OPENER(`@msg = /* } */ check("wrong") ? "LOGGED IN" : "rejected"`)],
  ["opener match", OPENER(`@msg = match check("wrong") { .Denied :> "rejected"  _ :> "LOGGED IN" }`)],
  ["opener handled", OPENER(`@msg = (check("wrong") !{ _ :> false }) ? "LOGGED IN" : "rejected"`)],
  // --- <onTransition> ---
  ["onTransition to ternary", HOOK("to=.B", TERN)],
  ["onTransition to statement", HOOK("to=.B", `check(@pw)\n    @msg = "LOGGED IN"`)],
  ["onTransition to string hides close", HOOK("to=.B", `@msg = "}" + (check(@pw) ? "LOGGED IN" : "rejected")`)],
  ["onTransition from ternary", ENG(`<A rule=.B><p>a</p></A>\n<B rule=.A>\n<p>b</p>\n<onTransition from=.A>\${ ${TERN} }</>\n</B>`)],
  ["onTransition direct from-to ternary", DIRECT("from=.A to=.B", TERN)],
  ["onTransition direct to ternary", DIRECT("to=.B", TERN)],
  ["onTransition if= guard", HOOK("to=.B if=check(@pw)", `@msg = "LOGGED IN"`)],
  ["onTransition if= guard interp", HOOK("to=.B if=${check(@pw)}", `@msg = "LOGGED IN"`)],
  ["onTransition handled", HOOK("to=.B", `@msg = (check(@pw) !{ _ :> false }) ? "LOGGED IN" : "rejected"`)],
  // --- (state x message) arms ---
  ["message arm block", ARM(`{ ${TERN}; .B }`)],
  ["message arm target", ARM(`(check(@pw) ? .B : .A)`)],
  ["message arm handled", ARM(`{ @msg = (check(@pw) !{ _ :> false }) ? "LOGGED IN" : "rejected"; .B }`)],
  // --- bodies that render ---
  ["state body interp", BODY(`<p id="out">\${ check(@pw) ? "LOGGED IN" : "rejected" }</p>`)],
  ["state body comma", BODY(`<p id="out">\${ (1, check(@pw)) ? "LOGGED IN" : "rejected" }</p>`)],
  ["state shorthand body", SHORT(`check(@pw) ? "LOGGED IN" : "rejected"`)],
  ["match arm interp", MATCH(`<p id="out">\${ check(@pw) ? "LOGGED IN" : "rejected" }</p>`)],
  ["match shorthand body", MSHORT(`check(@pw) ? "LOGGED IN" : "rejected"`)],
  ["match shorthand match", MSHORT(`match check(@pw) { .Denied :> "rejected"  _ :> "LOGGED IN" }`)],
  ["state shorthand match", SHORT(`match check(@pw) { .Denied :> "rejected"  _ :> "LOGGED IN" }`)],
  ["match arm render match", MRENDER(`\${ match check(@pw) { .Denied :> "rejected"  _ :> "LOGGED IN" } }`)],
  ["match arm handler match", MHANDLER(HM("wrong"), HM("secret"))],
  ["match arm handler block match", MHANDLER(HMSEQ("wrong"), HMSEQ("secret"))],
  ["match arm handler sequence", MHANDLER(HSEQ("wrong"), HSEQ("secret"))],
  ["engine arm handler match", EHANDLER(HM("wrong"), HM("secret"))],
  ["engine arm handler block match", EHANDLER(HMSEQ("wrong"), HMSEQ("secret"))],
  // --- other expression sites ---
  ["onTimeout after", ENG(`<A rule=.B><p>a</p></A>\n<B rule=.A>\n<p>b</p>\n<onTimeout after=\${ (@msg = check(@pw) ? "LOGGED IN" : "rejected", 1) }ms to=.A/>\n</B>`)],
];
