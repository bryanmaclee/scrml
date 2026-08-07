# non-compliance.report.md
# project: scrml
# generated: 2026-08-06T23:38:11-06:00  commit: 97576f35
# **SOURCE WALK IS AT `cf1849b2`; the stamp is `97576f35`, the true HEAD.** The two later commits
# (`70ad2e6c` known-gaps, `97576f35` the S326-bryan wrap continuity) are DOCS-ONLY — verified
# `git diff --name-only cf1849b2..97576f35` = {docs/changelog.md, docs/known-gaps.md,
# docs/pr-reviews.md, hand-off.md, handOffs/delta-log.md, master-list.md}, ZERO diff under
# compiler/ scripts/ stdlib/ package.json .github/.
# scan mode: INCREMENTAL (S325/S326 pass, `a3a34d80` -> `97576f35`, 17 commits, two clones)

## Summary — this pass

The window is small and almost entirely emit-time: **7 `compiler/src/codegen/` files, 1 workflow
line, 4 new test files, 2 new conformance cases, zero SPEC lines, zero manifest lines.** That shape
normally produces a quiet report. It did not, and the reason is worth stating up front:

> **Two of this window's three most consequential doc defects are caused by a fix landing MORE than
> its ledger entry claims, not less.** #452 shipped a `Response` contract *and*, in the same commit,
> silently closed the prototype-chain half of a separate open security gap. Neither the gap entry nor
> the SPEC records it. **The failure mode this pass surfaces is under-claiming, not over-claiming** —
> which is the harder one to catch, because every gate is built to catch the opposite.

| | count |
|---|---|
| Tracked `*.md` in scope (outside `archive/`, `handOffs/`, `node_modules/`, `dist/`, `.claude/`) | 1,400 |
| NEW findings this pass | 3 |
| Carried findings RE-VERIFIED still open | 7 |
| Carried findings RESOLVED / retired this pass | 0 |
| Uncertain — needs human review | 2 (both carried, unchanged) |

**One thing this report is NOT claiming.** It did not re-walk `docs/website/`, `docs/articles/`, the
`docs/changes/**` archive beyond this window's four new files, or the `samples/` / `examples/`
READMEs. Those carry their prior-pass verdicts. The scan this pass was TARGETED at the surface the
window's diff could have falsified — the seven codegen files, the session/auth surface, the §34
catalog, and the gap ledger.

---

## NEW this pass

### S326-N1. A normative **SHALL** was introduced in a source comment and a commit subject, filed under **§12.5**, and §12.5 does not contain it

**Reason:** canon-claims-X / SPEC-silent — the direction a one-way audit misses.
**Severity:** MEDIUM. Not a wrong behaviour; a wrong *provenance*.

