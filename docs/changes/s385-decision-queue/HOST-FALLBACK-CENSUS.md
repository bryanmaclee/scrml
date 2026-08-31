# Host-fallback census — scrml adopters

Method: per repo, count `.scrml` vs host (`.js`/`.ts`/`.mjs`/`.cjs`) tracked files, then classify each
host file / `_{}` block as FALLBACK (exists because scrml could not express it, evidence required) /
BOUNDARY (legitimately host) / UNKNOWN. Compiler-GENERATED `.js` committed as build output is broken out
as a fourth bucket — it is not host-authored code and must not inflate either side of the ratio.
Read-only on every repo; all commands via `git -C`.

Cross-reference target: `/home/bryan-maclee/scrmlMaster/scrml/docs/known-gaps.md` (10,734 lines, 481 `g-*` ids).

---

## 1. giti — `/home/bryan-maclee/scrmlMaster/giti` (branch `main`, HEAD `d9b8021`)

### Denominator

Tracked files: **83 `.scrml`** vs **78 host** (71 `.js` + 7 `.mjs`). No `.ts`.

Host files broken out by what they actually are:

| bucket | n | files |
|---|---|---|
| **GENERATED** — committed scrml compiler output, 1:1 with a `.scrml` sibling | 17 | `src/lib/*.js` (bookmarks, classify-from-status, cli-args, duration, find-scrml-files, format-status, friendly-error, parse-status, remotes, resolve-compiler, result, save-message, save-routing-async, save-routing-pure, scope-manifest, scope-match, server-helpers) |
| **BOUNDARY** — vendored stdlib runtime shims | 4 | `src/lib/_scrml/{fs,host,path,process}.js` |
| **BOUNDARY** — test harness | 20 | `tests/*.test.js` (17) + `tests/manual/*.mjs` (3) |
| **BOUNDARY** — repro fixture sidecar | 1 | `ui/repros/repro-06-relative-imports-helper.js` |
| **BOUNDARY** — git merge-driver prototypes (invoked by git as executables) | 4 | `docs/ast-merge/prototype/*.mjs` |
| **NOT-YET-MIGRATED** — the pre-scrml CLI/engine layer | 31 | `src/cli.js`, `src/commands/*` (16), `src/engine/*` (4), `src/merge/*` (5), `src/private/*` (3), `src/server/*` (2) |
| **UNKNOWN** | 1 | `src/lib/delay.js` |
| **FALLBACK (block-level)** | — | the `json()` helper inside `src/server/index.js:45` |

giti **predates scrml adoption**: it is a Node/Bun CLI that started as JS and has been migrating
slice-by-slice. The migration target has been `src/lib/` (pure logic) + `ui/` (the web UI), and it is
**complete on that target**: 17/17 lib modules and 7/7 UI pages compile from `.scrml` source
(`master-list.md`: *"server-helpers.scrml MIGRATED -> LIB COMPILE 17/17, first time ever. Every lib module
now compiles from scrml source."*). The 31 CLI/engine files are unmigrated backlog, **not** fallbacks —
no artifact anywhere claims a language limitation blocks them.

**`_{}` foreign-code blocks in `.scrml`: ZERO.** Verified by scanning all 83 tracked `.scrml` files.

### FALLBACK — 1

**F1. `json(body, status)` in `src/server/index.js:45`** — a ~6-line helper that stayed in JS.

Evidence, from the retained scrml sibling `src/lib/server-helpers.scrml:10-12` (file header):
> `//   - Returning a typed `Response` was attempted but `Response` isn't in`
> `//     scrml's logic scope and isn't exposed via scrml:host or scrml:http`
> `//     stdlibs — `json` stays JS-side.`

Corroborated in `master-list.md` (slice 19):
> *"Attempted to port `json` but `Response` constructor isn't in scrml's logic scope (no scrml stdlib
> exposes it; `scrml:host` only has `safeCall`/`safeCallAsync`). Left `json` in JS."*

**Gap cross-reference: NO GAP FILED UNDER GITI.** The mechanism is nevertheless known upstream under a
*different* adopter: `g-handle-new-response-fires-e-scope-001` (HIGH, **resolved S355-peter**) —
*"`new Response(...)` inside a `handle()` escape-hatch body fires `E-SCOPE-001` (undeclared identifier
`Response`) — the Fetch-Standard host constructors were never in the typer's logic-scope allowlist"*,
filed from **adopter #471** (PDF/binary egress), fixed by allowlisting `Response`/`Request`/`Headers`.
So giti reported the shape in S10 (~2026-05), it was never filed as a gap, it was independently
rediscovered from another adopter ~5 months later, fixed, and **never routed back to giti** — the
fallback is still in giti's tree.

### UNKNOWN — 1

**U1. `src/lib/delay.js`** (9 lines, `export const delay = (ms) => new Promise(...setTimeout...)`), imported by
`ui/feed.scrml:39` to pace an SSE `server function*` poll loop.

Its own header claims a language reason:
> *"Kept as a tiny JS host helper because scrml auto-await only fires for statically-known Promise<T>
> callees; an explicit `await delay(...)` at the untyped host edge is the spec idiom (giti DF-10)."*

