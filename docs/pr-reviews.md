# PR review ledger — the S239 adversarial floor, made measurable

**What this is.** One machine-readable marker per MERGED PR recording that the S239 adversarial pass
ran, what it probed, and what it found. Parsed by `bun scripts/review-debt.ts`; **the marker is the
record — prose here is commentary and is never parsed.**

**Why it exists (S316).** The review floor (S313 — *"if it isnt us that makes the changes, we should
at least do a thorough review on it"*) had a **0% execution rate the day after it was ratified**:
eight PRs merged in one day, zero reviews on all eight, and it surfaced only because bryan asked
"have we looked at Peter's PRs?". The cause was structural, not a lapse — boot reads `gh pr list`
(**open** PRs), the floor binds **merged** ones, and nothing computed the difference. The obligation
was invisible to the session that incurred it and to every session after. Same shape as the S262
`gh issue list` miss: a channel the contract names but no probe reads.

**Marker form** — append one line per PR, newest at the top of the log section:

```
<!-- @review pr=<n> verdict=clean|finding|carve-out by=S<N>-<who> date=<YYYY-MM-DD> probe=<what-was-probed> [note=<slug>] -->
```

- `clean` — pass run, nothing found.
- `finding` — pass run, something found. `note=` names it; the detail belongs in `docs/known-gaps.md`.
- `carve-out` — pure docs / spec-text / config with no code path (pa-base §8 carve-out). **Recorded
  anyway**, so the skip rate stays measurable — a floor whose carve-out rate approaches 100% is
  decorative (§8, the absorbed escape hatch).

**This is DETECTION, not a control.** It never blocks a merge, and it is deliberately **not** wired
into CI: a gate instantly red over an existing backlog is the §8 cry-wolf shape that gets bypassed
and then deleted. It runs at boot and reports; the PA states the number.

**Epoch.** The floor binds **PR #385 and later** (`REVIEW_FLOOR_EPOCH` in the script). Earlier PRs
predate the rule and are out of scope by construction rather than by exemption.

---

## Log

<!-- @review pr=391 verdict=finding by=S316-bryan date=2026-08-03 probe=adjacent-markup-positions note=autoawait-incomplete-attr-and-each-body -->
<!-- @review pr=390 verdict=clean by=S316-bryan date=2026-08-03 probe=import-resolution-executed -->
<!-- @review pr=389 verdict=clean by=S316-bryan date=2026-08-03 probe=span-rebase-vs-prefix-baseline -->
<!-- @review pr=392 verdict=carve-out by=S316-bryan date=2026-08-03 probe=docs-only-continuity -->
<!-- @review pr=388 verdict=finding by=S316-bryan date=2026-08-03 probe=direction-of-change note=export-let-newly-accepting-REJECTED -->
<!-- @review pr=387 verdict=clean by=S316-bryan date=2026-08-03 probe=tailwind-over-emission -->
<!-- @review pr=386 verdict=clean by=S316-bryan date=2026-08-03 probe=confidentiality-leak -->
<!-- @review pr=385 verdict=clean by=S316-bryan date=2026-08-03 probe=confidentiality-leak -->

### Notes on the above (commentary — not parsed)

- **#385 / #386** — both widened what reaches the client bundle (#385 rewrote reachability from "read
  by a node in THIS module" to "read by ANY client compilation unit"). Probed the confidentiality
  axis: a module exporting `API_SECRET` read **only** by a server fn in another unit, beside a
  client-read `PUBLIC_LABEL`. The emitted `models/secrets.client.js` carried `PUBLIC_LABEL` and its
  registry entry only; the secret was absent entirely and present in `.server.js`. Same on #386's
  type-annotated path. **The widening is correctly scoped to client reads.**
- **#387** — probed over-emission: an `<engine>` with Tailwind classes in a NON-initial arm plus prose
  containing `text-9xl`. Non-initial arm classes now emit (the fix), initial arm unchanged, prose
  `text-9xl` produced **zero** CSS rules. No over-scan.
- **#388** — the finding. Its `export let` / `export var` emission was **newly-accepting** (a direct
  `<endpoint>` reference fired `E-SCOPE-001` pre-fix, compiles post-fix) with no governing sentence in
  SPEC (`export let` appears **zero** times), no conformance case, and against SPEC §51.0.A:27504's
  ratified *"no free-shaped / untyped global store … **final** shared-state design"*. Deciding
  measurement: **a bare top-level `let` already works** in a `serve=tool`, so the dogfood need was
  already met and `export let` bought only cross-module mutable sharing. **bryan RULED reject (S316).**
  Revert that half; the main-only import tree-shaking half is a clean under-emit fix and stays.
- **#392** — continuity/changelog/delta-log only, no code path → carve-out.
- **#389** — probed span rebasing against the **pre-#389 baseline** (a worktree at `5aeb656a`, which
  predates it), with an undeclared read at a known line in five contexts. Baseline: match-arm read
  reported **line 1** (true 10), `<each>`-body read reported **line 1** (true 19). Post-fix: **10** and
  **19**. Control (top-level, line 7) unshifted both sides — **no double-rebase**. Engine state-child
  arms reported correctly on BOTH sides, so #389 neither fixed nor broke them (an earlier read of mine
  that it "broadened coverage there" was wrong). **Clean — does exactly what it claims.** Surfaced a
  separate PRE-EXISTING bug, filed: [[g-nested-each-in-match-arm-drops-diagnostics]].
- **#390** — probed the S296 over-correction axis: a `kind="tool"` under `pages/` (the shape it fixes,
  where dist strips the leading segment) AND one NOT under `pages/` (where there is nothing to strip
  and a naive re-base would overshoot the other way). Both emit `./models/lib.js` against an artifact
  at `./models/lib.js`. **Verified BY EXECUTION** — both tools imported and ran (`hi a` / `hi b`),
  which is the required standard for this class: S296's signature is compile exit 0 + `node --check`
  clean + runtime `Cannot find module`. **Clean.**
- **#391** — **FINDING: the fix is incomplete.** Probed the four markup positions an interpolated
  cross-module async call can inhabit. Only the top-level text interpolation is awaited:

  | source position | emitted marker | status |
  |---|---|---|
  | `<p>${ fetchStatus(@url).status }</p>` | `_scrml_logic_2` | `(await fetchStatus(…))` ✅ |
  | `<div title=${ fetchStatus(@url).status }>` | `_scrml_attr_title_3` | **BARE** ❌ |
  | inside an `<each>` body | `_scrml_logic_4` | **BARE** ❌ |
  | inside a `<match>` arm body | *(no call site emitted)* | unresolved |

  Both bare sites reproduce the ORIGINAL symptom by a different door — a field read off a Promise
  renders `undefined`, silently, compile exit 0. This is the S288 shape: *a fix verified thoroughly
  inside too small a surface is still incomplete — enumerating shapes inside a function is not the same
  as enumerating the functions a class of defect can inhabit.* The PR's own test carries a sync
  negative control (good practice) but only exercises the one position it fixed. Filed:
  [[g-markup-autoawait-misses-attr-and-each-body]].
