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

const GAP = "g-imported-async-server-fn-not-awaited-s465";

export const KNOWN_FAIL = {
  // r7 — a module-level binding whose lambda body calls an async helper, called through a second binding
  "m2/topBindingAwaitedInBinding": GAP,
  // r7 — `!` over a binding that calls a binding
  "m3/bindNotBinding": GAP,
  "m3/libBindChainNot": GAP,
  // r7 — an annotated `export const` lambda
  "m4/appExportConstAnn": GAP,
  "m4/libExportConstAnnInner": GAP,
  // r8 — a binding calling a `let` binding; export paths (ternary, imported value, binding-of-binding, curried)
  "m5/bindCallsLetBinding": GAP,
  "m5/libExportTernaryFn": GAP,
  "m5/libExportImportedValue": GAP,
  "m5/libExportBindingOfBinding": GAP,
  "m5/libExportCurried": GAP,
};

// Shapes this server-route instrument CANNOT judge: they compile, but `f` is not a server route
// (it is a client function that calls a server helper), so the wrong-password decision happens
// in the client bundle. Listed so the hole is named; a NEW unjudged shape turns the pack red.
// Judging these needs the client half run (the conformance `serverDb` mode — see README.md).
export const UNJUDGED = {
  "s12/nestedServerCall": "f is a client fn: `inner(name, pass) ? \"WELCOME\" : \"REJECTED\"` runs in the client (§13.7 value-position server call)",
};
