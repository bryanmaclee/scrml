# unit-id: s468-failable-alias-and-match — FIX ROUND 1 (review of frozen 7ecae57eb: DO-NOT-LAND)
Work ON the existing branch (PR #1444): `git fetch origin s468-failable-alias-and-match && git checkout -B
s468-failable-alias-and-match origin/s468-failable-alias-and-match`; assert HEAD == 7ecae57eb898fb5a6214b0c00cbf1944700ad86c.
(COMMON step 6 overridden.) Read the branch's progress.md first. Policy limb: SECURITY. Reviewer artifacts (read-only):
$HOME/.cache/scrml-agent-tmp/s468-rev-failable/ (h2.mjs client harness, hs.mjs server harness, n1–n8/s1–s2 cases,
work/<tag>N/out emitted code). Reproduce every item first; execute wrong + right password.
The S467 durable lesson applies: position-by-position fixes did not converge on the await P0 (10 rounds) or CPS (5);
both closed only when the rule flipped to "admit only what is provably safe". This branch is showing the same signature.
A. INTRODUCED fail-open — MUST NOT land (match-subject half):
 F1 HIGH: `const ok = match (p == "wrong" ? AuthErr::Denied : check(p)) { .Denied :> false  _ :> true }` (also `.Denied`
   spelling, `match (plainDeny(p) || check(p))`, statement position) — the stamp marks the whole subject failable, the
   lowering treats every non-`__scrml_error` value as "Ok", so a PLAIN enum value skips `.Denied` → LOGGED IN (work/hn80).
 F2 HIGH: inline `match` in an event-handler attribute (`onclick=${ @msg = match (false || check("wrong")) {…} }`) is not
   reached by the stamp → `if (_scrml_match_6 === "Denied")` → LOGGED IN (work/hn31, hn234). Base refused (E-ERROR-002).
 F3 HIGH: statement-position `match (p == "" || check(p)) {…}` in a SERVER function emits `const _scrml_match_3 =
   check(p);` with no await → Promise classified "Ok" → 200 LOGGED IN (work/hs22). Base refused.
 FIX DIRECTION (fork rule: fail-closed wins): every operator-widened match subject that the lowering cannot discriminate
   CORRECTLY at EVERY position (client expr, statement, handler attribute, server statement, server expr, CPS) stays
   REFUSED (E-ERROR-002) exactly as on base. Keep the alias-through-NAME discrimination fixes the review confirmed
   correct (match g(p) via plain/ternary alias, match getF()(p), expression-position in blocks/.map/if/while, markup).
B. The alias half is shape-chasing (dev matched syntax, the gap text claims "by type"). F4 (MED, pre-existing, but the
   marker claims resolved): still LOGGED IN on base AND head — curried returns, `id(check)(p)`, `const g = id(check)`,
   `apply2(getF)(p)`, function-expression IIFE, destructuring default `const { g = check } = {}`, param defaults
   `function t(p, f = check)`, closure write, write-after-use in a loop, passing as a value (`apply(check)`,
   `((f) => f(p))(check)`, `[p].map(check)`/filter/some). ROOT FIX (reviewer's suggestion; you verify): refuse any read
   of a FAILABLE FUNCTION as a value outside callee position and the modelled alias initializers — the analogue of the
   S467 F4 rule (a waiting function is bound only by a `function` declaration). GOVERNING-SENTENCE GATE: find and quote
   the SPEC sentence that makes a failable function used as a value illegal or its result-use E-ERROR-002 (search §19.4,
   §19.4.3, §14.3 / E-VALUE-FUNCTION-STORED, §13.9.6). If none governs → implement A + B-only-what-is-governed, and STOP
   on the root refusal with a written ruling request (options + measured corpus count of failable-fn-as-value reads in
   examples/samples/conformance/stdlib/giti/flogence). Do NOT invent the rule.
 F5 LOW introduced: by-name fixpoint false refusal (nested `function getF(){ return check }` in one fn taints an unrelated
   local `getF` in `login`) — key by binding/scope, not name.
C. FILE as HIGH gaps (pre-existing P0s, do not fix here unless A's fix covers them by construction): the DIRECT forms of
   F2 (`match check("wrong")` in a handler attribute miscompiles on base) and F3 (`match check(p)` statement-position in a
   server fn is unawaited on base) — no known-gaps entry exists for either. Correct the gap-2 "resolved" marker text.
D. Docs: update SPEC §19.4.3's carried-gaps paragraph (compiler/SPEC.md ~:19629) to the truth; finish progress.md (the
   push outcome is unrecorded).
Gates: your tests + the 7 e-error-002/failable suites, unit suite, conformance, security-await-pack classify (0 new FAIL),
corpus differential (0 newly-rejected real sites, or STOP), and ADD F1–F3 + the F4 shapes to the security-await-pack (or a
sibling pack) so the classify gate can see this class. Push after every commit.
