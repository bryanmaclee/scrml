# progress — nested-program-artifact-emission-2026-08-19

Base: `9f6130d0` (origin/main). Branch: `worktree-agent-a217c8b99ee5560a0`.

---

## Step 0 — setup (DONE)

- `pwd` = worktree root, `git rev-parse --show-toplevel` matches, tree clean.
- Base `9f6130d0` — matches the brief's floor exactly, no fetch/merge needed.
- `bun install` — 217 packages.
- `bun run pretest` — 13 test samples compiled into `samples/compilation-tests/dist/`
  (fresh worktrees lack this gitignored tree; populating it up front removes the
  known 7-phantom-failure ENV-GAP class).
- Brief archived verbatim → `docs/changes/nested-program-artifact-emission-2026-08-19/BRIEF.md`
  (commit `d201f377`).

---

## Item 1 — worker bundles generated and never written

### Reproduction on base (EXECUTED, not read)

Compiled `repro-worker.scrml` (a §4.12.4 inline worker: `<program name="doubler">`
with `when message(data) { send({ result: data.value * 2 }) }`) with
`bun run compiler/src/cli.js compile … -o dist/`.

Exit 0. Output dir:

```
repro-worker.client.js
repro-worker.css
repro-worker.html
scrml-runtime.01aqbhx3.js
```

`repro-worker.client.js:19`:

```js
const _scrml_worker_doubler = new Worker("doubler.worker.js");
```

No `doubler.worker.js` anywhere in the output dir. Confirmed: the reference 404s.

### Sidecar carve-out — confirmed still correct on base

`<program name="ml" lang="go" build="…" port="9001" health="/health">` compiles to
**zero** `Worker` occurrences in the client bundle and zero `.worker.js` files.
The §23.4 carve-out at `codegen/index.ts:~1405` splices the node without
registering a worker, exactly as documented. My fix must not disturb this — pinned
by a test.

> **Incidental finding (NOT fixed, surfaced only).** SPEC §4.12.5's worked example
> writes `port=9001` **unquoted**. That does not compile: it fails with
> `E-SCOPE-001: Unquoted identifier '9001' in attribute 'port' cannot be resolved
> in the current scope.` `port="9001"` compiles. So the SPEC's own §4.12.5 sample
> is not a compiling program. Out of scope for this dispatch; see RESIDUALS.

### Naming decision — `<sourceBase>.<workerName>.worker.js`, NOT `<workerName>.worker.js`

The brief names `<name>.worker.js` **and** says "through the same `writeOutput`
path and the same hashing / asset-ref-rewriting rules the sibling artifacts use."
Those two cannot both hold: `writeOutput(filePath, suffix, contents)` composes
`pathFor(...).base + suffix`, where `base` is the SOURCE basename. A bare
`doubler.worker.js` cannot be expressed as `base + suffix`.

I took the source-base-prefixed form. Reasons, in order of weight:

1. **A bare `<name>.worker.js` introduces a new build failure for a legal
   program.** Two sibling pages that each declare `<program name="doubler">` both
   compute to `dist/doubler.worker.js`. Routed through `writeOutput`, the second
   raises `E-CG-015: conflicting output paths`. `doubler` / `parser` / `worker`
   are exactly the generic names two pages would independently pick. Trading a
   404 for a hard build error on a legal program is not a fix.
2. `<base>.<suffix>` is the convention **every** sibling artifact already uses
   (`.client.js`, `.server.js`, `.css`, `.test.js`, `.machine.test.js`).
3. It rides `pathFor` unchanged, so the `pages/` strip, nested output dirs, and
   the E-CG-015 duplicate guard all come for free rather than being re-derived.
4. **SPEC does not name the file.** §4.12.4 says only "The nested program is
   compiled as a separate worker bundle." `grep 'worker\.js' compiler/SPEC.md`
   returns nothing. The filename is an implementation choice, so no SPEC amendment
   is implicated.
