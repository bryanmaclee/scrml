# progress — arc A (protect / Response egress surface)

Append-only. Timestamps UTC.

## 2026-09-07T13:00Z — startup verification
- WORKTREE_ROOT: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a05746d61b7f75dab
- `git rev-parse --show-toplevel` == WORKTREE_ROOT: OK
- `git status --short`: clean
- `git merge-base HEAD origin/main` == `origin/main` == `HEAD` == `8fa6854d749ba66469650a62c0799bf0eaabf396`: OK
- `bun install`: 218 packages
- `bun run pretest` from worktree CWD: exit 0, `samples/compilation-tests/dist/` populated (13 samples, artifacts verified by `ls`)

## 2026-09-07T13:06Z — BASE FAILURE SET CAPTURED BEFORE ANY EDIT
- `bun run test` at `8fa6854d`: **31131 pass / 214 skip / 11 todo / 56 fail** over 1451 files (433.9s)
- unique `(fail)` lines: **56**, recorded verbatim in `arc-a-base-fails.txt` (sorted, `[Nms]` suffix stripped)
- brief predicted "~63"; measured 56 by line-count of unique `(fail)` records. Composition matches the
  brief's description: browser/happy-dom fixture reds (Transition directives, TodoMVC dist,
  engine-gated-each, navigate-wave1c) + `commands/` dev-watcher order-dependent flakes.
- NOTE: the pre-commit gate is NARROWER than `bun run test` — it runs
  `unit + integration + conformance + compiler/tests/*.test.js` only, excluding `browser/` and
  `commands/`. All 56 base failures live in the excluded tiers, so the GATE is green at base
  while the full suite is not.

## 2026-09-07T13:40Z — ALL FOUR DEFECTS REPRODUCED BY EXECUTION (before any edit)

Reproducers committed under `repro-arc-a/`. Compiled with `bun run compiler/src/cli.js compile`,
then the EMITTED handler was executed against a real `Request` (`exec-a1.mjs` shape).

- **A1 — CONFIRMED, by wire.** `a1-baseline-csrf-403.scrml`: a `server fn` returning
  `new Response("forbidden", {status:403, headers:{"Content-Type":"text/plain"}})` compiled at
  exit 0 with NO diagnostic; executing the emitted handler with a valid double-submit CSRF pair
  returned **`status=200 / Content-Type=application/json / body="{}"`**.
  The identical body under `<program auth="required">` emits `if (_scrml_result instanceof Response)
  return _scrml_result;` (the `:4509` guard) and returns 403/text-plain. Differential is exact.
- **A3 — CONFIRMED, by differential.** `a3-control-same-body.scrml` (query + `new Response` in ONE
  body) → `E-PROTECT-004`, FAILED. Moving the query into a helper (`a3-extraction-defeats-regex`,
  plain `function` form) → **compiles clean, exit 0**. Ordinary function extraction defeats the gate.
- **A4 — CONFIRMED (was RELAYED; now PA-reproduced here).** `a4-reveal-wrong-column.scrml`:
  `protect="passwordHash"`, body does `u.reveal("email")` + `new Response(JSON.stringify(...))`.
  `E-PROTECT-004` is **suppressed**, exit 0. Emitted server line 210 is
  `return new Response(JSON.stringify(_scrml_protect_reveal(u, "email")))` — `JSON.stringify`
  ignores the Symbol descriptor, the top-level `instanceof Response` passthrough returns the
  Response before `_scrml_protect_redact` ever runs, so `passwordHash` ships on the wire.
  The suppression at `protect-egress.ts` was `/\.\s*reveal\s*\(/` — EXISTENCE-keyed, exactly as
  relayed.
- **A5 — CONFIRMED by reading + by the A4 emitted output.** `_scrml_protect_redact` line 1 of the
  object branch was `if (... value instanceof Response) return value;` — fail-open.

## 2026-09-07T13:40Z — LOCI: held / refined / wrong

