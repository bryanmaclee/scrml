// Probe family `n24` — S469 round 2 of s469-impl1-arm-commas (review of 2f9176de0, F1 / F2): an
// expression-position `match` whose arm body holds a REGULAR EXPRESSION LITERAL. Data, not logic: the
// default export is a list of [name, scrml source]. Side: client (click #wrong / #right, read #out).
// Do not edit a shape to make it pass.
//
// Found S469 (F2): the raw-arm splitters tracked quotes but not regex literals, so a quote inside a
// regex (`/"/`, `/'/`, `` /`/ ``, `/[/"]/`) flipped the string scan, the next arm's head was never seen,
// and that arm was SILENTLY DROPPED — the previous arm's body swallowed it as a JS comma sequence and
// returned the next arm's PATTERN (`return (c ? "rejected" : "rejected", "LOGGED IN")`), exit 0, no
// diagnostic. Here the status strings double as messages, so a dropped arm logs the wrong password in.
// Every spelling of the arm list is probed: newline-separated, comma-separated (S469 §18.2), mixed.
// (F1: a `,` inside the regex — `/a,b/` — was refused as a stray arm separator; those shapes must
// compile and reject.) Measured on 2f9176de0: the comma and mixed spellings of the `"` / `'` / `[/"]`
// shapes are FAIL (the wrong password logs in), their newline spelling PASS-DENY (the `"LOGGED IN"` arm
// dropped), the `/a,b/` shapes PASS-REFUSED; all 15 PASS after the lexer-read fix.

export const SIDE = "client";

const PAGE = (arms) => `type AuthErr:enum = { Denied }
<msg> = "init"
<st> = ""
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function status(p) {
        const ok = check(p) !{ .Denied :> false }
        return ok == true ? "LOGGED IN" : "denied"
    }
    function login(p) {
        @st = status(p)
        @msg = match @st {
${arms}
        }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;

const ARMS = (re, sep) => {
  const [s1, s2, s3] = sep;
  return [
    `            "denied" :> ${re}.test(@st) ? "rejected" : "rejected"${s1}`,
    `            "LOGGED IN" :> "LOGGED IN"${s2}`,
    `            else :> "rejected"${s3}`,
  ].join("\n");
};

const SPELLINGS = [
  ["newline", ["", "", ""]],
  ["comma", [",", ",", ","]],
  ["mixed", [",", "", ""]],
];
const REGEXES = [
  ["dquote", `/"/`],
  ["squote", `/'/`],
  ["backtick", "/`/"],
  ["class-slash-quote-flags", `/[/"]x/gi`],
  ["comma", `/a,b/`],
];

const shapes = [];
for (const [rn, re] of REGEXES) {
  for (const [sn, sep] of SPELLINGS) shapes.push([`regex ${rn} in an arm body (${sn} arms)`, PAGE(ARMS(re, sep))]);
}
export default shapes;
