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

// S469 r3 — g-impl1-expr-match-literal-alternation-first-alternate-dropped-s469: a LITERAL
// alternation arm (`401 | 403 :>`, `"denied" | "locked" :>`) in an expression-position match lost
// every alternate but the last (the raw-arm splitter took the last one as the arm start), so the
// dropped status fell through to the default arm — here a default-ALLOW, the way a deny-list is
// written. Measured on the r2 head c4233fa33 (before the fix): every NEWLINE-spelled shape is FAIL
// (the wrong password logs in) in the `@cell = match` and call-argument positions, and PASS-REFUSED
// (E-CODEGEN-INVALID-LOGIC) as a derived `const <msg>`; the comma / mixed spellings happened to pass
// there because each arm arrived as its own raw arm. All 27 PASS after the fix.
const STATUS = {
  number: { deny: "401", ok: "200", alts: "401 | 403", other: "500" },
  string: { deny: `"denied"`, ok: `"ok"`, alts: `"denied" | "locked"`, other: `"error"` },
  mixed: { deny: "401", ok: "200", alts: `"denied" | 401 | 403`, other: "500" },
  negative: { deny: "-1", ok: "200", alts: "-2 | -1", other: "-3" },
  "negative-spaced": { deny: "-1", ok: "200", alts: "-2 | - 1", other: "-3" },
};
const ALT_ARMS = (k, sep, ind, ar = ":>") => [
  `${STATUS[k].alts} ${ar} "rejected"${sep[0]}`,
  `${STATUS[k].other} ${ar} "rejected"${sep[1]}`,
  `_ ${ar} "LOGGED IN"${sep[2]}`,
].map((l) => ind + l).join("\n");
const ALT_PAGE = (k, pos, sep, ar = ":>") => {
  const { deny, ok } = STATUS[k];
  const head = `type AuthErr:enum = { Denied }
<msg> = "init"
<st>: number | string = 0
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function code(p) {
        const good = check(p) !{ .Denied :> false }
        return good == true ? ${ok} : ${deny}
    }
    function pass(x) { return x }
`;
  const tail = `<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;
  if (pos === "cell") return `${head}    function login(p) {
        @st = code(p)
        @msg = match @st {
${ALT_ARMS(k, sep, "            ", ar)}
        }
    }
}
${tail}`;
  if (pos === "call argument") return `${head}    function login(p) {
        @st = code(p)
        @msg = pass(match @st {
${ALT_ARMS(k, sep, "            ", ar)}
        })
    }
}
${tail}`;
  // derived cell: the message is derived from the status
  return head.replace(`<msg> = "init"\n`, "") + `    function login(p) { @st = code(p) }
}
const <msg> = match @st {
    0 ${ar} "init"${sep[0]}
${ALT_ARMS(k, sep, "    ", ar)}
}
${tail}`;
};
for (const k of ["number", "string", "mixed"]) {
  for (const pos of ["cell", "call argument", "derived cell"]) {
    for (const [sn, sep] of SPELLINGS) shapes.push([`literal alternation ${k} deny-list, ${pos} (${sn} arms)`, ALT_PAGE(k, pos, sep)]);
  }
}

// S469 r4 (final review of 6f35fa4bb, F1) — a NEGATIVE later alternate (`-2 | -1 :>`, `-2 | - 1 :>`)
// lost its sign and the alternates before it (`=== 1`), so a denied status of -1 fell to the
// default-ALLOW arm; with the deprecated `->` arrow too (the raw text joins it as `- >`).
// Measured on 6f35fa4bb: the `:>` shapes FAIL at the call-argument position, the `->` shapes at
// the `@cell` / call-argument / derived positions; all PASS after the fix.
for (const k of ["negative", "negative-spaced"]) {
  for (const ar of [":>", "->"]) {
    for (const pos of ["cell", "call argument", "derived cell"]) {
      for (const [sn, sep] of SPELLINGS) shapes.push([`literal alternation ${k} deny-list ${ar}, ${pos} (${sn} arms)`, ALT_PAGE(k, pos, sep, ar)]);
    }
  }
}

// S469 r5 — g-impl1-legacy-pipe-literal-match-arms-s469: a `match` arm written with the `!{}`
// handler's legacy leading `|` (`| 401 :> …`). §18.2's `match` has none; impl#1 read past it — a
// statement match ran its LAST arm for every subject, a value match dispatched on the wrong arm — so a
// deny-list with a default-ALLOW arm logged the wrong password in. Now refused (E-PARSE-001) in every
// position and spelling: these shapes must be PASS-REFUSED. Measured on be0a7799d (before the fix):
// the statement shapes FAIL in every spelling.
const PIPE_PAGE = (deny, pos, armsText) => `type AuthErr:enum = { Denied }
<msg> = "init"
<st>: number | string = 0
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function code(p) {
        const good = check(p) !{ .Denied :> false }
        return good == true ? 200 : ${deny}
    }
    function pass(x) { return x }
    function login(p) {
        @st = code(p)
${pos === "statement" ? `        match @st {\n${armsText(true)}\n        }` : pos === "call argument" ? `        @msg = pass(match @st {\n${armsText(false)}\n        })` : `        @msg = match @st {\n${armsText(false)}\n        }`}
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;
const PIPE_LISTS = {
  // every arm `|`-led; the denied status is 401
  "every arm piped": ["401", [["| 401", `"rejected"`], ["| 403", `"rejected"`], ["| _", `"LOGGED IN"`]]],
  // a later arm `|`-led; the denied status is 403
  "later arm piped": ["403", [["401", `"rejected"`], ["| 403", `"rejected"`], ["_", `"LOGGED IN"`]]],
  // a string status, every arm `|`-led
  "string, every arm piped": [`"denied"`, [[`| "denied"`, `"rejected"`], [`| "locked"`, `"rejected"`], ["| _", `"LOGGED IN"`]]],
};
for (const [ln, [deny, arms]] of Object.entries(PIPE_LISTS)) {
  for (const pos of ["statement", "cell"]) {
    for (const [sn, sep] of SPELLINGS) {
      const armsText = (stmt) => arms
        .map(([h, b], i) => `            ${h} :> ${stmt ? `{ @msg = ${b} }` : b}${sep[i]}`).join("\n");
      shapes.push([`legacy-pipe match arms ${ln}, ${pos} (${sn} arms)`, PIPE_PAGE(deny, pos, armsText)]);
    }
  }
}

// S469 r6 (final review of fc046f011) — a `|`-led FIRST arm before two or more literal arms, at the
// `@cell` and call-argument positions: the raw splitter dropped the text before the first arm head
// it found, so the `| "denied"` arm vanished and the denied status fell to the default-ALLOW arm.
// Measured on fc046f011: the 4 newline-spelled shapes FAIL (the wrong password logs in); all 12 must
// be PASS-REFUSED (E-PARSE-001).
const PIPE_FIRST_LISTS = {
  "first arm piped before three string arms": [`"denied"`, [[`| "denied"`, `"rejected"`], [`"x"`, `"rejected"`], [`"y"`, `"rejected"`], ["else", `"LOGGED IN"`]]],
  "first arm piped before three number arms": ["401", [["| 401", `"rejected"`], ["402", `"rejected"`], ["403", `"rejected"`], ["_", `"LOGGED IN"`]]],
};
const SPELLINGS4 = [["newline", ["", "", "", ""]], ["comma", [",", ",", ",", ","]], ["mixed", [",", "", ",", ""]]];
for (const [ln, [deny, arms]] of Object.entries(PIPE_FIRST_LISTS)) {
  for (const pos of ["cell", "call argument"]) {
    for (const [sn, sep] of SPELLINGS4) {
      const armsText = (stmt) => arms
        .map(([h, b], i) => `            ${h} :> ${stmt ? `{ @msg = ${b} }` : b}${sep[i]}`).join("\n");
      shapes.push([`legacy-pipe match arms ${ln}, ${pos} (${sn} arms)`, PIPE_PAGE(deny, pos, armsText)]);
    }
  }
}

// S469 r6 (final review of fc046f011, F2) — g-impl1-stmt-match-arm-bare-handled-call-dropped-s469:
// a statement-match arm whose body is a BARE handled call (`1 :> check(p) !{ … }`, no braces) was
// wrapped whole in a guarded-expr no lowering reads — the arm, and with it the password check, was
// silently DROPPED. Here login is optimistic (`@msg = "LOGGED IN"` first) and the check's handler
// rejects, so a dropped arm logs the wrong password in. Measured on fc046f011: the 4 first-arm shapes
// FAIL, the 4 wildcard-arm shapes are refused (E-TYPE-006, the dropped wildcard left the match
// non-exhaustive); all 8 PASS after the fix (the arm compiles as the braced form).
const BARE_HANDLERS = {
  "pipe-less handler arm": `check(p) !{ .Denied :> @msg = "rejected" }`,
  "legacy | handler arm": `check(p) !{ | ::Denied e -> { @msg = "rejected" } }`,
};
const BARE_PAGE = (armLines) => `type AuthErr:enum = { Denied }
<msg> = "init"
<mode>: number | string = 1
<n> = 0
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function login(p) {
        @msg = "LOGGED IN"
        match @mode {
${armLines.map((l) => "            " + l).join("\n")}
        }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;
for (const [hn, h] of Object.entries(BARE_HANDLERS)) {
  for (const [where, build] of [
    ["first arm", (b, s) => [`1 :> ${b}${s}`, `2 :> { @n = 2 }${s}`, `else :> @n = 0${s}`]],
    ["wildcard arm", (b, s) => [`2 :> { @n = 2 }${s}`, `else :> ${b}${s}`]],
  ]) {
    for (const [sn, s] of [["newline", ""], ["comma", ","]]) {
      shapes.push([`bare handled-call statement arm, ${hn}, ${where} (${sn} arms)`, BARE_PAGE(build(h, s))]);
    }
  }
}

// S469 r7 (final review of 6c9f99474, F2) — an engine `derived=match`, lowered from text by
// `rewriteMatchExpr`, whose private arm splitter / parser dropped a literal alternate (`"denied" |
// "locked" :>` lost `"denied"`) and number arms. The access state is derived from the login status,
// default-ALLOW, so a dropped alternate logs the wrong password in. Now read by the one canonical arm
// reader. Measured on 6c9f99474: all 6 shapes FAIL (the wrong password logs in); all 6 PASS after.
const ENGINE_PAGE = (deny, armsText) => `type AuthErr:enum = { Denied }
type Access:enum = { Granted, Rejected }
<st>: number | string = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function login(p) {
        const good = check(p) !{ .Denied :> false }
        @st = good == true ? "ok" : ${deny}
    }
}
<engine for=Access derived=match @st {
${armsText}
}>
  <Granted/>
  <Rejected/>
</>
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${match @access { .Granted :> "LOGGED IN", else :> "rejected" }}</p>
`;
const ENGINE_LISTS = {
  string: [`"denied"`, [`"denied" | "locked" :> .Rejected`, `"init" :> .Rejected`, `_ :> .Granted`]],
  number: ["401", [`401 | 403 :> .Rejected`, `"init" :> .Rejected`, `_ :> .Granted`]],
};
for (const [ln, [deny, arms]] of Object.entries(ENGINE_LISTS)) {
  for (const [sn, f] of [
    ["newline", (a) => a.map((l) => "  " + l).join("\n")],
    ["comma", (a) => a.map((l) => "  " + l + ",").join("\n")],
    ["one-line", (a) => "  " + a.join(", ")],
  ]) {
    shapes.push([`engine derived=match ${ln} alternation deny-list (${sn} arms)`, ENGINE_PAGE(deny, f(arms))]);
  }
}
export default shapes;
