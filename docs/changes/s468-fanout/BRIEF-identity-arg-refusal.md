# unit-id: s468-identity-arg-refusal — ruling S468 (2b): refuse identity passed as an argument to a server function
Policy limb: SECURITY (impl#1). Ruling VERBATIM: /home/bmacs/scrmlMaster/scrml-support/user-voice-scrml.md, last entry
(S468, "(2) = (b) now …"). Gap: g-param-default-identity-via-param-or-mutation-s467 (being raised to HIGH by the parallel
s468-rulings-spec docs unit — do NOT edit that gap's marker yourself; add your resolution note under it only at the end,
and expect a known-gaps merge).
Hole: `<button onclick=add("hi", @session.userId)>` with `function add(name, uid) { ?{INSERT … ${uid} …}.run() }` — the
browser computes `@session.userId` and sends it; any client can send another id. Also CPS-split defaults (the original
gap) and mutating-call routes (`Object.assign`, `.push`, `.set`).
BUILD: a value derived from `@session` / `@currentUser` (directly, through locals/aliases/derived cells/helpers/mutating
calls — REUSE the identity follower #1433 binding-provenance + #1442's carried-local identity check; do NOT write a
fourth walker) that reaches an ARGUMENT position of a call to a server-placed function — from client code or a CPS
browser part — is a compile error whose message names the fix (read `@session` on the server inside the function). Pick
the error code: reuse an existing E-ROUTE-*/E-AUTH-* code only if its §34 row genuinely covers this; else mint one and
add the §34 row + a §12.x/§52 sentence (with `> **Provenance:** ruling:user-voice-scrml.md S468`) — the ruling IS the
governing text.
MEASURE FIRST, before building the refusal fully: the corpus count of session/currentUser-derived arguments to server
functions (examples, samples, conformance/cases, stdlib, /home/bmacs/scrmlMaster/{giti,flogence}). Any REAL (non-fixture,
non-negative-test) site → STOP and report the list (the ruling's condition: real code newly refused returns to bryan).
Cover: direct, aliased, derived cell, helper fn return, template/concat, object/array wrapping, spread, mutation routes,
CPS default, cross-file import, `@currentUser.role`/`.tenant` style fields; NOT refused: reading @session INSIDE the
server function, non-identity data, `@session` used only in the browser. Execute forged requests on base (accepted) and
head (refused at compile). Gates: unit/integration/conformance, security-await-pack classify (0 new FAIL), corpus
differential, pre-commit hook. Push after every commit.
