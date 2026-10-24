// Probe family `n26` — S469 (s469-softnav-build-guard): a soft navigation across a BUILD boundary
// (g-soft-nav-cross-build-handler-id-collision-s469, SECURITY). Data, not logic: the default export is a
// list of [name, build-A shell source, { a, b, nav }]. Side: nav (see pack.js `runNavShape`). Do not edit
// a shape to make it pass.
//
// The login, restated for a deploy: build A is the build a tab left open is still running. Its shell has
// ONE privileged control, `#right` (`grant()` → @out = "LOGGED IN"), allocated the first delegated
// handler id of A's compile. Build B (the deploy) drops it from the shell and gives its route a harmless
// `#wrong` button — and, ids restarting per compile, B's `#wrong` carries the SAME
// `data-scrml-bind-onclick` id as A's `#right`. The harness mounts A, soft-navigates (through `nav.via`)
// into B's page, clicks `#wrong` and reads `#out`. Before the S469 fix this LOGGED IN: A's delegated
// listener resolved B's id against A's table and ran `grant()`. The right password is A's own `#right`
// on a fresh document. The harness asserts the collision precondition (or the shape is UNJUDGED).
//
// Measured on cd040ea25 (main 0ff6c93aa + test-only #1511; before the fix): all 5 FAIL — the wrong click
// LOGGED IN (B swapped in, no hard navigation). After the fix: all 5 PASS (hard navigation, nothing applied).
// Shape 6 (review F1, round 2): FAIL on the round-1 head 095c96407 (the ungated chunk was accepted),
// PASS after the admit-count check.

export const SIDE = "nav";

const A_SHELL = () => `<program>
  <out> = "init"
  \${ function grant() { @out = "LOGGED IN" } }
  <button id="right" onclick=grant()>right</button>
  <nav><a href="/reports">Reports</a></nav>
  <p id="out">\${@out}</p>
  <outlet/>
</program>
`;
const A_REPORTS = `<page>
  <h2>A reports</h2>
</page>
`;
const B_SHELL = `<program>
  <nav><a href="/reports">Reports</a></nav>
  <outlet/>
</program>
`;
const B_REPORTS = `<page>
  <n> = 0
  <h2>B reports</h2>
  <button id="wrong" onclick=@n = @n + 1>add row</button>
</page>
`;
const B_REPORTS_FORM = `<page>
  <n> = 0
  <form onsubmit=@n = @n + 1><button id="wrong" type="submit">add row</button></form>
</page>
`;
const A_SHELL_FORM = `<program>
  <out> = "init"
  \${ function grant() { @out = "LOGGED IN" } }
  <form onsubmit=grant()><button id="right" type="submit">right</button></form>
  <nav><a href="/reports">Reports</a></nav>
  <p id="out">\${@out}</p>
  <outlet/>
</program>
`;

const builds = (b = B_REPORTS) => ({
  a: { "pages/reports.scrml": A_REPORTS },
  b: { "app.scrml": B_SHELL, "pages/reports.scrml": b },
});

export default [
  // navigate("/reports") from code — the reviewer's repro.
  ["soft-nav call into another build's route", A_SHELL(), { ...builds(), nav: { via: "call", to: "/reports" } }],
  // A boosted <a href> click (link-boost, §20.8.3).
  ["boosted link into another build's route", A_SHELL(), { ...builds(), nav: { via: "link", to: "/reports" } }],
  // Back/forward into an entry that now serves the new build (popstate, §20.8.5(1)).
  ["popstate into another build's route", A_SHELL(), { ...builds(), nav: { via: "popstate", to: "/reports" } }],
  // A page with NO build identity (a pre-identity build's page): fail closed.
  ["soft-nav into an unstamped page", A_SHELL(), { ...builds(), nav: { via: "call", to: "/reports", strip: true } }],
  // The same collision through the delegated SUBMIT listener.
  ["soft-nav into another build's form (submit)", A_SHELL_FORM, { ...builds(B_REPORTS_FORM), nav: { via: "call", to: "/reports", event: "submit" } }],
  // Review F1 (S469 round 2): A's OWN page (identity matches) but the chunk URL serves an UNGATED
  // chunk — a pre-identity build's bytes (no admit, no ownership check). It never refuses, so the
  // old onload check accepted it; its walker then resolved A's shell ids (a click on A's #right ran
  // grant() AND B's handler). Judge: the soft nav must not complete with an unverified chunk.
  ["ungated chunk under a matching page", A_SHELL(), { ...builds(), nav: { via: "call", to: "/reports", page: "a", ungate: true, judge: "accepted" } }],
];