**But the artifact contradicts the premise**: `scrml:time` **does** export `sleep(ms)`
(`scrml/stdlib/time/index.scrml:342` — *"Sleep for a specified number of milliseconds. Returns a Promise"*),
a statically-known stdlib callee — exactly the case the comment says auto-await *does* handle. So this
reads as a stdlib-discoverability miss (giti's own **DF-6** class: *"Original 'hole' was just me not
surveying stdlib"*), not an inexpressibility. Cannot resolve without compiling the alternative, so:
**UNKNOWN**, leaning BOUNDARY-by-discoverability rather than FALLBACK.

### Notable side-findings (giti)

- **The seed case is CLOSED.** `src/lib/server-helpers.scrml` / `composeScrmlFetch` /
  `g-async-returned-function-expression-drops-return` (GITI-038) was fixed upstream at scrml
  `72ba19d6` (PR #111, *"fix(GITI-038): transform returned named-function-expression async closures"*)
  and giti **migrated the module off its committed `.js`** in `d9b8021` (2026-07-20). The `.js` there
  today carries the `// Generated library module — scrml compiler output` header. It is no longer a
  host-fallback.
- **STALE GAP:** `docs/known-gaps.md:3515` still lists `g-async-returned-function-expression-drops-return`
  as `HIGH; open — needs bryan disposition` and says *"Not urgent (giti: working `.js` committed)"*,
  which is false as of 2026-07-20. The fix commit is in scrml's own history.
- **Source-level contortions that are NOT host-fallbacks** (scrml stayed scrml, the *source* bent):
  `save-routing-pure.scrml:12` (*"DF-8 workaround: cross-scrml `.scrml` imports aren't rewritten to `.js`
  in library-mode emit. Use `.js` directly."*), and the retired `n[o]t` regex char-class workaround
  (GITI-017, removed on fix). These are worth counting on a *different* axis — language exported the
  shape into the source, not into the host.

---

## 2. flogence — `/home/bryan-maclee/scrmlMaster/flogence` (branch `main`, HEAD `c186a21`)

### Denominator

Tracked files: **22 `.scrml`** vs **29 host** (24 `.ts` + 4 `.mjs` + 1 `.js`).

flogence is the **best-instrumented** of the four: it maintains an explicit census of every host file
and why it is still host — `docs/100-percent-scrml-scope-2026-07-15.md` (103 lines, 6 buckets) plus
`src/ports/README.md` (144 lines, per-file port table + residuals A–G). It also **retired 10 `.ts`
files on cutover** (fleet · digest · tick · fsp · sessions · bridge · health-ingest · route · compare ·
fsp-wire), which is why the count is 29 and not the "30 `.ts`" the scope doc opens with.

Its own definition of the target, quoted, because it reframes the question:
> *"NOT 'zero `.ts` anywhere' … **Proposed definition:** the product's operational runtime — every tool
> the orchestrator RUNS to do its job — executes as compiled scrml, with `.ts` confined to (a) the
> foreign-facing SDK export, (b) build-time codegen, (c) genuinely-external-engine FFI, and (d)
> throwaway spikes."*

### `_{}` foreign-code blocks — **249 blocks, 16.3% of all scrml lines**

Measured by span (`_={` … `}=`), not by comment mention: **249 blocks across 15 of the 22 `.scrml`
files**, carrying **~1,095 of 6,700 scrml lines (16.3%)**. Concentrated in `src/ports/`, where the
per-file foreign share runs **23–67%**:

| file | blocks | foreign lines / total | % |
|---|---|---|---|
| `src/ports/lanes.scrml` | 4 | 73 / 109 | **67%** |
| `src/ports/bridge-tool.scrml` | 21 | 82 / 166 | 49% |
| `src/ports/dispatch-async-tool.scrml` | 25 | 113 / 255 | 44% |
| `src/ports/compare-tool.scrml` | 34 | 122 / 298 | 41% |
| `src/ports/health-ingest-tool.scrml` | 7 | 61 / 150 | 41% |
| `src/ports/digest-tool.scrml` | 11 | 47 / 124 | 38% |
| `src/ports/fsp-core.scrml` | 52 | 134 / 393 | 34% |
| `src/ports/sessions-tool.scrml` | 5 | 25 / 73 | 34% |
| `src/ports/route-tool.scrml` | 12 | 30 / 96 | 31% |
| `src/ports/tick-tool.scrml` | 12 | 24 / 83 | 29% |
| `src/ports/fleet-tool.scrml` | 20 | 31 / 110 | 28% |
| `src/ports/dispatch-tool.scrml` | 22 | 36 / 133 | 27% |
| `src/ports/fsp-tool.scrml` | 6 | 16 / 71 | 23% |
| `src/app.scrml` | 16 | 295 / 3882 | 8% |
| `src/ports/fsp-wire-tool.scrml` | 2 | 6 / 110 | 5% |

**BOUNDARY: 248.** Spot-checked across `app.scrml`, `fsp-core`, `bridge-tool`, `dispatch-tool` and
`lanes` — every block sampled is host I/O: `await import("node:fs"/"node:os"/"node:path")`, `Bun.file`,
`Bun.spawn`/`spawnSync` (git, `claude -p`, OpenRouter), `graph.json` reads, regex parsing of the
markdown delta-log. SPEC §64.2 admits this by name (*"`main` is the program's IMPURE entry point (it
reads argv, calls `process.exit`, and does `_{}` host I/O)"*), and `src/ports/README.md` codifies the
conventions (`fn` = pure, may hold `_{}`; `function` = impure, holds `?{}`; value-returning foreign only;
`in: {}` takes bare identifiers). Classified by convention + sample, **not** per-block — 249 is past what
this pass could individually cite.

**UNKNOWN: 1** — `src/app.scrml:1861` (`syncDeputyStream`). The delta-log parse is done *inside* the
foreign block, and the stated reason is partly defensive against the compiler:
> *"a `_{}` foreign slice reads + parses + freshness-filters (**regex in the OPAQUE slice — no
> scrml-codegen miscompile risk, no coloring-rule inlining**)"*

That is a block placed in the host partly to avoid scrml codegen, which is the fallback smell — but the
block also does genuine file I/O, which is boundary. Cannot separate the two motives from the artifact.

**⚑ The share is itself a finding, and it cuts against flogence's own red line.** They stopped porting
`fsp-mcp`/`fsp-wire` because *"wrapping Bun.serve/the stdin loop in one foreign `_{}` = **FFI-in-a-costume**
(fails full-production fidelity → STOPPED at the honest line)."* That line was drawn at ~100% foreign.
The ports that *did* ship average **~35% foreign by line**, and `lanes.scrml` — described in the README as
*"✅ importable + **runs live**"* — is **67% JS**. No fallback is recorded for any of them, and by the
letter of the classification none is one (each block is host I/O). But "the runtime is 100%-scrml" and
"a third of the ported runtime is JS inside `_{}`" are both true statements about the same tree, and only
the first one appears in any ledger.

### FALLBACK — 2

**F2. `scripts/fsp-mcp.ts`** (the FSP MCP stdio JSON-RPC server). Blocked on a missing scrml program shape.

Evidence, `docs/100-percent-scrml-scope-2026-07-15.md` bucket B:
> *"`fsp-mcp.ts` (stdio JSON-RPC MCP server). Needs a scrml **stdio persistent-loop** shape (the `serve=`
> that landed is HTTP; stdio is a different transport)."*

Corroborated in `handOffs/delta-log.md` [99] (S24), which is the sharpest statement of the class in any
of the four repos:
> *"THE BOUNDARY (not residuals — a **MISSING PROGRAM SHAPE**): the last files are all LONG-RUNNING
> SERVERS … ALL blocked on the same gap; their semantics are already 100%-scrml (dispatch() proven via
> fsp-tool), only the TRANSPORT FRAMING is stuck; forcing a port = wrapping Bun.serve/the stdin loop in
> one foreign `_{}` = **FFI-in-a-costume** (fails full-production fidelity → STOPPED at the honest line)."*

**Gap cross-reference: NO GAP FILED.** `grep -niE "stdio|mcp[- ]server|json-rpc|jsonrpc"` over
`docs/known-gaps.md` returns **zero** hits for an adopter-facing stdio-server shape. It was filed to
scrml as **"oracle ask #5"** in flogence's own delta-log [92]/[99] (*"a long-running/stdio program
surface — fsp-mcp is a persistent stdin JSON-RPC loop w/ NO native scrml surface"* … *"RE-SCOPED +
URGENCY-RAISED: stdio → ANY persistent-server loop, now GATES 3 files not 1"*). The **HTTP half landed**
(`kind="tool" serve=`, scrml Track A Unit 2, PR #38, S30) and `fsp-wire.ts` was ported and deleted. The
**stdio half was never filed as a gap and never landed.** Note `scrml:mcp` exists in stdlib but is
explicitly not this: *"COMPILER-INTERNAL stdlib module. Adopters DO NOT `import … from 'scrml:mcp'`
directly"* — 11 fixed read-only introspection tools, not an adopter MCP surface.

**F3. `scripts/dispatch.ts`** (THE DISPATCH LOOP — the orchestrator's hot path). A working `.scrml` port
exists (`src/ports/dispatch-tool.scrml`, RUN-verified S24) and **does not compile on current HEAD**.

Evidence, `handOffs/delta-log.md` [182] (S35 wrap, the most recent gate reading):
> *"`compile:dir` **RED (exit 1, 2 errors — the SAME 2 external `E-ASYNC` at `dispatch-tool.scrml:111`,
> now formally RULED HOLD by scrml S286)**"*

The site, from [165]: `const runLane = () => provider=="open" ? runAider(…) : runClaude(…)` — a thunk
passed to `runGatedAgentic`, which awaits it. And the adopter's explicit retain-don't-contort decision,
[172]:
> *"§3 the one live question — should flogence restructure the site locally or hold it as a live adopter
> witness? … **my lean: HOLD** (the S33 principle doesn't stop applying just because the fix was deferred
> rather than denied; `compile` is green so we're not blind; a real instance is worth more to an R2
> design Q than our convenience)"*

**Gap cross-reference: FILED — `g-async-stdlib-in-sync-callback-over-fires`, HIGH, `status=in-progress`**
(`docs/known-gaps.md:6518`). Case 1 (timer callbacks) was ruled an over-fire and **fixed** S279; **Case 2
is flogence's site and is deferred**: *"CASE 2 — an async thunk passed to a USER HOF that awaits it
(`runGatedAgentic(() => runAider())`) = a real colorless-async BOUNDARY GAP, DEFERRED to an R2 design Q:
the Promise IS consumed correctly (awaited by the callee), but the compiler can't verify a user HOF
awaits its callback param without cross-fn coloring → the fail-closed is defensible but blocks a legit
idiom."* This gap is also one of the two HIGHs the known-gaps §0 headline was **under-counting**
(`docs/known-gaps.md:7704`).

Note `dispatch` is doubly blocked — the port is also **stale** against the S29 `warm()` integration
(*"dispatch.ts has 6 warm refs … the ports have 0. Cutting them over as-is would REGRESS the warm()
auto-boot layer"*). That second blocker is integration debt, not a language gap. The E-ASYNC blocker is
a language gap and is sufficient on its own.

### PINNED-BY-A-FALLBACK — 3 (reported, NOT counted in the headline)

- **`scripts/lanes.ts`** — a working port exists (`src/ports/lanes.scrml`, *"importable + runs live"*).
  Retires only when its last `.ts` consumer does; that consumer is `dispatch.ts` (F3).
- **`scripts/fsp-core.ts`** — port exists and RUN-verified. Pinned by `dispatch.ts` (F3) + `fsp-mcp.ts` (F2).
- **`scripts/dispatch-async.ts`** — port exists and is *ahead* of the `.ts` (*"`dispatch-async.ts` itself is
  currently broken on `--dry` … while the scrml port works"*). Blocked on `warm()` integration only —
  **not** a language gap, so not a fallback.

These 3 are downstream of F2/F3. If the two fallbacks cleared, they would follow.

### UNKNOWN — 1 (plus the `_{}` block above)

**U2. `scripts/warm.ts`** — the doc calls it *"a judgment call"* (bucket F):
> *"Inherently foreign-heavy (subprocess + git) → a scrml port would be almost all `_{}` foreign (thin
> value). Options: a thin `kind="tool"` wrapper (like the wire, mostly foreign), OR accept as interim
> glue under the 'thin FFI allowed' clause + **file the subprocess-primitive ask if it becomes pressing**."*

scrml **can** express it (via `_{}`, and `app.scrml:783` already spawns `warm.ts --run` from a `_{}`), so
it is not strictly inexpressible — it was declined on value. But the "subprocess-primitive ask" was never
filed: `scrml:process` exports only `cwd/env/argv/platform/exit/uptime/memoryUsage` — **no spawn/exec**.
UNKNOWN, leaning BOUNDARY-by-choice, with an unfiled language ask attached.

### BOUNDARY — 23

- **Foreign-facing SDK, TS by design** (3): `sdk/fsp-client.gen.ts` (generated), `sdk/fsp-transports.ts`,
  `sdk/smoke.ts`. Scope doc: *"TS by design — foreign TS clients consume it."*
- **Build/codegen tooling** (2): `scripts/fsp-gen.ts` (generates the SDK from the scrml model),
  `scripts/mapgen.ts`.
- **External-engine FFI** (2): `scripts/giti.ts`, `scripts/giti-sync.ts`. `giti-sync.ts:5` states it as a
  boundary in the adopter's own words: *"Bun/TS library wrapping the `jj` CLI — **scrml can't BE it, so
  the boundary is unambiguous** (unlike FSP)."*
- **Dev tooling over scrml source** (3): `scripts/semdiff.ts` (wraps `scrml semdiff`),
  `scripts/groundedit.ts`, `scripts/groundprompt.ts`.
- **Spikes / prototypes / staged features** (7): `async-dispatch-spike.ts`, `resume-spike.ts`,
  `backfill-graph.ts` (one-time), `render.ts`, `currency.ts`, `ast-merge-fieldadd.ts`, plus
  `leasing.ts` + `leasing-concur.ts` (staged, not product-wired) — 8 counting both leasing files.
- **Experiments + harness** (5): `experiments/floStyle/scrml/{apply-profile,derive-provenance,mount-overlay}.mjs`,
  `experiments/floStyle/scrml/overlay.js` (a browser overlay mounted *onto* the compiled scrml artifact),
  `.claude/statusline.mjs`.

### Notable side-findings (flogence)

- **An unfiled compiler ask blocking a shipped tool**: `scripts/groundedit.ts:11` — *"resolving a RENDERED
  element → its source node is oracle #7 (`data-scrml-sid` on the emit + a nodeId→span map) — **FILED, NOT
  DELIVERED** (the compiled HTML carries no scrml sids). The compiler HAS the substrate internally."* Not a
  host-fallback (the tool is legitimately host), but the same "language exported a shape" signal.
- **Cutover brittleness class** ([152]/[156]): *"any `.ts` whose robustness is a try/catch can't port 1:1
  to scrml"* — scrml has no try/catch, so `digest.ts`'s guard was silently dropped on port and the tool
  hard-crashed on an under-seeded clone for 3 sessions. Not a fallback (it ported), but it is a shape the
  language forced out of the source.
- **Stale comment**: `src/ports/lanes.scrml:12` still says *"STAGED — blocked on scrml blockers A … + B"*;
  both were RESOLVED S239.

---

## 3. assetManagement — `/home/bryan-maclee/assetManagement` (branch `main`, HEAD `d0d31c4`)

### ⚠ THE CHECKOUT IS STALE — read this before the numbers

`git -C … log -1` puts HEAD at **2026-07-06**; the remote is `git@github.com:pjoliver11/assetManagement.git`
and the live adopter repo has moved ~8 weeks past this clone. scrml's **own** `docs/known-gaps.md`
describes an assetManagement artifact that **does not exist in this checkout at all** — a **327-line
host-JS `db.js` seam** (S387/S388-peter, August 2026). So the local count below is a measurement of a
July snapshot, and I report the upstream facts separately and label them as second-hand.

### Denominator (local checkout)

Tracked: **1 `.scrml`** (`app/src/app.scrml`, 2,708 lines) vs **18 host** (17 `.mjs` + 1 `.js`), plus
**1 `.html`** (`crew/index.html`, 228 lines, with inline JS). 86 tracked files, 50 of them `.md`.

That 1-vs-18 ratio is **not** a migration ratio and must not be read as one. The scrml app is one large
file; every host file is either operational tooling over the Google Sheet / Supabase Postgres, or the
Sheets data layer, or the separate crew app. **`_{}` foreign-code blocks in `app.scrml`: ZERO.**

### FALLBACK — 1

**F4. `crew/index.html`** — the entire field-crew capture app (report → Postgres → live triage alert),
shipped as a plain HTML page with a CDN Supabase client, **because scrml rejected the shape**.

The page itself (`crew/index.html:108,111`):
```
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const sb = supabase.createClient(window.SUPA_URL, window.SUPA_ANON);
```

Evidence, `docs/scrml-baas-integration-findings.md` (a whole document, swept against scrml `6f8adc5c`,
filed as `bryanmaclee/scrml#24`):
> *"I already have a known-working **plain-HTML control page** doing the full flow, and tried to
> reproduce it in scrml against the same Supabase project. … **Three walls.**"*
> 1. *"**No browser-side third-party SDK load.** A raw `<script src="…cdn…">` is lint-rejected
>    (`<script>` is a Ghost-Pattern surface), and an ESM/npm `import` is `E-IMPORT-005`. … The only
>    documented route … is the `^{}` + injected `<script type="module">` + `window.__mod` +
>    `CustomEvent` bridge, which the doc itself calls **'known-clunky'**."*
> 2. *"**External realtime can't be hosted.** `<channel>` (§38) is scrml's own websocket protocol … There's
>    no blessed API to push a foreign async callback into scrml reactivity … **This is the leg I most need
>    for the live triage alert, and it has no clean scrml home.**"*
> 3. *"**Browser-held session mismatch.** scrml's `session` (§20.5) is compiler-generated and server-side
>    only — client-side access is `E-SCOPE-012`. … Structural mismatch."*

And the decision it drove, from `SCRML-SAAS-ROADMAP.md` §5:
> *"field crews capture reports/field-service in a **web-native Supabase app** (`crew/`); a **host-JS
> bridge** … converges them … **scrml never touches Supabase** … This **sidesteps the scrml#24 walls**."*

**Gap cross-reference: NO GAP IN `known-gaps.md`.** `grep -niE "cdn:|E-IMPORT-005|browser-held session|
external BaaS|supabase"` over the 10,734-line file returns **one** hit, and it is not a gap entry — it is
a passing reference at `:6557` to *"the docs-shaped-misconception class **the Peter/Supabase incident** is
the standing reminder for."* The question was filed as **GH #24** and **answered as a design refusal**
(`scrml/docs/changelog.md:2185`):
> *"**Peter / GH #24 — posted.** … no, scrml won't become a thin view-layer over a BaaS; and you don't
> need Supabase — the browser talks to the scrml server (`session`/`@currentUser`/`protect=`/`<channel>`),
> and it deploys (`scrml build --target`, verified end-to-end)."*

So: **declined-by-design, with a native alternative offered.** That is a legitimate ruling, and it means
this fallback is not evidence of a *defect*. It is still a shape the language exported to the host, it is
still shipped as host code in the adopter's tree, and there is **no ledger entry anywhere that counts it.**

### BOUNDARY — 18

- **`app/src/sheets.js`** (566 lines, the Google Sheets data layer imported by `app.scrml`'s server
  functions). A genuine third-party integration (service-account JWT-bearer flow, `node:crypto`,
  `node:fs`, Google Sheets REST). **Zero** limitation/workaround/`scrml`-bug mentions in the file. Its
  placement is stated as *architectural policy*, not inability — `SCRML-SAAS-ROADMAP.md` §2:
  > *"The SaaS's heavy lifting — real DB, row-level security, auth — belongs in the host-JS server tier
  > below scrml. scrml owns only the **swappable view layer**. … Keep the durable layers … **scrml-
  > independent, so betting on scrml is never a trap.**"*

  **⚑ But the premise behind that policy was formally corrected as WRONG** — in this repo's own HEAD
  commit (`d0d31c4`, authored by bryan's PA *for* Peter): *"Peter's PA … framed scrml as a frontend shell
  needing a separate backend (Sheets/DB, 'use Supabase Auth'). **scrml is WHOLE-STACK**: UI + server
  functions + native DB (SQL + schema) + `scrml:auth` + realtime channels — **no BaaS below it**."*
  Classified BOUNDARY (third-party API + a stated policy), but the policy rested on a misconception about
  what scrml can do — which is a *different* and arguably worse failure mode than a gap.
- **`tools/**/*.mjs`** (17): `tools/db/` (9 — Supabase Postgres migration apply, seed, query, delete-user,
  crew-config gen, unit import, 2 smokes, env), `tools/reconcile/` (4), `tools/filter-orders/` (2),
  `tools/profile-pdf/build.mjs`, `tools/memory-sync/sync.mjs`. All admin / one-off / build tooling over
  the Sheet or Postgres. None of them is app runtime.

### UNKNOWN — 0

### Second-hand (from scrml's ledger, NOT verifiable in this checkout)

The live `pjoliver11/assetManagement` carries a host-JS **`db.js`** seam that this clone predates. Two
open gaps name it as the blocker:

- **`g-native-sqlite-connection-lacks-wal-and-busy-timeout-config`** — MED, **open**, `NEW S387-peter`
  (`known-gaps.md:47`): *"This is the **sole** capability gap blocking `pjoliver11/assetManagement` from
  retiring its **327-line host-JS `db.js` seam** and going pure-scrml on its DB layer: a full parity audit
  found CRUD, atomic replace-all, the optimistic-concurrency signature … and the regex/date derivation ALL
  expressible natively — **only the connection concurrency config is not.**"* PA-confirmed by execution.
- **`g-transaction-block-not-recognized-inside-a-function-body`** — HIGH, **open**, `NEW S388-peter`
  (`known-gaps.md:53`): *"`transaction {}` (§19.10.2, normative) compiles at the top level of a `${}` logic
  block but fails **E-SCOPE-001 … inside a FUNCTION body**"* → *"**Blocks the aM `db.js`→`?{}` guarded-
  replace-all domains (Assets + 5 `makeStore` stores)**."*

If the live tree is measured, `db.js` is a **FALLBACK with two filed gaps** — the best-documented example
in the whole census, and the only one where scrml did a full parity audit before classifying.

### Notable side-finding — the contortion axis, which is where assetManagement's real cost sits

`app.scrml` carries **~19 in-source shape contortions** around compiler bugs — the language exported the
shape into the *source*, not into the host. A representative sample (all verbatim):
- `:140` — *"unusable here: that state machine isn't emitted in this scrml build — see bug-report Bug 4"*
- `:575`, `:587` — *"NO nested/conditional `<each>` (scrml Bugs 7/9)"* … *"Flat list (single `<each>`)"*
- `:684`, `:986` — *"`for...of` … inside a plain fn into a DOM list-render that throws (Bug 11)"* →
  the code uses `.reduce` instead
- `:715`, `:1206`, `:1375` — *"bound list incrementally — scrml bug-report Bug 9"*
- `:2090`, `:2239`, `:2374` — *"plain `<div>`, not a 2nd `<form>` (scrml Bug 10)"*

`docs/scrml-bug-report.md` tracks 12 bugs; 6 were open at last sweep (`d05cf40`, 2026-07-02) and filed as
GH #18–#23. scrml's changelog (`:185`) later reports *"**7 of 9 `assetManagement` issues verified
stale-resolved**"* — so most of these contortions are now unnecessary, and the currency pass is an open
item (*"#3 — assetManagement workaround currency … the pin-bump sweep is blocked by the open
`_scrml_region_track` regression"*, changelog S382).

**Doc drift:** `SCRML-SAAS-ROADMAP.md` §5 cites `tools/queue-sync/sync.mjs`; no such file exists in the
tree (`tools/` holds db, filter-orders, memory-sync, profile-pdf, reconcile).

---

## 4. RediLedger — `/home/bryan-maclee/rJantz/RediLedger` (branch `scrml-rewrite`, HEAD `8e6f059`)

### Denominator — and why the file ratio is the wrong instrument here

Tracked on `scrml-rewrite`: **589 files**. **4 `.scrml`** (`scrml-app/app.scrml` 1,010 lines + 3 spike
probes under `docs/scrml-rewrite/phase2/spike/`). Host tiers: **192 Swift**, **45 Rust**, 40 `.sql`,
15 `.sh`, 1 `.py`, 1 `.html`.

**There is not a single `.js`, `.ts`, `.mjs`, `.cjs`, `.jsx` or `.tsx` file in the repository.**
`git -C … ls-files '*.js' '*.ts' '*.mjs' '*.cjs' '*.jsx' '*.tsx'` returns empty.

RediLedger **predates scrml adoption by the whole product**: `main` is the legacy Swift/Rust app
(iOS + macOS clients + a Rust/sqlx API over Postgres); `scrml-rewrite` is the in-flight port, and the
port's entire product surface is **one file**. `scrml-app/FOR-SCRML-PA.md`:
> *"`scrml-app/` is the fork's product code — **one file, `app.scrml`**, plus runnable verification …
> `branch: scrml-rewrite` ← all of our port work; **`main` is the legacy Swift/Rust app**."*

**Migration ratio: 1 of ~237 product source files** (1 `.scrml` vs 192 Swift + 45 Rust), covering
**20 tables, the db-authoritative moat, login, per-user reads, writes-authority and the HC-9 bytes
tier**. Reporting "236 host fallbacks" here would be nonsense. The only honest instrument in this
repo is the **`_{}` block**, and there are exactly **3** of them, all in `app.scrml`.

Two host tiers are BOUNDARY **by explicit architectural ruling**, not by backlog — `FOR-SCRML-PA.md`
names them as the two halves deliberately outside the state machine:
> *"**1. Capture.** Voice/photo/NLP extraction, confidence scoring, drafts. … it is **client-side and
> native by necessity**. → this is our **Crux #2** (capture stays native; scrml owns the server tier).
> **2. Artifacts of record.** Receipt images and compliance documents — bytes, not state. → this is
> **HC-9**, and it is precisely why it was the *last* invariant with no scrml mechanism: **it has no
> state-machine shape to map onto.**"*

### FALLBACK — 1 tier / 2 blocks

**F5. The HC-9 content-addressed bytes tier** — `storeReceiptBytes` (`app.scrml:761`) and
`readReceiptBytes` (`app.scrml:949`), two inline `_={}` blocks doing sha256 + magic-byte format
identification + durable write (temp → fsync → atomic rename → fsync parent) + 2-deep sharded read-back.

This is the most explicitly-argued fallback in the entire census. The adopter wrote the classification
themselves, in the file, above the code (`app.scrml:716-722`):
> *"**WHY THIS IS `_{}` AND NOT SCRML. scrml owns the whole stack — EXCEPT this. There is no
> blob/object/storage primitive anywhere in the language** (checked `known-gaps.md` + `master-list.md`
> @ `d19d79ea`: **no gap id, no roadmap item, no SPEC section**). Routed upstream 2026-07-27 as the
> **S11** ask, framed as BaaS-parity #4."*

And they pre-empted the boundary reading (`:724`):
> *"This is legitimate INTEGRATION, not layer-replacement (primer §5 test): a specific storage
> subsystem, not a layer scrml already owns. We are NOT reaching for S3/Supabase/a Node service."*

I disagree with their own generosity there and classify it FALLBACK, because their next paragraph is
the fallback definition verbatim (`:735-742`):
> *"⚠ **WHAT SCRML DOES NOT GIVE US HERE** … The file is **NOT inside the moat**. The receipts ROW is
> FORCE-RLS'd; the BYTES it attests to sit on a filesystem path with no principal check. **A file path
> is not RLS'd.** · The slice is **OPAQUE** (§23.2.3) — TS/RI/DG all skip it. Nothing type-checks this
> JS, and nothing will tell us if a compiler upgrade changes the boundary underneath it. ·
> `capabilities=` is declared-but-**UNENFORCED** (§23.5.6)."*

**Gap cross-reference: FILED, BUT ONLY HALF OF IT — and the other half was explicitly DECLINED.**
`g-dbauth-object-access-not-principal-gated` — **MED**, status `db-authoritative tier / roadmap`,
`NEW S297 (Adopter-A BaaS-parity #4, ask #3; slotted by bryan)` (`known-gaps.md:7774`). Its own scope
note (`:7776`):
> *"**Scope: the INVARIANT only, deliberately NOT a storage API.** Adopter-A asked for a
> content-addressed bytes/object tier (BaaS-parity #4). They have **already built** their own `_{}`
> implementation and state they can **carry it indefinitely** — put/get/content-addressing/path
> conventions are theirs and are not asked for. **The one item they state they structurally cannot
> build is their ask #3: object access gated by the same pinned principal as the RLS moat.** Their
> framing: 'A file path is not RLS'd.'"*

So this is a **permanent, mutually-agreed host-fallback**: scrml will close the principal-gating
invariant and will *not* ship the storage primitive. It is the only case in the census where both sides
have signed off on the language permanently exporting a shape. Nothing on the board counts it as such —
the gap that exists tracks the invariant, not the tier.

### BOUNDARY — 1 block + both native tiers

**`scrubPdfBounded`** (`app.scrml:847`) — an inline `_={}` that spawns the Rust `pdf-scrub` binary over
stdin/stdout with a wall-clock kill. Genuine host boundary (kernel-enforced process isolation), and a
deliberate reuse of already-audited code:
> *"The `_{}` block's job here is **MARSHALLING, NOT DECODING**. … the **security property of the legacy
> design is the process isolation, not the scrub logic** … an inline `_{}` has none of the four guards —
> no memory bound, no CPU bound, nothing to kill that is not the server, and `try/catch` contains a throw
> but not an OOM. The child is `pdf-scrub`, **REUSED UNCHANGED** from `api/src/bin/pdf_scrub.rs`, so
> exactly one copy of the security-critical scrub logic exists."*

- **iOS/macOS Swift (192 files)** — BOUNDARY by ruling (Crux #2, quoted above): native capture is the
  product thesis; scrml owns the server tier only.
- **Rust API (45 files, 179 files under `api/`)** — NOT-YET-MIGRATED, the port's actual target. Note
  `api/src/bin/pdf_scrub.rs` is deliberately **retained**, not migrated.

### UNKNOWN — 0

### Notable side-findings (RediLedger)

- **An unmechanized codegen bug they route around in-place**, `app.scrml:843`: *"Error handling is
  modelled on `readReceiptBytes` above rather than written fresh: some `try`/`catch` shapes inside `_{}`
  **fail to lower (`E-CODEGEN-INVALID-LOGIC`)** and we have a **reproducer but no mechanism**
  (HC9-SANITIZATION-SCOPE.md §5). **Stay in the proven shape here.**"* No gap id cited; I found no
  matching entry in `known-gaps.md`.
- **The contortion axis again — money.** `INVARIANT-MAPPING.md` #2: money is held as `text` + `::numeric`
  + a negative test because there is no `decimal`. *"scrml has no Decimal + no wire-codec seam →
  invariant held by convention+test, not the type system. **Bookkeeper/CPA** (silent corruption)."*
  Filed: `G-DECIMAL-MONEY-FIXED-POINT-SCALAR-AND-WIRE-CODEC-SEAM`, MED, **open** (`known-gaps.md:1866`).
  In-source contortion, not a host-fallback — but they call it *"a category blocker, not a niche ask …
  **Any accounting, billing, commerce, payroll or invoicing adopter hits this on day one**."*
- **Another contortion: idempotency.** `INVARIANT-MAPPING.md` #6 — *"scrml's **built-in idempotency is
  incompatible** (compiler-minted v4 · stored in a separate txn after COMMIT · replays with no
  content-compare / no 409) → **bypass it**"* — hand-rolled in scrml with explicit `?{BEGIN/COMMIT}`.
- **A stale-open gap they flagged themselves** (`FOR-SCRML-PA.md`): *"the gap
  `g-dbauth-migrate-no-grants-for-unmarked-identity-table` still reads `status=open` with its pre-fix
  'Ruling owed before a fix' text, though the ruling (b) was made and shipped. … flagging because **a
  stale-open HIGH distorts the count**."* Same class as the giti stale-open found in §1.
- **Backend-only is not a declarable topology**: *"Our whole external API surface draws
  `W-DEAD-FUNCTION`, because every server function's only caller is a **native iOS client over HTTP**."*
  A warning fired across a whole legitimate surface because the compiler assumes the frontend is scrml.

---

# HEADLINE

## The number: **5 host-fallbacks** across 4 adopters (6 artifacts; the HC-9 tier is 2 blocks)

| # | Repo | Artifact | Scope | Gap filed? |
|---|---|---|---|---|
| F1 | giti | `json()` in `src/server/index.js:45` | one function | **NO GAP FILED** (mechanism resolved S355 under adopter #471, never routed back) |
| F2 | flogence | `scripts/fsp-mcp.ts` | one program | **NO GAP FILED** (routed as "oracle ask #5"; HTTP half landed, stdio half never filed) |
| F3 | flogence | `scripts/dispatch.ts` | one program (+3 pinned) | `g-async-stdlib-in-sync-callback-over-fires` — **HIGH, in-progress** (Case 2 deferred to an R2 design Q) |
| F4 | assetManagement | `crew/index.html` | a whole app surface | **NO GAP IN known-gaps.md** — filed as GH #24 and **answered as a design refusal** |
| F5 | RediLedger | HC-9 bytes tier, `app.scrml:761` + `:949` | one tier, 2 `_{}` blocks | `g-dbauth-object-access-not-principal-gated` — **MED, roadmap; INVARIANT ONLY, storage API explicitly declined** |

**Second-hand, not in the checkout I was given:** `pjoliver11/assetManagement` (live) carries a
**327-line host-JS `db.js`** blocked by two open gaps —
`g-native-sqlite-connection-lacks-wal-and-busy-timeout-config` (MED, open, *"the **sole** capability gap
blocking … retiring its 327-line host-JS `db.js` seam"*) and
`g-transaction-block-not-recognized-inside-a-function-body` (HIGH, open). If the live tree is measured
the count is **6**.

## Populations

| Repo | `.scrml` | host | FALLBACK | BOUNDARY | UNKNOWN | other |
|---|---|---|---|---|---|---|
| giti | 83 | 78 | 1 (block-level) | 29 files | 1 | 17 GENERATED · 31 not-yet-migrated |
| flogence | 22 | 29 | 2 | 23 files + 248 `_{}` | 1 file + 1 `_{}` | 3 pinned-by-a-fallback |
| assetManagement (stale) | 1 | 19 | 1 | 18 | 0 | — |
| RediLedger | 4 | 0 JS/TS (192 Swift, 45 Rust) | 1 tier / 2 `_{}` | 1 `_{}` + both native tiers | 0 | 45 Rust not-yet-migrated |

**`_{}` census (measured by span, not comment mention): 252 blocks total.**

| repo | blocks | foreign lines / total scrml lines | share |
|---|---|---|---|
| flogence | 249 | ~1,095 / 6,700 | **16.3%** |
| RediLedger | 3 | ~130 / 1,233 | 10.5% |
| giti | 0 | 0 / 4,425 | 0% |
| assetManagement | 0 | 0 / 2,709 | 0% |

**2 of 252 are FALLBACK** (RediLedger's HC-9 pair); 1 is UNKNOWN (flogence `app.scrml:1861`); the other
249 are host I/O in `kind="tool"` / server position, which SPEC §64.2 admits by name. giti and
assetManagement author **zero** `_{}` blocks between them — and they are the two repos with a compiled-UI
product, where the escape hatch is least reachable.

## Is it a pattern or a handful of one-offs?

**Five is a small number, and it is a small number for a real reason** — the four adopters between them
have migrated or built ~110 `.scrml` files, and the language holds. That is the honest headline and it
is a *good* one. But three things in the data do not support a comfortable reading:

**1. Four of the five have no gap that counts them.** F1, F2 and F4 have no entry in `known-gaps.md` at
all, and F5's entry deliberately scopes out the thing that is actually in the host. Only F3 has a gap
that names the artifact. So of 5 fallbacks the board can see **1**. The mechanism behind F1 was even
*independently rediscovered* five months later from a different adopter (#471), fixed, and never routed
back to giti — the shape was lost, refound, closed, and the original fallback is still sitting in the
tree. That is the "losing shapes silently" failure the measurement was designed to catch, and it is
running at 4-in-5.

**2. The heavier cost is on two axes this count does not measure — and one of them is large.**
The first is the **escape hatch**: flogence carries **249 `_{}` blocks, 16.3% of its scrml lines**, and its
`src/ports/` tools — the ones its ledger calls the completed "100%-scrml" surface — are **23-67% JS by
line** (`lanes.scrml` 67%, `bridge-tool` 49%, `compare-tool` 41%). Not one of those is a fallback by the
letter of the classification; every block is host I/O and SPEC §64.2 blesses it. But flogence stopped
porting `fsp-mcp` precisely to avoid *"FFI-in-a-costume"* at 100% foreign, and shipped at a third foreign
without the same scrutiny. A fallback count of 2 for that repo is technically right and materially
incomplete.

The second axis is **in-source contortion**. Host-fallbacks are rare partly because the `_{}` escape hatch
and the `.ts`-harness convention absorb pressure that would otherwise surface as one — and what is left
lands in the scrml source itself, where it is not rare at all:
`app.scrml` in assetManagement carries **~19** shape workarounds around Bugs 4/7/9/10/11 (`.reduce`
instead of `for…of`, flattened `<each>`, `<div>` instead of a second `<form>`); RediLedger holds money
as `text` + `::numeric` and hand-rolls idempotency to bypass the built-in; flogence lost `digest.ts`'s
`try/catch` on port and shipped a crash for three sessions; giti routed around DF-8 by writing `.js`
import specifiers in scrml source. A defect board plus a fallback count still misses all of that. If the
goal is a language-health metric, **contortions-per-KLOC is the bigger signal and nobody counts it either.**

**3. Two of the five are declines, not defects — and that is the more interesting finding.** F4 was
answered *"no, scrml won't become a thin view-layer over a BaaS"*, and F5's gap says the storage API is
*"deliberately NOT"* in scope and the adopter *"can carry it indefinitely."* Those are legitimate,
defensible rulings. They are also, structurally, the language agreeing to permanently export two shapes
to the host — with no artifact anywhere that records the total. A defect board cannot represent a
sanctioned export, so the count of them is currently zero by construction.

**What the data does not support:** any claim about a trend. This is a single snapshot, one of the four
checkouts is 8 weeks stale, and there is no prior measurement to compare against. It also cannot speak to
adopters outside these four (`DanceCard`/`dc` appears in `known-gaps.md:955` as a third adopter and was
not in scope). The right read is a **baseline**, not a verdict.

## Instrument problems found while measuring (these cost real accuracy)

- **`known-gaps.md` carries stale-open entries that distort every count taken from it.**
  `g-async-returned-function-expression-drops-return` reads `HIGH; open — needs bryan disposition` and
  says *"Not urgent (giti: working `.js` committed)"*; the fix landed in scrml's own history at
  `72ba19d6` (PR #111) and giti migrated the module on 2026-07-20. RediLedger independently flagged the
  same class on `g-dbauth-migrate-no-grants-for-unmarked-identity-table` — *"a stale-open HIGH distorts
  the count."* The board's own `g-known-gaps-heading-and-marker-status-can-disagree-silently` and
  `g-gap-counts-silently-drops-unrecognised-status` are the meta-entries for this.
- **The seed case for this dispatch was itself stale.** `server-helpers.scrml`/`composeScrmlFetch` was
  presented as a verified live fallback; it was fixed and migrated at giti `d9b8021`, 2026-07-20. Every
  count in this report is measured from the artifact, not from the seed.
- **The `assetManagement` path given is a stale clone** at 2026-07-06 against a repo that has moved ~8
  weeks. scrml's own ledger describes an artifact (`db.js`) that is not in the tree.
- **Adopter asks are routed through at least four incompatible channels** — `known-gaps.md` gap ids,
  GitHub issues (#18–#24, #409, #471, #517), numbered "oracle asks" (#5, #7) that live only in
  flogence's delta-log, and per-repo prose ledgers (`master-list.md`, `INVARIANT-MAPPING.md`,
  `100-percent-scrml-scope.md`). Three of the five fallbacks are invisible to a `known-gaps.md` sweep
  because they were filed on one of the other three channels. **This is why nobody has ever been able
  to count them.**