| brief locus | verdict |
| --- | --- |
| `useBaselineCsrf` @ `emit-server.ts:3804` | **HELD** exactly (verified by symbol grep). |
| the one server-fn-result guard @ `:4509` | **HELD** exactly. |
| "the other four `instanceof Response` hits are `handle()` middleware" | **HELD** — `:3230` (§40.3.2 `resolve()` normalizer), `:3270`, `:3274`, `:3283`, all inside the `_scrml_mw_*` IIFE. Not touched. |
| `protect-egress.ts` at `compiler/src/codegen/` | **HELD** (the dPA's path omitting `codegen/` was already corrected in the brief). |
| `<endpoint>` arm envelope | **REFINED** — `emitEndpointArmEnvelope` @ `:4684`, sink at `:4735`. |

## 2026-09-07T14:20Z — A3: THE CHOICE, AND WHY IT IS NEITHER OF THE TWO OFFERED

The brief offered: promote the regex to an AST walk on the `egress-field-scan.ts`
template, OR delete it and let A2's diagnostic carry the protected path.

**Chosen: DELETE the `Response` limb. But the dichotomy has a false premise worth naming,
because taking either branch at face value leaves the guarantee unowned.**

An AST walk is still a SYNTACTIC predicate. It fixes token recognition (a `Response` inside
a string literal or a comment) — real, and I did use acorn for exactly that in A2 — but token
recognition was never the hole. The measured defeat was INTER-PROCEDURAL: the query in a
helper, the egress in the caller. An AST walk over one body sees one body. And even a perfect
syntactic scan cannot see `const R = Response; new R()`, `await fetch(...)`, `.clone()`, or a
callee outside the slice. So "promote to an AST walk" is the SAME unbounded-completeness
mistake wearing a better parser — one more spelling, forever, with no done-condition.

And "delete it, A2 carries it" is only half right, because **A2 is also syntactic**. If A2 were
the whole answer, the guarantee would still rest on a spelling list.

So the arc lands THREE limbs with three explicitly different strengths, and the SPEC now says
so normatively (§14.8.9, S405 amendment):

  1. `E-PROTECT-004` — a per-body source-text co-occurrence LINT over `_{}` and `asIs`, and
     labelled as a lint at every site. It bounds the DERIVED-FLOW boundary §14.8.9 already
     excludes from its soundness claim, so its incompleteness is disclosed, not new.
  2. `E-PROTECT-005` — a HARD compile error raised STRUCTURALLY at emission, where the compiler
     is about to wrap an author value in an envelope it cannot mediate. Not a source scan:
     it keys on the `Response` construction in whichever body builds it, so EXTRACTION MOVES
     THE TRIGGER RATHER THAN ESCAPING IT (verified: `a3-extraction-server-side.scrml`).
  3. **The RUNTIME refusal — the guarantee.** `instanceof Response` is an exact test on the
     actual value at the actual sink. No spelling problem, no extraction hole, no aliasing
     hole. Verified against the aliased-constructor residue A2 cannot see.

The `_{}` and `asIs` limbs are KEPT, not deleted: the brief's A3 done-condition is scoped to
`Response`, deleting them would be unauthorized scope expansion, and they retain a (weak,
now honestly-labelled) signal. Keeping them also forced the level-family finding below —
which, had I deleted them, would have shipped as a silent hole in `tenant-egress.ts` alone.

## 2026-09-07T14:20Z — OUT-OF-BRIEF DEFECT FOUND AND CLOSED

The `_{}` limb I chose to KEEP did not fire on the syntax §23 recommends. Its predicate was
`/(^|[^A-Za-z0-9_$])_\{/` — LEVEL 0 ONLY. SPEC §23.2 normative: "`_` followed by ZERO OR MORE
`=` followed by `{`", and `W-FOREIGN-001` fires on a level-0 `_{` recommending `_={}=`.
**So the security limb recognized exactly the one spelling the compiler steers authors away
from.** REPRODUCED at `8fa6854d`: `let w = _={ JSON.stringify(v) }=` in a `protect=` body
compiled at exit 0, no diagnostic, and shipped `passwordHash` in full (the foreign block
returns a plain string, which carries no descriptor, so the sink redact is a no-op on it).

Fixed to `_=*\{` — which is `ast-builder.js:18392`'s ALREADY-CORRECT pattern, not an invention.
WARNING: `compiler/src/codegen/tenant-egress.ts:389` carries the BYTE-IDENTICAL bug. It is
arc B's file. NOT TOUCHED. Surfaced to PA.

Had I deleted the `_{}` limb per a literal reading of A3, this defect would have been deleted
along with the code that exposed it, and its tenant twin would still be live and unfound.

## 2026-09-07T14:20Z — THE ADVERSARIAL PASS: THE POPULATION, AND WHY IT IS COMPLETE

The population is NOT a list of members. It is: **every site where an AUTHOR-authored value
can reach a compiler-emitted client egress on a `protect=`-active path.** It is enumerable
mechanically because the floor funnels through named artifacts, and completeness is provable
THREE independent ways that must agree:

  (a) **By the redaction primitive.** `_scrml_protect_redact` is the SOLE protect-redaction
      primitive and it ships from ONE string (`SERVER_PROTECT_HELPER`). Any sink that does not
      call it never had protect applied at all. So the A5 runtime change covers 100% of the
      population with one edit and NO enumeration risk. Measured emission sites:
      `_egressRedact` (8) + direct emissions (4: `emit-channel.ts:1078` channel broadcast,
      `emit-server.ts:2223` broadcast injection, `:3848`/`:3851` SSE) = 12.
  (b) **By SPEC's own normative list.** §14.8.9 names the egress boundaries: server-function
      return, SSR `/__serverLoad`, channel `broadcast()` (§38), `server function*` SSE (§37) —
      plus §61 `<endpoint>`. That list and (a) agree; neither contains a member the other lacks.
  (c) **By the short-circuit.** The ONLY way a value skips the redact is an `instanceof Response`
      passthrough ahead of it. `grep -c 'instanceof Response'` in `emit-server.ts` = 8 lines,
      of which 2 are the single shared emitter `_opaqueResultGuard`, 4 are the `handle()`
      middleware (`_scrml_mw_*`, out of this surface by construction -- SPEC 40.3.5's blessed
      Response lives there), and 2 are prose. **Before this change the server-fn egress path had
      TWO independent passthrough decisions and only one of them was written; now there is ONE
      emitter with two branches** -- the invariant-69 lesson (make both branches consult the same
      artifact) applied.

Filtering (a) by "can an AUTHOR `Response` reach it": the 3 sinks fed by an author value
(baseline-CSRF, non-CSRF, `<endpoint>`) get the GUARD; the 5 author-body lowering sites
(those 3 + SSE + peer-callable) get the E-PROTECT-005 GATE. `serverLoad`/SSR-seed sinks
(`_scrml_rows`/`_scrml_result`/`_scrml_cv`) are compiler-built SQL values -- verified by
reading each emission -- and correctly get neither. The peer callable gets the gate but NOT a
guard, because its return flows into a caller's guarded `_scrml_result`; a peer callable is
not an HTTP handler and has no Response slot.

### What the pass FOUND -- two bugs in my own change, both after a fully-green suite

1. **BUILD-BREAKING FALSE POSITIVE.** The gate scans a SLICE of lowered JS. On the
   baseline-CSRF arm the window opened at the capture IIFE -- and the compiler emits its OWN
   `new Response(...)` inside it (SPEC 53.9.4 `E-CONTRACT-001-RT`, `emit-predicates.ts:250`).
   EVERY `protect=` app with a predicated server-fn parameter failed its build on the
   compiler's own code. REPRODUCED on `auth="none"` + `protect=` + `id: number(>0 && <10000)`.
   Window moved after the preamble. The non-CSRF arm was already clean for a DIFFERENT reason
   (its param check is emitted at handler scope, above the IIFE) -- stated in-source so the two
   are not later "harmonized" into one wrong shape.
2. **SILENTLY DEAD LIMB.** The scan wrapped its slice in `async function` (for top-level
   await/return). A SPEC-37 `server function*` body has a top-level `yield`, which does not parse
   in a non-generator, so acorn threw, my own documented fail-open-on-parse-error path returned
   "no fire", and `yield new Response(...)` under `protect=` compiled clean. Wrapper is now
   `async function*`. **My fail-open decision cost a real detection within the hour** -- which
   is the argument for keeping limb 3 as the guarantee, not an argument for the wrapper.

Both are pinned by regression PAIRS that fail in exactly one direction, so a future regression
in either direction reddens exactly one test.

### The rest of the adversarial scope, each verified by compiling
- SPEC 40.3.5's blessed `handle()` `new Response("Forbidden",{status:403})` under `protect=`
  -> does NOT fire; premise pinned BOTH ways (the middleware Response reached the emit AND
  `_scrml_protect_tag` is present, so protect really is active).
- `<endpoint>` JSON envelope: the non-Response arm still returns `200/application/json`
  (executed over a real Request); the Response arm fires and NAMES the arm + endpoint + spelling.
- a `protect=` scope with no `Response` at all -> compiles.
- a `Response` from a plain non-protected server fn -> passes through (403/text-plain on the wire).
- the COMPLETE WHATWG `Response` producer surface -- `new Response` + the three statics
  `json`/`redirect`/`error` + their computed spellings -- enumerated FROM THE STANDARD, not from
  a corpus survey. What is NOT recognized (aliasing, `fetch`, `.clone()`, a callee outside the
  slice) is stated in-source as a permanent boundary, not a TODO.
- the SPEC-23.2 foreign-opener FAMILY at levels 0/1/2/3, plus `foo_{` not firing.

## 2026-09-07T14:20Z — VERIFICATION

- **Pre-commit gate scope** (`unit + integration + conformance + compiler/tests/*.test.js`):
  **29,796 pass / 84 skip / 10 todo / 0 fail.** (Base: 29,752 pass / 0 fail.)
- **Full `bun run test`**: 31,186 pass / 214 skip / 11 todo / **54 fail**.
  `comm -13 base-fails.txt after-fails.txt` -> **EMPTY. Zero new failures.**
  Base was 56; two TodoMVC "dist not compiled" failures went away because the corpus
  differential capture compiled `benchmarks/todomvc/` as a side effect -- an ENVIRONMENT
  artifact of my own probing, NOT a fix. Called out so it is not read as one.
- **`bun scripts/corpus-compile-floor.ts`** -> PASS, exit 0, 37 showcase programs, 1 tracked
  baselined failure (`examples/09-error-handling.scrml`, pre-existing, unrelated).
- **R26 empirical recompile** (`corpus-emit-differential`, base = these two source files at
  `87eaf24a`, head = now): **1,923 sources / 7,442 artifacts**.
  - 0 newly failing / 0 newly passing compiles
  - 0 syntax delta (effective / script / module), 0 load-context changes
  - 0 bare server-fn call-site delta
  - 3 diagnostic-code changes -- **all three are my own conformance cases**, no corpus source
  - 218 artifact content diffs, **ALL 218 matched by recorded SHA and classified, 0 unexplained**:
      - **161** gained the A1 passthrough guard (the 403 fix; non-protect apps)
      - **53** gained the A5 refusal guard + refusal helper (protect-active apps)
      - **4** gained the helper block only (protect apps with no guard site)
    WARNING: the FIRST classification pass reported "176 of 218" and silently `continue`d on 42
    ambiguous (key, byteLength) matches. That is the truncated-probe shape -- a well-formed
    number over a subset -- so it was redone matching on the manifest's recorded SHA, with
    `matched + unmatched == 218` asserted. Recording the bad pass, not just the good one.
- **types-gate**: 12 NEW diagnostics -- **PRE-EXISTING**. Verified by reverting both my files to
  pristine HEAD and re-running: identical 12, none in `emit-server.ts` or `protect-egress.ts`
  (they are `TS7016` on `ast-if-chain.js` / `schema-differ.js` / `markup-return-scan.js`, plus
  two `TS7006` in `emit-each.ts` and one `TS2352` in `route-inference.ts`). Not mine; surfaced.

## 2026-09-07T14:20Z — DEFERRED / SURFACED TO PA (not closed here)

1. **`compiler/src/codegen/tenant-egress.ts:389` carries the byte-identical level-0-only
   foreign-opener bug** (`/(^|[^A-Za-z0-9_$])_\{/`). ARC B'S FILE -- not touched. One-line fix,
   same as mine: `_=*\{`.
2. **The tenant-side twin of the A5 fail-open is still open by design.** A tenant-active,
   protect-INACTIVE app still gets the plain passthrough at the sink, i.e. the same fail-open
   it has today. The brief said "the tenant-side twin is arc B's -- leave it", so
   `_opaqueResultGuard` branches on `_protectActive` ALONE and the tenant axis has ZERO delta.
   Stated in-source at the guard.
3. **E-PROTECT-005 does not cover the channel `broadcast()` sink statically.** A
   `broadcast(someResponse)` in a `protect=` app is caught at RUNTIME by the redact refusal
   (`emit-server.ts:2223` feeds `_scrml_protect_redact`), but there is no compile-time gate,
   because the broadcast argument is an expression at an injection site rather than a scanned
   author-body slice. Runtime-covered, statically uncovered; not widened here.
4. **The 12 pre-existing `types-gate` diagnostics** are a standing red the gate reports as "a
   regression" on every run. Not mine, not in scope, but it means the gate currently cannot
   detect a NEW TS regression by exit code.

# ============================================================================
# S239 FIX ROUND — two HIGHs, one MEDIUM, two LOWs. Both HIGHs re-reproduced by
# me before any edit; the reviewer's construction is one instance, not a set.
# ============================================================================

## 2026-09-07T15:10Z — HIGH 1 reproduced, and then reproduced AGAIN one level down

- **Compile half, exactly as reported.** `protect="passwordHash"`, server fn does
  `SELECT id, name` (the protected column projected OUT) then
  `Response.redirect("/home", 302)`. **base: 0 errors. My tip: E-PROTECT-005.**
- ⚑ **RUNTIME half — MINE, found by following through.** Dropping `redirect`/`error`
  from the gate made the build pass, and the emitted handler then read
  `if (_scrml_result instanceof Response) return _scrml_protect_opaque_refusal();`
  — a **500 instead of a 302**. Fixing only the compile gate would have moved the
  break from build time to REQUEST time, which is strictly worse than the defect
  it replaced.
- **Then I measured whether a runtime discriminator exists. IT DOES NOT.** Bun 1.3.14:

  | construction | `.body === null` | bytes | headers |
  | --- | --- | --- | --- |
  | `new Response()` / `new Response(null, ...)` | **true** | 0 | - |
  | `Response.redirect(url, 302)` | false (ReadableStream) | 0 | `location` |
  | `Response.error()` | false (ReadableStream) | 0 | - |
  | `new Response("s3cret", {status:302, headers:{Location}})` | false | 6 | `location` |

  The last row is the ADVERSARY and it settles the design: a secret-carrying
  response presents identically to a redirect at every non-destructive property,
  and measuring length means consuming (destroying) the stream. **So no runtime
  heuristic is admissible, and `.body === null` is the only sound test.**

**Resolution - three coordinated changes; the unit shifts from `Response` to BODY:**
1. the gate keys on `RESPONSE_BODY_CARRYING_PRODUCERS` (`new Response(<body>,...)`,
   `Response.json`), plus `isProvablyNullBodyResponse` for `new Response()` /
   `new Response(null,...)`;
2. the runtime guard passes `.body === null` and refuses everything else -
   EXECUTED over the whole population: the resolution returns **302 + Location**,
   204 returns 204, and the ADVERSARY still gets a **500 with no leak**;
3. the residual seam - `Response.redirect` / `Response.error`, provable
   payload-free at compile time and invisible at runtime - is a NEW
   **`W-PROTECT-005`** naming the exact rewrite, because permitting them silently
   would swap a loud build error for a silent 500.

The contract is now one sentence: **a `protect=` app keeps full control of STATUS
and HEADERS and gives up authoring the BODY.** The named resolution
(`new Response(not, { status: 302, headers: { Location: "/home" } })`) is COMPILED
in a test and a conformance case - `not` lowers to a JS `null` body.

**APP-SCOPED vs QUERY-SCOPED - decided, and stated either way as asked: KEPT
APP-SCOPED, deliberately.** Query-scoping makes it a per-body co-occurrence test,
which is exactly the mechanism A3 deleted; moving the query one function away
defeats it (measured in the first round). Immunity to extraction is bought by
keying on the CONSTRUCTION alone. That is now said in the diagnostic itself, in
the in-source comment, and in the §34 row, so an adopter who hits it on a
function that touches no protected table knows it is scope-based by design.

## 2026-09-07T15:10Z — HIGH 2 reproduced end-to-end, and WHAT THE THREE PROOFS SHARED

Reproduced by executing the emitted handler: `POST /__mountHydrate` returned
`{"userCell":[{"id":1,"name":"ada","passwordHash":"s3cret"}], ...}` while the SSR
compose handler forty lines below redacted THE SAME TWO VALUES to
`[{"id":1,"name":"ada"}]`. Both arms (all-public and per-cell auth-gated) now
redact; re-executed post-fix, the secret is gone.

**THE ANSWER TO THE QUESTION — what the three proofs shared that let them agree
on an incomplete set:**

> **All three enumerated over the MECHANISM; the obligation is over the DATA.**

  - proof (a) walked `_scrml_protect_redact`'s CALL SITES — i.e. "where the floor
    already acts". That is the same set as "where the floor MUST act" *only if the
    code is already correct*. **The proof assumed its conclusion.**
  - proof (b) took SPEC §14.8.9's Composition list as closed. It is a list of the
    boundaries someone THOUGHT OF; `/__mountHydrate` is §8.11, a different section
    written independently. Rule 4 makes SPEC normative on *what the rule is*, not
    on *whether an enumeration inside it is exhaustive*.
  - proof (c) enumerated ways to BYPASS a redact. `/__mountHydrate` bypasses
    nothing — it never had one. A short-circuit proof is blind to a sink with no
    circuit.

**A sink that never adopted the mechanism is outside all three frames AT ONCE. So
their agreement was one blind spot counted three times — it was never
independence.** Three proofs drawn on the same axis do not corroborate each other;
that is the transferable part, and it is the same shape as the day's other two
instances (four tokens where the helper knew five; tokens x locations where the
axis was scan sites).

**The correct axis is the SERIALIZER**, and I re-derived the population that way:
every runtime `JSON.stringify` the server emitters can produce (distinguishing
compile-time interpolation from emitted text by `${}` depth) — **25 in
`emit-server.ts`, 5 in `emit-channel.ts`** — each classified by hand against the
emitter. Result: 15 flagged raw; of those, `/__mountHydrate` x2 arms is the ONLY
real gap. The rest are compiler-owned envelopes (the `_body` session projection,
the access log), SQL-built values on gated `else` branches (`serverLoad`, SSR
seed), or the §38.6.1 WS relay that §14.8.9 explicitly excludes.

⚠ **A CORPUS SWEEP WOULD NOT HAVE FOUND IT, AND I RAN ONE FIRST.** Sweeping the
57 protect-active artifacts among 7,442 returned 3 shapes, none of them this —
because the corpus contained **no protect-active app with a mount-hydrate path**.
Corpus-zero is blast radius, not absence. That shape is now IN the corpus
(`conformance/cases/protect/mounthydrate-redacts`).

## 2026-09-07T15:10Z — MEDIUM 3 / LOW 4 / LOW 5

- **MEDIUM 3 — confirmed by reading the emitter: the SSE `catch` is EMPTY.** So the
  refusal ended the stream with a 200, no frame, no log, indistinguishable from
  normal completion — and my own comment claimed the opposite. The refusal error
  is now **TAGGED** (`__scrml_protect_opaque`, structural, never a message match)
  and the stream emits a terminal `event: error` frame plus a `console.error`.
  Emitted only when protect is active; non-protect SSE apps byte-unchanged.
- **LOW 4 — fixed; the ROLLBACK can no longer replace the error it cleans up after.**
  ⚑ **Pinned against the EMITTER SOURCE, not a compiled program, and the reason is
  itself a finding: the §8.9.2 implicit transaction envelope emits in 0 of 7,442
  corpus artifacts,** and several constructed shapes (multi-statement handlers,
  `!`-failable handlers with two SELECTs) failed to reach it. A compile-level test
  would have early-returned and asserted nothing — the hollow-green shape.
- **LOW 5 — the message now names the ALIAS-RESOLVED columns.** Verified:
  `SELECT id, passwordHash AS h` produces ``declassify `reveal("h")` ``, not
  `reveal("passwordHash")`. Dead `dynamic` return removed.

**Also fixed, found by the gate:** `responseGuardedReturns` in the emission-shape
suite walked ONE level and reported the new two-level guard's inner
`return _scrml_result` as a bare exit. A recognizer shallower than the code it
recognizes reports defects that are not there — and would miss ones that are.
Made recursive over the narrowed arm.

## 2026-09-07T15:10Z — MY OWN PROCESS FAILURE THIS ROUND

To prove the new conformance cases go red against the reviewed tip I ran
`git checkout HEAD -- <the two source files>` — **without copying them aside
first**, which I HAD done for the identical probe in the first round. It
destroyed every fix-round source edit and I redid all of them from context.
Nothing was lost permanently (the edits were still in context and the tests
caught the gaps), but the discipline is: **a revert-to-compare is a destructive
operation and gets the same copy-aside treatment as a crash risk.** Recorded
because the near-miss is the useful part.

## 2026-09-07T15:10Z — FIX-ROUND VERIFICATION

- Pre-commit gate scope: **29,817 pass / 84 skip / 10 todo / 0 fail.**
- Full `bun run test`: 31,207 pass / 214 skip / 11 todo / 54 fail.
  **`comm -13 base-fails.txt after2-fails.txt` -> EMPTY. Zero new failures.**
- `corpus-compile-floor` -> PASS, exit 0, 37 programs, 1 tracked pre-existing baseline.
- **R26 re-run with the assertion INTACT** (base = the two source files at
  `87eaf24a`; head = the fix round): 1,926 sources / 7,457 artifacts.
  - **`matched 218 + unmatched 0 = 218 (total 218) -> HOLDS`**
  - **INTENDED-ONLY: 218 of 218. UNEXPLAINED: 0.** Shapes:
    161 A1-passthrough · 53 A5-refusal+helper+SSE-observable · 4 helper+SSE-observable
  - 0 newly failing / 0 newly passing compiles · 0 EFFECTIVE syntax delta ·
    0 load-context changes · 3 diagnostic changes, all three my own conformance cases
  - ⚠ Three figures MOVED and each was chased rather than accepted: `source set
    delta 3` = exactly my three new conformance cases (`onlyA` is EMPTY);
    `syntax delta (script) 3 new` = those same three `.server.js` under the SCRIPT
    goggle, which EVERY `.server.js` in the corpus fails identically (the
    effective-goggle delta is 0); `bare server-fn sites +2 in 0 sources` = the new
    sources' own call sites, `changedSources` empty.
  - ⚠ The classifier itself needed two gap-closures before reaching 218/218 (the
    interior lines of my own refusal helper, and a bare `try {`). Both verified
    against the emitter as mine. Recording that the classifier was wrong twice
    before it was right, because "0 unexplained" is worth nothing without the path.
- New conformance cases, proven RED against the reviewed tip `8ca2e38b`:
  `w-protect-005-null-body-static` (MISSING W-PROTECT-005 + FORBIDDEN E-PROTECT-005
  fired) and `null-body-response-clean` (FORBIDDEN E-PROTECT-005 fired).
  ⚠ `mounthydrate-redacts` **passes on both sides** — the defect was a SILENT data
  leak, so a codes-half case has no discriminating power over it. Its value is
  corpus PRESENCE; the executable proof is the integration test that lifts the
  emitted handler. Said in the case's own rationale so it is not mistaken for a
  regression test.

## 2026-09-07T15:10Z — DEFERRED / SURFACED (fix round)

1. **`tenant-egress.ts:389`** — byte-identical level-0-only `_{}` opener bug. ARC B'S
   FILE, untouched. One-line fix: `_=*\{`.
2. **The tenant twin of the A5 refusal is still open by design.** `_opaqueResultGuard`
   branches on `_protectActive` ALONE; a tenant-active protect-INACTIVE app keeps
   today's passthrough. Zero tenant delta, per the brief.
3. **`/__mountHydrate` now applies `_egressRedact`, which includes the TENANT redact.**
   That is the standard sink treatment every other client-egress sink in the file
   uses, applied to a sink that previously had none — not a redesign of the tenant
   floor. Flagged for arc B because it touches their axis.
4. **The §8.9.2 implicit transaction envelope emits in 0 of 7,442 corpus artifacts.**
   A normative construct with no reachable instance. Bigger than this arc.
5. **`E-PROTECT-005` does not cover the channel `broadcast()` sink statically** —
   runtime-covered by the redact refusal; the broadcast argument is an
   injection-site expression, not a scanned author-body slice.
6. **12 pre-existing `types-gate` diagnostics** (verified by reverting to pristine
   HEAD). The gate reports "regression" on every run, so it cannot currently detect
   a NEW TS regression by exit code.

# ============================================================================
# S239 FINAL ROUND — no HIGHs. One MEDIUM whose ROOT I had already patched once,
# one duplicate-diagnostic LOW, and the two cheap cleanups.
# ============================================================================

## 2026-09-07T16:20Z — FINDING 1: the probe wrapper's grammar was never derived

Reproduced two ways before touching anything — by calling the exported function,
and end-to-end:

```
{ ok: true, r: Response.json({a:1}) }   -> null   MISSED
{ ok: true, r: new Response("s3cret") } -> null   MISSED
{ r: new Response("s3cret") }           -> detected  (single key parses as a label)
```
and a real `<endpoint>` whose `<Deny>` arm was
`{ jsonrpc: "2.0", result: Response.json({...}, {status:403}) }` under `protect=`
**compiled clean**.

⚑ **THE ROOT, AND WHY IT IS WORTH MORE THAN THE PATCH.** Last round the wrapper was
`async function`, an SSE `yield` failed to parse, and I added `*`. That was a
SYMPTOM fix. One round later the SAME root produced a different hole: an
`<endpoint>` arm's EXPRESSION framed as a STATEMENT, where a multi-key object
literal is a labeled block and throws. **"Widen the wrapper when a shape breaks"
has no done-condition — it is the unbounded-completeness mistake this whole arc
exists to refuse, wearing a parser.** And the second hole was worse than the
first because it LOOKED like coverage: single-key arms happened to parse as
labels and did fire.

**Structural repair: the scanner stops guessing.** `findAuthoredResponseConstruction`
now takes a REQUIRED `ScanSliceKind` (`"statements"` | `"expression"`). Every call
site knows statically which it passes; the parameter is required so a new call
site cannot forget.

**How I know each frame is complete — the argument, not a list:**
  - `"statements"` -> the body of an **async generator**, the MAXIMAL statement
    context in JS: `async` admits `await`/`for await`, `function` admits `return`,
    `*` admits `yield`/`yield*`, and every other statement form is legal in any
    function body. No statement legal in a server-fn body is illegal there.
  - `"expression"` -> that same body with the slice **parenthesized**. Inside
    parens the expression grammar is unambiguous and maximal — an object literal
    is an object literal — and `await` stays legal.
  Both complete **by construction**, not by enumeration. **The residual risk moves
  from an OPEN question ("did I enumerate every construct?") to a CLOSED one
  ("did each of five call sites declare the right category?"), and the type
  system checks the second.** A parse failure is now a compiler-defect signal
  rather than an expected path.

## 2026-09-07T16:20Z — FINDING 2, and a HOLLOW TEST I caught on myself

Deduped on `fnNode.span.start` — the author's actual site, so two same-named fns
in different scopes stay two defects. Verified by disabling the dedup: 2 -> 1.

⚠ **My first regression test for it was HOLLOW and I nearly shipped it.** The
caller did nothing but call the peer, so route inference put the caller on the
CLIENT, no peer callable was emitted, and the test read **1 with AND without the
dedup**. I caught it only because I disabled the dedup to prove the test bit —
and the count did not move. The shipped test gives the caller its own `?{}` (1
with / 2 without, measured) and pins the peer-callable banner in the emitted
module so the premise cannot silently stop holding.

## 2026-09-07T16:20Z — FINDINGS 3-5

- **3 (Ext-5 idempotency).** Taken as DOCUMENT, and the reviewer's other option is
  not merely costlier — it is **unsound**: `_scrml_idempotency_store` persists a
  `JSON.stringify` STRING against a hard-coded `200`, so capturing an author
  `Response` for replay means consuming the stream about to be returned, and
  replaying it under the wrong status without its headers. Recorded in-source and
  in SPEC §14.8.9 with that reasoning. ⚑ **Deliberately NOT in a diagnostic: no
  diagnostic reaches the affected population.** The shape is a NON-protect app on
  the passthrough branch, and `E-PROTECT-005` fires only on protect apps — saying
  it there would be saying it to the wrong audience.
- **4 (`RESPONSE_STATIC_PRODUCERS`).** Taken as DERIVE, the option that makes the
  split self-checking: it is now the `as const` source of a derived type,
  `RESPONSE_NULL_BODY_STATICS` is computed from it by difference, and a
  module-load check asserts the partition is TOTAL. A future producer lands on the
  SAFE (warned) side by default instead of being silently unrecognized.
- **5.** No action, agreed — `new Response(undefined, …)` is unreachable from
  scrml lowering (§42.5/§42.8 absence lowers to `null`).

## 2026-09-07T16:20Z — FINAL VERIFICATION, and a wrong-referent near-miss

- Gate scope: **29,832 pass / 84 skip / 10 todo / 0 fail.**
- Full `bun run test`: **31,222 pass / 214 skip / 11 todo / 54 fail.**
  **`comm -13 base-fails.txt after3-fails.txt` -> EMPTY.**
- **R26, assertion intact:** `matched 218 + unmatched 0 = 218 -> HOLDS`,
  **INTENDED-ONLY 218/218, UNEXPLAINED 0.**
  ⚑ **ARTIFACT CONTENT DIFFS ARE 218 — IDENTICAL TO THE PREVIOUS ROUND, WITH AN
  IDENTICAL SHAPE HISTOGRAM.** That is the direct answer to the landing condition:
  finding 1's fix changes only WHICH SLICES GET SCANNED, not what is emitted. The
  three moved figures are again fully accounted for: `source set delta 4` =
  exactly the four conformance cases I added across the rounds (`onlyA` EMPTY);
  `syntax delta (script) 4` = those same `.server.js` under the SCRIPT goggle,
  which every `.server.js` in the corpus fails identically (effective delta 0);
  `bare sites +2 in 0 sources`.
- ⚠ **WRONG-REFERENT NEAR-MISS, CAUGHT BY VERIFYING.** My first run of the
  classifier reported a clean `218/218 HOLDS` — **against `head2-work`, the
  PREVIOUS round's artifact tree.** A `sed` line-number substitution had landed on
  a `console.log` instead of the `headIdx` assignment, so the probe answered the
  previous round's question with a well-formed, entirely believable result. Caught
  by grepping the file for the path rather than trusting the exit. Re-run against
  `head3-work` (`3740` distinct vs `3737`) reproduces 218/218 honestly. **A green
  number from the wrong artifact is indistinguishable from a green number from the
  right one — the only defence is checking the referent, every time.**

## 2026-09-07T16:20Z — DEFERRED (unchanged from the fix round, still open)

1. `tenant-egress.ts:389` — byte-identical level-0-only `_{}` opener bug. Arc B's file.
2. The tenant twin of the A5 refusal, open by design (`_protectActive`-only branch).
3. `/__mountHydrate` now applies `_egressRedact`, which includes the tenant redact —
   flagged for arc B because it touches their axis.
4. The §8.9.2 implicit transaction envelope emits in 0 of 7,442 corpus artifacts.
5. `E-PROTECT-005` does not statically cover the channel `broadcast()` sink
   (runtime-covered by the redact refusal).
6. A9-Ext-5 idempotency does not cover an author-owned `Response` — see finding 3;
   needs a store that can hold status + headers + a buffered body (§19.9.6).
7. 12 pre-existing `types-gate` diagnostics, verified pre-existing.

# ============================================================================
# ROUND 5 — the SEAM named and closed. Rounds 3 and 4 each found a defect at the
# boundary between the two limbs rather than inside either; this round fixes the
# boundary, not a third crossing.
# ============================================================================

## 2026-09-07T17:30Z — THE SEAM, STATED

Both limbs answer ONE question: **is this `Response` AUTHOR-owned (unmediated) or
COMPILER-owned (already mediated)?** They were answering it with **different
predicates**:

  - the COMPILE gate by **PROVENANCE** — it scans only the author-body window, so
    a compiler-emitted `Response` is excluded positionally;
  - the RUNTIME guard by **SHAPE** — `.body === null`, which is a proxy for
    "carries a payload", **not** for "who built it".

**Every construction where provenance and shape disagree was a defect, and both
prior rounds were instances of exactly that:**

| round | construction | provenance | shape | outcome |
| --- | --- | --- | --- | --- |
| 3 | `Response.redirect(...)` | author | payload-free | refused when it should pass -> W-PROTECT-005 |
| 4 | §53.9.4 `E-CONTRACT-001-RT` 400 | **compiler** | body-carrying | **refused when it MUST pass -> 500 instead of 400** |

That is why patching each crossing did not converge: the crossings are generated
by the mismatch, so there is an unbounded supply of them.

## 2026-09-07T17:30Z — HIGH reproduced, then closed by giving both limbs the same basis

Reproduced from my own fixture (`adv-csrf-arm-predicated-param.scrml`) and on the
wire: `protect=`, `auth="none"`, `id: number(>0 && <10000)`, POST a violating
value -> **HTTP 500 `ProtectOpaqueEgress`** where the documented answer is
**400 `E-CONTRACT-001-RT`**. No build-time warning. Predicated params are common.

**Fix: carry PROVENANCE to the sink.** A Symbol-keyed mediation mark
(`Symbol.for("scrml.protect.mediated")`) is applied where the COMPILER constructs
a response, and the guard checks it FIRST. Both limbs now decide on the same
basis. Verified on the wire: **400 with the `E-CONTRACT-001-RT` body.**

**And the part that makes it by-construction rather than a third patch** — a
mechanical SEAM TEST asserting the invariant

> every `Response` constructed inside a capture IIFE is AUTHOR-written or MARKED

derived from the EMITTED TEXT over a battery exercising each in-IIFE emitter.
⚑ **The population was derived mechanically, not guessed:** exactly four emitters
run between the IIFE opener and its close — `emitServerParamCheck`,
`emitBroadcastInjection`, `emitLogicNode`, `emitExprField` — and exactly ONE emits
a `Response`. A new compiler emitter appearing in that window now fails a test
with an actionable message instead of reaching an adopter. **Verified to bite** by
removing the mark (and the failure prints the offending site, not the whole
module — a seam test whose output is unreadable does not get acted on).
`_markMediatedResponses` THROWS if the shape it wraps is absent: a silent no-op
is how the limbs drifted apart in the first place.

⚠ **The corpus could not have caught this**: no corpus app combines `protect=`
with a predicated server-fn parameter, which is why the R26 artifact-diff count
is unchanged at 218 across rounds 3-5. Corpus-zero is blast radius, not absence —
the shape is now a conformance case (`mediated-response-passthrough`).

## 2026-09-07T17:30Z — MEDIUM, and why the regression is mine although the bug is not

`_scrml_protect_redact` rebuilds every object as a fresh `{}` from
`Object.keys(value)`, destroying anything whose JSON form is not its own
enumerable keys. Reproduced with the shipped helper: a `Date` column went from
`"created_at":"2020-01-01T00:00:00.000Z"` to `"created_at":{}`. **The redactor
flaw is pre-existing (the SSR seed has it too) — but this arc extended that
redactor to `/__mountHydrate`, a sink that was previously lossless, so the
regression is mine.**

Fixed: rebuild iff **TAGGED** (a protected-origin row, whatever its prototype) or
**PLAIN** (`Object.prototype` or null prototype, where the key walk is lossless);
otherwise return untouched. **The TAG test runs FIRST on purpose** so preserving
non-plain values can never become a way to smuggle a tagged row past the strip —
asserted with a class-instance row carrying the descriptor. Verified: date
preserved, secret still stripped, nested wrapper correct, null-proto row redacted.

## 2026-09-07T17:30Z — THE THREE LOWs

- **LOW 1 (taken).** `<endpoint>` arms carry no distinguishing span — they all
  fall back to `epDecl.span` — so the span-only dedup key collapsed every arm of
  one endpoint into ONE diagnostic naming only the first, costing a rebuild
  round-trip per arm. Key is now `span::name`: the reported name is
  arm-distinguishing, while a fn's name is IDENTICAL on its route-handler and
  peer-callable emissions, which is the pair the dedup exists to collapse. Test
  asserts two offending arms -> two diagnostics naming both; verified to bite.
- **LOW 2 (considered, REJECTED, documented).** Moving the REFUSAL above the
  `COMMIT`: the author's body ran to completion, and the refusal is about whether
  the compiler can safely REPORT the result, not whether the work was valid.
  Rolling back on a reporting failure would discard committed, correct work —
  **inventing silent data loss to solve a confidentiality problem §14.8.9 never
  asked about.** Splitting the two branches across the COMMIT would also make one
  guard mean two different things about durability. Documented in-source with the
  retry hazard, next to the Ext-5 note it shares a class with.
- **LOW 3 (taken).** The comment claiming a top-level Response "never reaches
  here" was true at the three guarded sinks and FALSE for `/__mountHydrate` and
  `/__serverLoad`, which call `_egressRedact` with no guard. Corrected to state
  the bound and why it is unreachable today. This file's correctness is carried
  by its comments, so an over-claiming one is a defect in it.

## 2026-09-07T17:30Z — ROUND-5 VERIFICATION

- Gate scope: **29,838 pass / 84 skip / 10 todo / 0 fail.**
- Full `bun run test`: **31,228 pass / 214 skip / 11 todo / 54 fail.**
  **`comm -13 base-fails.txt after4-fails.txt` -> EMPTY.**
- `corpus-compile-floor` -> PASS, exit 0, 1 tracked pre-existing baseline.
- **R26, assertion intact:** `matched 218 + unmatched 0 = 218 -> HOLDS`,
  **INTENDED-ONLY 218/218, UNEXPLAINED 0**, correct tree confirmed by the distinct
  count moving 3740 -> 3741. 0 newly failing compiles · 0 effective syntax delta ·
  0 load-context changes · 3 diagnostic changes, all my own conformance cases ·
  `source set delta 5` = exactly the five conformance cases added across rounds
  (`onlyA` EMPTY).
- SPEC §14.8.9 gains the ⛔ normative statement that the limbs SHALL decide on
  PROVENANCE, that a compiler-emitted response SHALL NOT be refused, and that an
  implementation SHALL check that invariant mechanically.

## 2026-09-07T17:30Z — DEFERRED (unchanged)

1. `tenant-egress.ts:389` level-0-only `_{}` opener — arc B's file.
2. Tenant twin of the A5 refusal, open by design.
3. `/__mountHydrate` now applies `_egressRedact` incl. the tenant redact — arc B's axis.
4. The §8.9.2 implicit transaction envelope emits in 0 of 7,442 corpus artifacts.
5. `E-PROTECT-005` does not statically cover the channel `broadcast()` sink.
6. A9-Ext-5 idempotency does not cover an author-owned `Response` (§19.9.6 change).
7. 12 pre-existing `types-gate` diagnostics.
8. NEW — `/__mountHydrate` and `/__serverLoad` call `_egressRedact` with NO opaque-result
   guard ahead of it, so a top-level `Response` there would throw uncaught rather than
   return the compiler-owned refusal. Unreachable today (both feed on compiler-built SQL
   values); recorded because the invariant is narrower than it reads.

# ============================================================================
# ROUND 6 — THE LANDING ROUND. My round-5 MEDIUM fix opened a HIGH, and the
# framing that produced it is recorded here at the coordinator's request.
# ============================================================================

## 2026-09-07T18:40Z — THE HIGH: I turned a cosmetic flaw into a fail-OPEN one

Reproduced against the shipped helper before touching anything:

```
plain wrapper : {"u":{"id":1,"name":"a"}}                          <- stripped
class wrapper : {"u":{"id":1,"name":"a","passwordHash":"s3cret"}}  <- LEAKED
nested Response inside a class wrapper -> NO THROW
```

So a protect-tagged row reached through ANY wrapper with a non-`Object.prototype`
prototype shipped its protected column, **and the nested-`Response` refusal — the
limb my own SPEC amendment designates THE GUARANTEE — was bypassed at the same
time.**

**THE DISTINCTION, which is the whole lesson: ONLY REBUILDING IS UNSAFE, NOT
WALKING.** I generalized "don't rebuild" into "don't look". Inside a fail-closed
floor only the first is ever safe, and the second is a leak by construction.

Fixed by making the WALK unconditional and only the RETURN conditional:

| case | return |
| --- | --- |
| plain object | the rebuilt copy (unchanged from the original behaviour) |
| non-plain, walk changed NOTHING | the ORIGINAL — `Date` / `toJSON` survive |
| non-plain, something HAD to change | rebuilt onto the SAME prototype |

Proven in both directions, as the coordinator asked: a tagged row strips through a
class wrapper at shallow / deep / through-an-array nesting **with the prototype
preserved**, a nested `Response` still throws in all three shapes, and the `Date`
+ `toJSON` preservation the change existed for still holds. All four assertions
verified to BITE by restoring the short-circuit and watching exactly them fail.

## 2026-09-07T18:40Z — ON THE FRAMING, recorded as asked — and my half of it

The coordinator asked me to record that the brief said *"the flaw is pre-existing
but this diff extends it to a lossless sink, so the regression is yours"* and
*"preserve non-plain values"* **without specifying the axis**, inside a redactor
whose entire job is fail-closed — and that a preservation instruction inside a
security floor needs to say which axis it preserves on. That is recorded, and it
is true.

⚑ **But the larger share is mine, and the notes should say so.** I was the one
holding the fail-closed floor. An ambiguous instruction arriving at a security
boundary is a signal to resolve the ambiguity — by asking, or by taking the
conservative branch — not to pick a reading and ship it. **The specific failure
was that I never considered the revert.** The brief explicitly offered "let the
`Date` flaw go back to being pre-existing … I would rather ship a known cosmetic
flaw than an unproven security path", and I did not weigh it. A cosmetic
regression at a sink was worth strictly less than the confidentiality property I
spent to buy it back, and that trade should have been obvious at the moment I
wrote a `return value` short-circuit into a redactor.

## 2026-09-07T18:40Z — THE TWO MEDIUMs

- **A non-protect app was no longer byte-unchanged.** `_markMediatedResponses` ran
  regardless of `_protectActive`, and the emitted `_scrml_protect_mediated`
  reference satisfied the helper-injection gate — whose own comment promises a
  non-protect app emits none of it. MEASURED on a `protect=`-free app with one
  predicated param: **11,503 bytes / 222 lines -> 3,056 / 82**, the entire helper
  dead. Gated; the param check itself is untouched.
- **My in-code claim about `/__mountHydrate` was FALSE, and it cost the whole
  page.** I wrote that it and `/__serverLoad` both "feed on compiler-built SQL
  values, so no construction reaches it today". True of `/__serverLoad`; false
  here — `_scrml_mh_v<i>` are AUTHOR server-fn return values. REPRODUCED: a loader
  returning `Response.redirect(...)` compiles at exit 0 (only `W-PROTECT-005`) and
  the redact's refusal **threw out of the handler**, losing the ENTIRE hydration
  payload including every unrelated cell, where the three guarded sinks return a
  shaped 500. The sink now has a guard; the comment now states exactly which sinks
  are guarded and why `/__serverLoad` is safe **for a reason rather than by luck**.
  ⚑ I had filed this shape as a deferred item last round on the belief it was
  theoretical. It was live. A deferred item resting on an unverified
  reachability claim is not deferred, it is unreported.
  The guard refuses ANY `Response` cell rather than reusing the three-way test: a
  hydration cell is DATA, so "does it carry a body" is not the question here, and
  the payload is atomic — a partially-hydrated page is worse than a diagnosable
  failure.
- Cosmetic: restored the two comment lines my round-4 edit stranded.

## 2026-09-07T18:40Z — ROUND-6 VERIFICATION

- Gate scope: **29,844 pass / 84 skip / 10 todo / 0 fail.**
- Full `bun run test`: **31,234 pass / 214 skip / 11 todo / 54 fail.**
  **`comm -13 base-fails.txt after5-fails.txt` -> EMPTY.**
- `corpus-compile-floor` -> PASS, exit 0, 1 tracked pre-existing baseline.
- **R26, assertion intact:** `matched 218 + unmatched 0 = 218 -> HOLDS`,
  **INTENDED-ONLY 218/218, UNEXPLAINED 0.** 0 newly failing compiles · 0 effective
  syntax delta · 0 load-context changes · 3 diagnostic changes, all my own
  conformance cases · `source set delta 5` = exactly the five cases added
  (`onlyA` EMPTY).
- ⚠ The artifact-diff count is **218 for the fourth consecutive round**, and that
  is now a load-bearing fact rather than a coincidence: none of rounds 4-6 moved
  emission outside the protect helper and the three guarded sinks. The non-protect
  bloat fix does not appear in it because no corpus app pairs a predicated param
  with a protect-free `<db>` — the same corpus-zero that hid the bug.

## 2026-09-07T18:40Z — DEFERRED (updated)

1. `tenant-egress.ts:389` level-0-only `_{}` opener — arc B's file.
2. Tenant twin of the A5 refusal, open by design.
3. `/__mountHydrate` applies `_egressRedact` incl. the tenant redact — arc B's axis.
4. §8.9.2 implicit transaction envelope emits in 0 of 7,442 corpus artifacts.
5. `E-PROTECT-005` does not statically cover the channel `broadcast()` sink.
6. A9-Ext-5 idempotency does not cover an author-owned `Response` (§19.9.6).
7. 12 pre-existing `types-gate` diagnostics.
8. ~~`/__mountHydrate` / `/__serverLoad` lack an opaque-result guard~~ — **CLOSED
   for `/__mountHydrate` this round (it was LIVE, not theoretical).**
   `/__serverLoad` remains unguarded and is safe for a stated reason: its values
   are compiler-built from a lowered `?{}`, with no author construction reaching it.