5. Blast radius of the rename is zero: the file was never written, so nothing can
   depend on the old name. One unit test asserted the literal string
   (`nested-program-e2e.test.js:93`); it is updated in the same commit.

### Two-sided bite proof

New test: `compiler/tests/integration/nested-program-worker-artifact-emission.test.js`
(8 tests). Its central invariant is deliberately shape-independent — "every
`new Worker("…")` specifier in a **written** client bundle names a file that
**exists** on disk" — so it keeps biting through any future rename.

**RED (base `9f6130d0`, before the fix): 2 pass / 6 fail.**

```
(fail) worker bundles are WRITTEN … > a nested <program name> emits a worker file on disk with real content
(fail) worker bundles are WRITTEN … > every new Worker() ref in the written client bundle resolves to a file on disk
(fail) worker bundles are WRITTEN … > the written worker bundle EXECUTES: postMessage in, doubled value out
(fail) worker bundles are WRITTEN … > two workers in one file emit two distinct bundles, both on disk
(fail) worker bundles are WRITTEN … > two SIBLING pages each with a same-named worker do not collide (E-CG-015)
(fail) worker bundles under --content-hash-assets > worker file is content-hashed and the client ref is rewritten to match
 2 pass
 6 fail
```

Representative red failure (the anti-dangling invariant, on bytes on disk):

```
+   "exists": false,
    "spec": "doubler.worker.js",
```

The 2 that pass red are the two *preservation* assertions — the §23.4 sidecar
carve-out, and the client-bundle hash-covers-its-own-bytes integrity check. Both
must stay green through the change; they are guards, not bite.

**GREEN: 8 pass / 0 fail.**

### Executed, not grepped

