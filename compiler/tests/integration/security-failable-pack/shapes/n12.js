// Probe family `n12` — S469 (PR #1444 fix round 1, agent 2): the `!` function is IMPORTED from another
// file (g-imported-failable-function-never-checked). Data, not logic: the default export is a list of
// [name, scrml source, extraFiles?]. Side: client (click #wrong / #right and read #out). Do not edit a
// shape to make it pass.
//
// Measured on 181012c20's parent 5e9981149 (before the fix): `const ok = check(p)` and `match check(p)`
// through an import both compiled and LOGGED IN on a wrong password.

export const SIDE = "client";

const LIB = `\${
    export type AuthErr:enum = { Denied }
    export function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
`;
const MID = `\${
    export { check, AuthErr } from "./lib.scrml"
}
`;
const L = (decl, imp = `import { check, AuthErr } from "./lib.scrml"`) => `<msg> = "init"
\${
    ${imp}
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
const X = { "lib.scrml": LIB };
export default [
  ["imported decl", L("const ok = check(p)"), X],
  ["imported operand", L("const ok = p != \"\" && check(p)"), X],
  ["imported alias", L("const g = check\n        const ok = g(p)"), X],
  ["imported renamed", L("const ok = auth(p)", `import { check as auth, AuthErr } from "./lib.scrml"`), X],
  ["imported re-export", L("const ok = check(p)", `import { check, AuthErr } from "./mid.scrml"`), { ...X, "mid.scrml": MID }],
  ["imported match", L("const ok = match check(p)" + M), X],
  ["imported match renamed", L("const ok = match auth(p)" + M, `import { check as auth, AuthErr } from "./lib.scrml"`), X],
  ["imported match enum not imported", L("const ok = match check(p)" + M, `import { check } from "./lib.scrml"`), X],
  ["imported guard", L("const ok = check(p) !{ .Denied :> false }"), X],
  ["imported guard enum not imported", L("const ok = check(p) !{ _ :> false }", `import { check } from "./lib.scrml"`), X],
];
