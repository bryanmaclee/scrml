// Shapes that ACCEPT A WRONG PASSWORD on main today. Each entry names the open gap it is owed to.
//
// The pack is green with these failing and goes RED when:
//   - a shape NOT listed here answers a wrong password WELCOME (a new hole), or
//   - a listed shape stops answering WELCOME (it was fixed: delete its entry; if the gap has
//     no listed shapes left, the gap's own status is the PA's to change).
//
// Refresh with `bun compiler/tests/integration/security-await-pack/classify.js` — never by
// hand-editing to make the suite pass.
//
// Measured on main 7c8e8f99a (S466): 10 shapes. The dpa-023 scoping DD recorded 9 on c57ac1aea;
// it missed m2/topBindingAwaitedInBinding, which the reviewers' own r7 and r8 BASE runs also show
// accepting a wrong password.

// S467 fix round 9: all ten close (the parsed-init classifier in codegen/fn-valued-bindings.ts —
// the r8 binding rule and the r9 escape rule). Measured on s467-await-r9: 0 shapes accept a wrong
// password. The map stays so a regression has a place to be named.
// S467 fix round 10 (dpa-023 F4, §13.9.6): + families y1–y3 (the S467 review of r9, which found
// four y3 shapes and y1/voIife, y2/voIife, y2/voAnnotIife, y1/topLetIfWrite, y2/topLetIfLit
// answering WELCOME on r9). Measured on s467-await-r10: 551 shapes, 0 accept a wrong password.
// + families z1–z4 (the S467 review of r10; 640 shapes): 0 accept a wrong password.
// S468 + family la1 (literal / alternation match arms; 695 shapes): 29 la1 shapes accept a wrong
// password on main bbddfd7b9 and none on s468-literal-arm-block-p0 (the parser reads those arms'
// bodies) — they land together, so no la1 entry is listed here.
export const KNOWN_FAIL = {
};

// Shapes this server-route instrument CANNOT judge: they compile, but `f` is not a server route
// (it is a client function that calls a server helper), so the wrong-password decision happens
// in the client bundle. Listed so the hole is named; a NEW unjudged shape turns the pack red.
// Judging these needs the client half run (the conformance `serverDb` mode — see README.md).
export const UNJUDGED = {
  "s12/nestedServerCall": "f is a client fn: `inner(name, pass) ? \"WELCOME\" : \"REJECTED\"` runs in the client (§13.7 value-position server call)",
};
