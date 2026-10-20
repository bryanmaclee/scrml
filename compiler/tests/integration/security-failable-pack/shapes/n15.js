// Probe family `n15` — S469 (the #1444 review, LOW + MEDIUM): a failable function reaching a call
// through an OBJECT SHORTHAND (`{ check }`, `{ g }`) or through an EXPORTED `const` alias
// (`export const g = check`, re-exported, `export *`) — the importer has no alias facts for `g`, so its
// call was never checked. Data, not logic: the default export is a list of [name, scrml source,
// extraFiles?]. Side: client (click #wrong / #right, read #out). Do not edit a shape to make it pass.

export const SIDE = "client";

const L = (decl, top = "") => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    const g = check
${top}
    function login(p) {
        ${decl}
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;

const LIB = (alias) => `\${
    export type AuthErr:enum = { Denied }
    export function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    ${alias}
}
`;
const MID = `\${
    export { g, AuthErr } from "./lib.scrml"
}
`;
const STAR = `\${
    export * from "./lib.scrml"
}
`;
const IMP = (from) => `<msg> = "init"
\${
    import { g, AuthErr } from "${from}"
    function login(p) {
        const ok = g(p)
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;

export default [
  ["shorthand check", L("const o = { check }\n        const ok = o.check(p)")],
  ["shorthand alias", L("const o = { g }\n        const ok = o.g(p)")],
  ["shorthand check in a tape", L("const fs = [{ check }]\n        const ok = fs[0].check(p)")],
  ["export const alias", IMP("./lib.scrml"), { "lib.scrml": LIB("export const g = check") }],
  ["braced export of a const alias", IMP("./lib.scrml"), { "lib.scrml": LIB("const g = check\n    export { g }") }],
  ["re-exported const alias", IMP("./mid.scrml"), { "lib.scrml": LIB("export const g = check"), "mid.scrml": MID }],
  ["export * of a const alias", IMP("./star.scrml"), { "lib.scrml": LIB("export const g = check"), "star.scrml": STAR }],
];