The written bundle was loaded into a REAL `Worker` (Bun's web-worker API) and
driven with one message:

```
$ bun run-worker.js dist/repro-worker.doubler.worker.js
WORKER REPLY: {"result":42}
ROUND-TRIP OK
```

Same again on the content-hashed build (`scrml build`):

```
$ ls dist/
index.011hvfnk.css  index.client.000r7mcs.js  index.doubler.worker.01yy7q0t.js
index.html          scrml-runtime.01aqbhx3.js  _server.js

$ grep 'new Worker' dist/index.client.000r7mcs.js
const _scrml_worker_doubler = new Worker("index.doubler.worker.01yy7q0t.js");

$ bun run-worker.js dist/index.doubler.worker.01yy7q0t.js
WORKER REPLY: {"result":42}
ROUND-TRIP OK
```

And the generated production server registers it as immutable:

```js
// dist/_server.js:22
const _SCRML_IMMUTABLE = new Set(["scrml-runtime.01aqbhx3.js",
  "index.doubler.worker.01yy7q0t.js","index.client.000r7mcs.js","index.011hvfnk.css"]);
```

### One hole I opened and closed

LIBRARY-mode outputs (§21.5) also carry `workerBundles`, but codegen builds
their `CompileContext` with `workerNames: []`, so `libraryJs` contains no
`new Worker(...)` at all. Writing those bundles unconditionally would have
emitted an artifact nothing references — the exact inverse of the bug, and no
better. The write is gated on the presence of the referring `clientJs`
(`writesWorkerBundles`), so a library-shaped file's nested worker stays exactly
as inert as it was. See RESIDUALS.

### Fixture correction, same commit

`compiler/tests/unit/given-arrow-colon-canonical-s148.test.js` wrapped every
fixture in a top-level `<program name="P">`. That is SPEC-forbidden (§4.12.2:
"The top-level `<program>` MUST NOT have a `name=` attribute"), and it broke
under the artifact-name change. Investigating it turned up a separate live bug
(RESIDUAL 2). Dropping the attribute made the §E byte-identity test **stronger**,
not merely green — verified by compiling both forms:

- with `name="P"`: `<body>` is EMPTY, client bundle is a shell. §E was comparing
  two empty bundles.
- without: `<body>` contains `<p>hi</p>` and the client bundle carries the real
  lowering, `if (x !== null && x !== undefined) { console.log(x); }`.

### Item 1 result

`FILES: compiler/src/api.js`, `compiler/src/codegen/emit-client.ts`, three test
files. Full gate 22408 pass / 70 skip / 1 todo / 0 fail; conformance 883/883.
Committed `5963ae0f`, facts regen `ffadd957`, pushed.

---

## Item 2 — `<channel>` inside a nested `<program>`

### Reproduction (EXECUTED)

The brief's exact source compiles **exit 0** and emits:

```
server routes: _scrml_route_ws_canonical_feed
client dials:  _scrml_ws/canonical_feed
               _scrml_ws/nested_feed     <-- no route exists
```

with `_ws.onclose = () => { _reconn = setTimeout(_connect, 2000); };` — a silent
infinite 2-second reconnect against a route that does not exist. The worker
bundle for the nested program is `// Generated worker: worker` and nothing else:
the channel is not compiled on that side either.

### MECHANISM — the brief's hypothesis is WRONG; here is the measured cause

The brief hypothesised "the channel is registered globally by the symbol-table
pass". It is not. I instrumented both channel emitters and compiled the repro:

```
[PROBE] server ctxForCache= NULL     analysis.channelNodes= n/a  liveWalk= 1
[PROBE] client analysis= PRESENT     analysis.channelNodes= 2    liveWalk= 1
```

The real cause is a **stale analysis snapshot taken before a tree-mutating
pre-pass**:

1. `analyzeAll` runs at `compiler/src/codegen/index.ts:1267`, **before** the
   §4.12.4 worker-extraction pre-pass at `:~1295-1560`.
2. `analyze.ts:105` computes `channelNodes: collectChannelNodes(nodes)` and
   stores **direct object references** into the live tree.
3. `extractWorkerPrograms` then splices the nested `<program>` subtree out. The
   cached array still points at the removed `<channel>` node.
4. The CLIENT emitter (`emit-reactive-wiring.ts:928`) reads
   `ctx.analysis.channelNodes` — the **stale** view, 2 channels — and emits the
   WebSocket connection.
5. The SERVER emitter (`emit-server.ts:2062`) reads the SAME field, but its
   `ctxForCache` is `null` — `index.ts:1899` calls `generateServerJs` on the
   **legacy positional signature** — so it takes the
   `collectChannelNodes(getNodes(fileAST))` fallback over the **live**
   post-splice tree, 1 channel, and emits one route.

Two emitters, two different views of the same tree. `generateWorkerJs` having no
channel handling is true but is the *third* hole, not the cause of the dangling
dial.

This matters beyond channels: **any** `FileAnalysis` field snapshotted by
`analyzeAll` and consumed at emit time sees nodes the worker splice removed. See
RESIDUAL 4.

### Which shapes are affected — measured, all four §4.12.3 execution-context types

Compiled one file per type, on the PRE-fix tree:

| shape | nested `<program>` attrs | extracted? | server route | client dial | verdict |
|---|---|---|---|---|---|
| §4.12.6 scoped DB | `db=`, **no `name=`** | NO | `scoped_feed` | `scoped_feed` | **COHERENT — works today** |
| §4.12.4 inline worker | `name=` | worker | (none) | `nested_feed` | DANGLING |
| §4.12.5 foreign sidecar | `name=`+`lang=`+`port=` | spliced, no worker | (none) | `side_feed` | DANGLING |
| WASM module | `name=`+`lang=`+`mode="wasm"` | worker | (none) | `wasm_feed` | DANGLING |
| `route=` nested program | `name=`+`route=` | **worker (!)** | (none) | `route_feed` | DANGLING |

**The discriminator is `name=`, not nesting.** `extractWorkerPrograms` claims a
nested `<program>` if and only if it carries `name=`. The `name=`-less scoped-DB
context is never extracted, so its channel stays in the tree and the pair works.
That is empirical, not aesthetic, and it is what the fix keys on.

### WHAT I DID — option taken, and what the alternative would have cost

**Fail closed on both halves.**

**(a) Refuse the shape.** New code `E-CHANNEL-INSIDE-NESTED-PROGRAM`, severity
**error**, fired at `compiler/src/symbol-table.ts` in `walkChannelPlacement` —
the same walker that already owns `E-CHANNEL-OUTSIDE-PROGRAM` and
`E-CHANNEL-INSIDE-PAGE`. It is the third member of that placement triad, and it
is ordered FIRST among the three because it names the reason the declaration
cannot be built at all; sending an author to the `<page>` remedy would send them
to the wrong fix.

**(b) Remove the dangling reference from the emitted BYTES.** After the
extraction splice, `codegen/index.ts` re-collects `analysis.channelNodes` from
the live tree, so both emitters read one view. This is not redundant with (a):
**`scrml build` writes its full dist even when the build FAILS.** Verified:

```
$ scrml build ./appch ; echo "exit=$?"
Build failed with 1 error(s):
  [SYM] index.scrml:6:5 E-CHANNEL-INSIDE-NESTED-PROGRAM: ...
exit=1
$ ls dist/
index.011hvfnk.css  index.client.01pud51s.js  index.html  index.server.js
index.worker.worker.01404h1k.js  scrml-runtime.01ocxnx3.js
```

That behaviour is PRE-EXISTING and general to every fatal error (independently
confirmed with `E-SCOPE-001`), so without (b) the refusal would still leave a
dist on disk carrying a dial to a nonexistent route. With (b):

```
client dials in the failed-build dist: _scrml_ws/canonical_feed
server routes:                         _scrml_route_ws_canonical_feed
```

Note (b) initially missed the §4.12.5 SIDECAR path: that branch splices WITHOUT
registering a worker, so gating the refresh on `workerDefs.size > 0` left
`_scrml_ws/side_feed` in the client. Caught by the probe sweep, not by the unit
test; the gate is now `treeMutatedByExtraction`, set on ANY splice. Pinned by a
test.

#### New error code — the tradeoff, stated

I did **not** reuse an existing code.

- `E-CHANNEL-INSIDE-PAGE` is the closest semantic sibling (also "this channel is
  in the wrong container, move it up into `<program>`"), but its message says
  "inside a `<page>`". Firing it here would produce a diagnostic that does not
  name the root cause — itself a diagnostic bug, and it would send the author
  looking for a `<page>` that is not there.
- `E-CHANNEL-OUTSIDE-PROGRAM` is actively wrong: the channel IS inside a
  `<program>`, just the wrong one.

Cost of the new row: a §34 catalog entry, a §4.12.9 row, a §38.1 invariant
amendment, and a §38.2 normative statement. `bun scripts/s34-census.ts
--check-new` → **`2 new/changed §34 row(s), all well-formed — PASS`** (both rows
carry an emitter provenance note naming
`compiler/src/symbol-table.ts` `fireChannelInsideNestedProgram`).

#### Severity: `error`, deliberately

- There is no reading of the pre-fix output under which it is what the author
  wanted: no server route, no client state, and no worker-side channel code.
- A warning on an otherwise exit-0 build gets missed. That is precisely how this
  shipped in the first place.
- Refusing is the **reversible** direction. Relaxing an error later is cheap;
  un-shipping a silently-broken artifact is not. (`limit primitives, don't
  god-ify`.)

The SPEC text is explicit that this is the fail-closed position, **not** a
ratified prohibition — see the DESIGN FORK below.

### THE DESIGN FORK — for the operator, NOT decided here

**What SPEC actually says, quoted, no interpretation:**

- **§4.12.1**, final normative bullet: *"A `<program>` nested inside another
  `<program>` SHALL be subject to the same grammar rules as a top-level
  `<program>` (§4.1, §4.2, §4.3, §4.11)."* The enumeration is **scoped to four
  sections**. **§38 (channels) is not among them.** So this sentence does not
  admit channels in nested position — and it does not forbid them either. It is
  simply silent on §38.
- **§4.12.3** gives four execution-context types. *"Inline web worker | `name=`,
  no `lang=` | `new Worker()`, postMessage IPC"* — client-side. A web worker
  cannot host a server-backed WebSocket route, so a `<channel>` there looks
  **incoherent**, not merely unimplemented.
- **§4.12.2** lists `route=` as valid in nested position with the semantics
  *"Declares the nested program as a server endpoint"*, and `db=` likewise. So
  **some nested programs are meant to be server-side**, and for those a channel
  is at least arguable.
- **§4.12.8** states the communication model: *"Parent and nested programs
  communicate exclusively through message-passing interfaces. There is no shared
  memory, no shared reactive state, and no shared scope."* A channel cell is
  shared reactive state, which cuts against admitting one across the boundary in
  either direction.

**The fork, stated plainly:** does the answer depend on the §4.12.3 execution
context TYPE (channels forbidden in a worker / WASM / sidecar, permitted in a
`route=` or `db=` server-side nested program), or is it uniform (never, in any
nested `<program>`)?

**A load-bearing measurement the operator should have before deciding:**
`route=` **is not implemented at all.** A `<program name="api" route="/api/v1">`
is claimed by `extractWorkerPrograms` as a WEB WORKER — I compiled it and it
emitted `d-route.api.worker.js`. So "some nested programs are server-side" is
today a SPEC claim with no compiler behind it. If the fork is resolved toward
"type-dependent", the `route=` execution context has to be built first; the
channel question rides on top of it. That is a much larger piece of work than
this dispatch, and it is why refusing today costs nothing.

**What my change forecloses: nothing.** The error is one `if` in one walker, the
SPEC text names it as the fail-closed position, and the §34 row records the open
question verbatim.

### Two-sided bite proof (item 2)

New test: `compiler/tests/integration/channel-inside-nested-program.test.js`
(9 tests). Red half taken by stashing ONLY the two source files and re-running:

**RED: 3 pass / 6 fail.**

```
(fail) the refusal > a <channel> inside a nested <program name=> is a hard error
(fail) the refusal > the canonical sibling channel is untouched — exactly one error, on the nested one
(fail) no dangling dial in the emitted bytes > every client WS dial has a matching server route
(fail) no dangling dial in the emitted bytes > the §23.4 SIDECAR splice path also clears the stale snapshot
(fail) no dangling dial in the emitted bytes > the WASM-module shape leaves no dangling dial
(fail) no dangling dial in the emitted bytes > a nested <program route=> — SPEC calls it a server endpoint — is also refused for now
 3 pass
 6 fail
```

**GREEN: 9 pass / 0 fail.** The 3 that pass red are the OVER-FIRE guards (the
§4.12.6 scoped-DB carve-out, a canonical top-level channel, and a nested worker
with no channel) — they must stay green through the change, and they are what
stops the new error from breaking working programs.

Conformance: 2 new cases, `channel/inside-nested-program` (fires) and
`channel/inside-scoped-db-program` (must NOT fire). **885/885 pass.**

---

## RESIDUALS — surfaced, deliberately NOT fixed

These are all real, all reproduced, and all outside this brief. Listed in
descending order of how much they worry me.

1. **A FAILED build still writes a complete dist.** `scrml build` exits 1 and
   prints the error, but leaves a full `dist/` — HTML, hashed client bundle,
   server, `_server.js` — on disk. Verified with the new code AND independently
   with `E-SCOPE-001`, so it is general to every fatal error, not specific to
   anything here. `api.js:2818`'s `emitGateFailed` only guards the flag-gated
   (default OFF) emitted-JS parse gate; there is no general "fatal error →
   suppress writes" gate, even though the comment at `api.js:2860` asserts one
   ("The build still fails ... **and no artifacts are written**" — that claim is
   not true today). A CI step that checks only "did dist get produced" would
   deploy a broken bundle. I would rate this HIGH.

2. **A top-level `<program name="X">` silently annihilates the document.**
   SPEC §4.12.2: *"The top-level `<program>` MUST NOT have a `name=` attribute
   (it is the implicit root)."* There is **no diagnostic** for violating that
   MUST NOT. Instead `extractWorkerPrograms` claims the ROOT program as an
   inline worker, splices the entire document body out, and emits an empty
   `<body>` plus a `new Worker(...)` for a bundle whose content is one comment
   line. Compiles (modulo unrelated errors). Reproduced:

   ```
   $ cat toplevel-named.scrml   # <program name="P"> ... <page><p>hi</p></page> ...
   $ ls dist/
   toplevel-named.client.js  toplevel-named.html  toplevel-named.P.worker.js
   $ grep -A2 '<body>' dist/toplevel-named.html
   <body>
   (empty)
   $ cat dist/toplevel-named.P.worker.js
   // Generated worker: P
   ```

   This is what silently degraded the `given`-arrow test's §E assertion into a
   comparison of two empty bundles. A `W-PROGRAM-*` / `E-PROGRAM-*` on `name=`
   at the root would close it. Not fixed: it needs its own direction call
   (warn-and-ignore vs hard error) and its own test surface.

3. **SPEC §4.12.5's worked example does not compile.** It writes `port=9001`
   unquoted; that yields `E-SCOPE-001: Unquoted identifier '9001' in attribute
   'port' cannot be resolved in the current scope`. `port="9001"` compiles.
   Either the attribute grammar should accept a bare numeric literal or the SPEC
   sample should be corrected — a real fork, not a typo, so I left it.

4. **The stale-snapshot class is wider than `channelNodes`.** `analyzeAll` runs
   before the worker-extraction pre-pass and snapshots `nodes`, `fnNodes`,
   `markupNodes`, `topLevelLogic`, `cssBridges`, `cssBlocks`, `channelNodes`,
   `usage` — all by object reference. I fixed `channelNodes` because that is the
   one with a demonstrated dangling-artifact consequence. I did **not** audit the
   other seven, and did not want to widen this dispatch into that audit. The
   structurally right fix is to run the extraction pre-pass BEFORE `analyzeAll`
   (or re-analyze after it) rather than patching fields one at a time.

5. **`route=` on a nested `<program>` is unimplemented.** §4.12.2 documents it as
   "a server endpoint"; `extractWorkerPrograms` compiles it as a web worker. See
   the DESIGN FORK — this is the prerequisite for any type-dependent answer.

6. **A library-shaped file's nested worker is generated but never wired.**
   Codegen produces the bundle and then hands the library emitter
   `workerNames: []`, so nothing can reach it. I left it exactly as inert as it
   was (see item 1) rather than half-wiring it.

7. **`emit-worker.ts` output readability.** The `when message` body is emitted
   token-spaced: `self.postMessage( { result : data . value * 2 } )`. Correct,
   but it does not meet the readable-output bar. Cosmetic, pre-existing, and
   untouched here.

8. **`generateWorkerJs` handles only function declarations + `when message`.**
   Everything else in a nested `<program>` body — markup, timers, `<request>`,
   and now provably `<channel>` — is silently dropped. The channel case is now
   refused; the rest are not. Worth a sweep, out of scope here.

---

## Verification summary

| | before | after |
|---|---|---|
| `bun test compiler/tests/{unit,integration,conformance}` | 22400 pass / 0 fail | **22419 pass / 70 skip / 1 todo / 0 fail** |
| `bun conformance/run.ts` | 883/883 | **885/885** |
| `bun scripts/s34-census.ts --check-new` | PASS (no new rows) | **PASS (2 new rows, both well-formed)** |

`docs/known-gaps.md`, `handOffs/delta-log.md`, `handOffs/dpa-queue.md`,
`master-list.md`, `hand-off.md` — **not touched** (PA-owned). Everything I would
have written there is in RESIDUALS above.