`compiler/src/codegen/emit-server.ts` (the #452 landing) states, in bold, as a rule:

> **Route handlers SHALL return a `Response`** — unconditionally, on every path, in every
> combination of `auth=` / `protect=` / tenant / `csrf=` / idempotency.

and `ec0142aa`'s subject is `fix(§12.5 emit-server): auth/protect-active route handlers SHALL return
a Response (#452)`.

**Verified against the SPEC, not assumed.** `compiler/SPEC.md` has **ZERO diff this window**
(`git diff a3a34d80..HEAD -- compiler/SPEC.md compiler/PIPELINE.md compiler/SPEC-INDEX.md` is empty).
§12.5 is *"Server Function Return Values"* — §12.5.1 allowed return types + the `T | not` wire
envelope, §12.5.2 client receipt, §12.5.3 normative statements. **Every §12.5.3 bullet is about type
serializability.** `grep -n "SHALL return a \`Response\`" compiler/SPEC.md` returns nothing. The
closest thing to the obligation is §12.5.2's *"The compiler-generated fetch wrapper deserializes the
JSON response"*, which **presupposes** a JSON response without ever obliging the handler to produce
one.

**Why this is worth a finding rather than a shrug.** The repo runs a §34.0 row-provenance gate in CI
precisely to stop a diagnostic being asserted without a documented home. The same discipline should
apply to a handler-emission SHALL — arguably more so, because this one has no diagnostic code at all
(it is enforced by emission shape), so **the source comment is the only place the rule exists.** A
future agent reading §12.5 will not find it; a future agent reading `emit-server.ts` will find it
stated as settled normative text. That gap is exactly what pa.md Rule 4 exists to prevent.

**Detail worth preserving either way:** the rule is *right*, and the measurement behind it is the
best part of the landing (Bun returns a constant welcome page on the wire for every non-`Response`
return, and logs to stderr **only** for `undefined`/`null` — so a bare `"ok"`/`42`/`{…}` was
completely silent in both channels). None of that measurement is in the SPEC either.

**Suggested disposition:** add ONE normative bullet to **§12.5.3** — *"A compiler-emitted server-fn
route handler SHALL return a `Response` on every path; a body that itself produces a `Response` owns
its egress and SHALL be passed through unmodified."* — with a `provenance:` block pointing at #452
and the Bun measurement. That is a ~4-line SPEC amendment, and it converts the strongest part of this
window's work from a comment into canon. **Alternatively**, if bryan judges it derived rather than
new, a one-line §12.5.2 note saying the handler obligation is derived from the client-receipt
contract would also close it — but leaving it stated only in a comment should not be the outcome.

---

### S326-N2. `g-session-get-reserved-key-read-disclosure` — the ledger entry's stated locus and its central factual claim are **both false at this HEAD**, because a different arc closed part of it

**Reason:** grep-mismatch + stale-locus. The doc describes code that no longer exists.
**Severity:** MEDIUM-HIGH — this is an OPEN, security-tier, `route=bryan` entry, and the ruling bryan
owes is stated against a premise that has moved.

The `@gap` marker reads:

```
locus=compiler/src/codegen/emit-server.ts:2568(accessor .get — `return this._rec[key] ?? null`,
      no allowlist/denylist/hasOwnProperty)+2666-2675(_scrml_session_bind Proxy catch-all)
```

and the prose repeats it: *"`.get()` is one line — `return this._rec[key] ?? null` — with no
allowlist, denylist, or `hasOwnProperty`."*

**At `97576f35` the accessor is at line 2593 and reads:**

```js
get(key) { return Object.hasOwn(this._rec, key) ? (this._rec[key] ?? null) : null; },
```

Landed in **`ec0142aa` (#452)** — the `Response` arc, not a session arc. So:

1. **The line number is off by 25.**
2. **The "no `hasOwnProperty`" claim is FALSE.**
3. **One of the entry's three sub-findings is CLOSED and the entry does not say so.** *"Prototype-chain
   read is unguarded — `.get("__proto__")` → `Object.prototype`; `.get("constructor")` /
   `.get("toString")` → functions"* and the companion *"Through the `?{}` path `constructor` is an
   HTTP 500 (SQL bind TypeError) — an unhandled-input crash reachable from a request-controlled key"*
   are both fixed by that guard.
4. **The entry's own remediation candidate (iii) has been executed without being marked.** The text
   reads: *"(iii) `hasOwnProperty` + prototype guard only, no key policy — fixes the 500 and
   `__proto__` with no language-surface change, so arguably a plain bug fix needing no ruling"*,
   annotated **"(iii) is separable and should not wait on the ruling."** It did not wait. Nothing
   records that.

**Why this matters more than a line-number nit.** The entry is `route=bryan` and asks for a language
ruling. **The ruling it asks for is now narrower than the entry states** — the crash and the
prototype surface are gone, so what remains is purely the own-key READ POLICY (every own key of
`_rec` including the §40.2 `csrfToken` is readable by an attacker-chosen key). A reader arriving cold
would scope the decision against a surface that is 1/3 already closed, and might reasonably conclude
the whole thing is a plain bug fix — the exact misread the entry's own candidate list warns against.

**Compounding it, in the opposite direction:** the SAME landing took this gap **from log-only to
WIRE-LIVE**. That half IS recorded (the entry carries a discharged REACHABILITY-CHANGED banner and an
explicit "severity stays MED" ruling, which is exemplary). So the entry is *simultaneously* current
on the reachability axis and stale on the locus/mechanism axis — which is the hardest state to detect
by reading, because the presence of a fresh, well-argued banner reads as "this entry is maintained".

**Verification method, stated so it can be re-run:** `grep -n 'get(key) { return Object.hasOwn'
compiler/src/codegen/emit-server.ts` → `2593`; `git log -1 -S "Object.hasOwn(this._rec" --
compiler/src/codegen/emit-server.ts` → `ec0142aa`.

**Suggested disposition:** update the entry in place — correct `locus=` to `:2593`, mark the
prototype-chain and `?{}`-500 sub-findings CLOSED with the `ec0142aa` attribution, note that
candidate (iii) landed as a side-effect, and restate the open question as **own-key read policy
only**. Do NOT close the entry: the policy question is genuinely still bryan's.

---

### S326-N3. `docs/known-gaps.md` — **10 entries' heading lines say `open` while their `@gap` markers say `resolved`**, and the CI gate cannot see the disagreement

**Reason:** internal contradiction; machine-readable half and human-readable half disagree.
**Severity:** LOW individually, MEDIUM in aggregate — it is a systematic read-path defect in the
single doc agents grep first.

The ledger's convention, followed correctly by most entries, is that the heading's trailing backtick
block records status (`… ; HIGH; RESOLVED S326-bryan (#452 ec0142aa)`). Ten entries did not get that
update and still read `; open` (or `; open (currently masked …)`) while their marker carries
`status=resolved` and their body carries a ✅ RESOLVED banner:

| entry | heading says | marker says |
|---|---|---|
| **`g-embed-runtime-ships-mangled-runtime-identifiers`** | `HIGH; open` | `resolved` |
| **`g-mangler-empty-name-whole-buffer-insertion`** | `MED; open (currently masked by an upstream failure)` | `resolved` |
| `g-page-keepalive-attr-spec-vs-spec-conflict` | `open` | `resolved` |
| `g-given-block-server-call-no-autoawait` | `open` | `resolved` |
| `g-cps-scheduler-opaque-boundary-hides-nested-server-calls` | `open` | `resolved` |
| `g-hash87-member-read-await-misparen` | `open` | `resolved` |
| `g-ternary-init-server-call-await-misbind` | `open` | `resolved` |
| `g-nested-each-inner-binding-reads-outer-var-stale-on-reconcile` | `open` | `resolved` |
| `g-crossfile-module-const-dropped-from-client-bundle` | `open` | `resolved` |
| `g-gap-counts-silently-drops-unrecognised-status` | `open` | `resolved` |

**The first two are THIS window's own landings**, so the drift is live, not archaeological.

**Why no gate catches it:** `scripts/state.ts`'s `gapMarkersFrom` parses the **marker**, so the §0
rollup and `bun scripts/state.ts --check` are CORRECT and PASS (re-run this pass: `PASS
@generated:gap-counts`). The rollup and the prose have diverged and the gate is, by construction,
blind to it. **A human or an agent greps the heading** — it is the line that carries the one-sentence
description, so it is what a `grep -n "g-embed-runtime"` returns first.

**Also, narrower, in the same two entries:** `g-embed-runtime-…`'s body retains its pre-fix rationale
in the present tense under the RESOLVED banner — *"This is Bug D's exact class, **still open**,
reachable from a supported flag"* and *"**Fix direction is NOT 'patch the regex again'** … the
structural options are to mangle BEFORE the runtime is spliced, or to fence the runtime slot"*. That
second sentence now describes **the landed fix**, in the future tense. Retaining superseded rationale
for provenance is this repo's convention and is fine; retaining it *unlabelled* is what makes it read
as live. The prior pass praised `docs/changes/route-region-teardown/SCOPING.md` for exactly the right
handling of this (a `⛔ TRACED — the design below was a HYPOTHESIS and it is WRONG` banner over the
superseded section). Copy that shape here.

**Suggested disposition:** (a) update the ten heading lines to match their markers — mechanical, and
the two from this window are the ones that matter; (b) consider a ~10-line assertion in
`scripts/state.ts` that THROWS when a heading's status word disagrees with its marker's `status=`.
That script already throws on an unknown status value and already proved its worth doing so (S313);
this is the same class of guard, and it is the only way this stays fixed. **(b) is the real fix — (a)
without (b) will re-drift within three windows, which is empirically how long it took to accumulate
ten.**

---

## Carried findings — RE-VERIFIED at this HEAD

### C3. SPEC §52.15.5 still describes the retired `<div data-scrml-each-mount>`
**RE-VERIFIED, unchanged.** `compiler/SPEC.md` has zero diff this window, so nothing could have moved.
Carried.

### C4. EIGHT live `W-LINT-*` codes have no §34 row
**RE-VERIFIED, unchanged.** Both the SPEC and the `lint-*.js` files have zero diff this window.
Carried.

### C5. `compiler/SPEC-INDEX.md` — the generated half is current, the AUTHORED half is not
**RE-VERIFIED, unchanged.** `compiler/SPEC-INDEX.md` has zero diff this window; only its totals block
is CI-gated (`scripts/regen-spec-index.ts --check`), and the authored half remains ungated. Carried.

### C6. `docs/tutorial.md` hardcodes `v0.7.0` at four sites while `package.json` is `0.7.1`
**RE-VERIFIED at this HEAD, still exactly four sites** (`grep -c "v0\.7\.0" docs/tutorial.md` → 4;
`package.json` `"version": "0.7.1"`). Unchanged for four windows. This is a two-minute fix that keeps
not being made; **suggest either fixing it or wiring the version into the snippet gate**, because a
carried finding that survives four passes is telling you the report is not the mechanism.

### C7. `compiler/native-parser/` — zero diff, none owed, one CONFIRMED standing gap
**RE-VERIFIED.** Zero diff this window and **none owed** — the standing rule holds: *a landing that
adds an AST FIELD to a structural node owes a native mirror; an emit-time / runtime / CLI /
message-only landing does not.* All seven of this window's source files are emit-time. `E-SCRIPT-001`
remains a confirmed pre-existing gap (`parse-markup.js:983-995`). Carried.

### C8. The four `*.generated.md` indexes are **unmaintainable**, and this window sharpened the evidence
**RE-VERIFIED and WIDENED with a concrete new instance.** All four still stamped `2026-06-25 16:27`.
The sharpest single datum this pass: `structure.generated.md` lists

```
- **code-segments.ts** _(352L)_ — `regexAllowedAfter`(fn):34 · `rewriteCodeSegments`(fn):77
```

At this HEAD that file is **522 lines** and exports **six** symbols — the index is missing
`classifyBraceGroup`, `findObjectShorthandRegions`, `BraceGroupKind` and `ObjectShorthandRegion`,
which are **the entire subject of this window's largest codegen landing**. `grep -c
"findObjectShorthandRegions\|joinAroundRuntimeSlot" .claude/maps/structure.generated.md` → **0**.
Test index still says 1042 `.test.js` against an actual **1327** (under-reports by 285, up from 281).
`compiler/src` still says 155 files against 189.

**The escalation from the prior pass stands unchanged:** they are `@generated by
flogence/scripts/mapgen.ts`, an out-of-repo script this project's CI does not run, and the only CI leg
that ever refreshed anything under `.claude/maps/` was deleted at #351. **There is no path by which
these files can become current.** An agent grepping `structure.generated.md` for
`findObjectShorthandRegions` gets zero hits and a plausible-looking index — a silent-wrong-answer
surface, which is worse than a missing one.
**Suggested disposition (recommendation, unchanged and now overdue): wire `mapgen.ts` into
`cloud-maps` Stage 1 alongside `state.ts` and widen it to emit `W-`/`I-` codes — or delete all four.**
Third pass making this recommendation.

### S313-N5. `scripts/git-hooks/pre-push` — comment still stale
**RE-VERIFIED, unchanged.** `scripts/` has zero diff this window (`git diff a3a34d80..HEAD --
scripts/` is empty), so the comment asserting the browser check *"runs in CI `tracking` today"* with
promotion *"bryan's to make"* is still stale — bryan ruled promote and `ci.yml` runs it in `gate`.
Carried.

### S322-N1. `g-auto-await-family-not-closed-…` bakes **150** into an ID whose measurement is **142**
**RE-VERIFIED, unchanged.** The ID is still the string every future session greps. Carried, and it
is worth noting the same failure shape appears in this window's own dispatch record: the
`limb2-mangler-retirement/SCOPING.md` headline number (871) is stated cleanly *with* its denominators
and its "not measured" set, which is the correct handling — the contrast is instructive.

---

## Aspirational / archival content — this window's four new docs, all correctly located

All four sit under `docs/changes/**` (the per-dispatch archive, excluded from content-mapping by
scope). Checked so nobody miscounts them either way:

- **`docs/changes/mangler-three-defects/BRIEF.md`** (118L) + **`progress.md`** (279L) — the dispatch
  that landed as #458. **`progress.md` is the model of the set** and is worth reading for reasons
  beyond this arc: it records the S239 round REMOVING a fix (the binding-pattern half) with the
  reasoning for the removal, and it records the residual `?? "anon"` boundary of the `registerFnName`
  guard as an explicit limit rather than leaving it implicit. `status: current` frontmatter on a
  landed dispatch is the archive convention here, not drift.
- **`docs/changes/authed-server-fn-bare-return/BRIEF.md`** (166L) — the #452 dispatch brief. Correctly
  archived at dispatch time per the standing rule.
- **`docs/changes/limb2-mangler-retirement/SCOPING.md`** (132L) — **scoping for an arc that is NOT
  built**, and it says so: the mangler-retirement blocker is stated as *ORDERING, not plumbing*
  (`fnNameMap` is built in `emit-functions.ts` and `CompileContext` does not carry it — `ctx.fnNameMap`
  has zero occurrences in `compiler/src/`). Its 871-site population count is **stated with its
  denominators and with an explicit "Not measured: the 490 `.scrml` outside the five default roots"**.
  Read it as scoping, not as pending work that was skipped. **Caveat for a reader:** three of the
  defects it scopes were fixed by #458 while the retirement itself was not, so its "the pass has no
  scope awareness" framing is still true but its defect inventory is one window behind.

---

## Uncertain — needs human review (both carried, both unchanged)

### `docs/language-inspiration-audit-2026-06-06.md`, `docs/lin.md`, `docs/external-js.md`, root `gaunt.md` / `DESIGN.md` / `NERDME.md` / `scrmlFormula.md`
**Reason:** Not re-derivable from source. These are design/positioning documents whose claims are
about intent and comparison, not about code that grep can confirm or refute.
**What to check:** bryan's call on whether each is (a) current positioning, (b) historical and should
move to `scrml-support/archive/`, or (c) superseded. Unchanged this window and not re-chased.

### `docs/website/`
**Reason:** A published surface with its own build (`docs/build.ts`) and its own gate
(`scripts/snippet-gate.js` covers code snippets, not prose claims). Prose currency is unverified.
**What to check:** whether any page states a version, a count, or a feature status that the snippet
gate does not cover. `docs/tutorial.md`'s four `v0.7.0` sites (C6) are the known instance and suggest
there are others.

---

## Map currency at this stamp

| Map | Stamp | Honest? |
|---|---|---|
| primary · structure · dependencies · domain · auth · test · error · non-compliance | `97576f35` | re-walked this pass |
| build | `97576f35` | re-walked — one CI trigger changed (#454) |
| infra | `97576f35` | re-walked after four held windows — same one trigger |
| schema | `fe14c9b2` for the AST half, `97576f35` for the ONE appended codegen-region entry | **deliberately split, and labelled at both sites.** `compiler/src/types` has zero diff for six windows |
| config | `e80b692e` | **deliberately older.** Zero env-surface diff re-verified: `git diff a3a34d80..HEAD` contains no added/removed `process.env`/`Bun.env` reference anywhere in `compiler/src` or `scripts/` |
| migrations | `115e8b1b` | **deliberately older.** No DB/migration surface in six windows |

**An honest older stamp beats a false "verified at HEAD".** The two split-stamp cases above are
labelled at their own sites, not just here.

**Standing hazard, unchanged and worth repeating because nothing has moved on it in seven passes:**
`cloud-maps` no longer refreshes `.claude/maps/` on any schedule, so a stamp is exactly as old as the
last wrap. `scripts/state.ts` reports map staleness (this pass, pre-refresh: *"maps: 17 commits behind
HEAD (watermark a3a34d80, HEAD 97576f35)"*) but it is **WARN-only, not gated**. Seven consecutive
passes have recommended promoting that warning to a real check.

## Tags
#scrml #non-compliance #project-mapper #cleanup #spec-drift #spec-silent-shall #§12.5 #response-contract #stale-locus #ledger-drift #heading-vs-marker #status-disagreement #under-claiming #side-landing #session-read-side #object-hasown #generated-md-unmaintainable #mapgen #tutorial-version-drift #native-parity-not-owed #pre-push-comment-stale #warn-only-not-gated #map-currency-manual

## Links
- [primary.map.md](./primary.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [test.map.md](./test.map.md)
- [build.map.md](./build.map.md)
- [known-gaps.md](../../docs/known-gaps.md)
- [changelog.md](../../docs/changelog.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
