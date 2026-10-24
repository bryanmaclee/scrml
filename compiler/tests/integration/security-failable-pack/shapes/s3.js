// Probe family `s3` — S469 r7 (s469-impl1-arm-commas, final review of 6c9f99474, F1): a match in a
// SERVER function lowered from text (`rewriteMatchExpr`) — a reassignment `v = match st { … }` and a
// call argument `String(match st { … })`. Its private arm splitter / parser silently dropped literal
// alternates (`"denied" | "locked" :>` lost `"denied"`) and number / boolean arms, so a deny-list with
// a default-ALLOW arm logged the wrong password in. It now reads arms with the one canonical reader.
// Data, not logic: the default export is a list of [name, scrml source]. Side: server (POST the
// `login` route with p="wrong" / "secret"). Do not edit a shape to make it pass.
//
// Measured on 6c9f99474 (before the fix): the 6 string-alternation shapes FAIL, the 6 number shapes are
// refused (E-CODEGEN-INVALID-LOGIC — valid programs), the mixed ones pass; all 18 PASS after.

export const SIDE = "server";

const PAGE = (deny, pos, armsText) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    server function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    server function login(p) {
        const good = check(p) !{ .Denied :> false }
        const st = good == true ? "ok" : ${deny}
${pos === "reassignment"
    ? `        let v = ""\n        v = match st {\n${armsText}\n        }\n        return v`
    : `        return String(match st {\n${armsText}\n        })`}
    }
    function go() { @msg = login("wrong") !{ _ :> "err" } }
}
<button onclick=go()>go</button>
<p>\${@msg}</p>
`;
const LISTS = {
  string: [`"denied"`, [`"denied" | "locked" :> "rejected"`, `"error" :> "rejected"`, `_ :> "LOGGED IN"`]],
  mixed: [`"denied"`, [`401 | "denied" :> "rejected"`, `"error" :> "rejected"`, `_ :> "LOGGED IN"`]],
  number: ["401", [`401 | 403 :> "rejected"`, `500 :> "rejected"`, `_ :> "LOGGED IN"`]],
};
const SPELLINGS = [["newline", ["", "", ""]], ["comma", [",", ",", ","]], ["mixed", [",", "", ""]]];
const shapes = [];
for (const [ln, [deny, arms]] of Object.entries(LISTS)) {
  for (const pos of ["reassignment", "call argument"]) {
    for (const [sn, sep] of SPELLINGS) {
      const armsText = arms.map((a, i) => `            ${a}${sep[i]}`).join("\n");
      shapes.push([`server ${pos} match, ${ln} alternation deny-list (${sn} arms)`, PAGE(deny, pos, armsText)]);
    }
  }
}
export default shapes;
