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

---

## Item 1 follow-on — the defect writing the bundles EXPOSED

Found by executing the flagship example, not by reading. This is the reason
"execute, don't grep" is in the brief: items 1 and 2 were green, the full gate
was green, and `examples/13-worker.scrml` still shipped a worker bundle that
could not load.

### What executing found

```
$ scrml compile examples/13-worker.scrml -o dist/     # after item 1
$ node --check dist/13-worker.primes.worker.js
dist/13-worker.primes.worker.js:23
  const result = sieve ( data . limit )  Send result back to parent.
                                         ^^^^
SyntaxError
```

Two distinct defects in ONE place — `ast-builder.js`'s `when message` body
reconstruction, which builds `bodyRaw` by joining the token stream with `" "`:

1. **Comment leak.** A COMMENT token's `.text` is the comment CONTENT with the
   leading `//` ALREADY STRIPPED by the tokenizer. Joining it puts the comment's
   WORDS back as executable code.
2. **Statement collapse.** Joining with `" "` puts every statement on ONE LINE,
   with no separator. `const r = sieve(data.limit)` followed by `send({…})`
   emitted as `const result = sieve ( data . limit ) self.postMessage( { … } )`.

Defect 1 has an **exact in-repo precedent**: S184 `lifecycle-field-comment-leak`,
same file (~line 5218), same one-line remedy. This loop already carried the
STRING half of the S184-era fixes (the re-quoting branch); the COMMENT half was
simply never applied here.

Defect 2 is why only SINGLE-STATEMENT handlers ever worked. `when-002-message-handler.scrml`
(one statement) parsed; `examples/13-worker.scrml` (two) did not. That is the
whole reason this survived: the only worker fixture in the test suite has a
one-statement body.

### Why I fixed it rather than only surfacing it

It is outside the brief's two items, and I would normally stop and surface. Three
things decided it the other way:

- **Item 1 makes it reachable.** Before, the bundle was generated and discarded,
  so the defect could not bite. Shipping item 1 without this ships a file that
  throws on load. Landing a fix that converts a 404 into a SyntaxError is not a
  fix.
- **It is the same defect, not a new one.** Both halves are "the `bodyRaw`
  reconstruction is not faithful to the source", in one loop, and one half was
  already ruled on and fixed 8,000 lines up in the same file.
- **`validateEmit` defaults to TRUE** (`api.js:870` — the in-file comment at
  ~2841 saying "FLAG-GATED, default OFF" is STALE). Once worker bundles are in
  the gate's artifact set, an unparseable bundle ABORTS the whole write. So the
  alternatives were: fix it, or leave the flagship example unbuildable, or leave
  worker bundles outside the gate and ship broken JS. Only the first is right.

### The fix

- Skip COMMENT tokens (contribute nothing, advance) — the S184 remedy.
- Preserve source line breaks: tokens carry `span.line`, so push a `"\n"` into
  the join wherever the source advanced a line. A body already on one line is
  **byte-identical**, so nothing that worked changes.
- Add worker bundles to the emitted-JS parse gate's artifact set (`api.js`). A
  new emitted-JS artifact class must be in the gate that enforces §2.2.1, or the
  invariant has a hole exactly the size of the new artifact. Gated on `clientJs`
  for the same reason the write is.

### Two-sided bite proof

**RED** (stash `ast-builder.js` only, keep the tests):

```
(fail) a MULTI-STATEMENT `when message` body ... > the written bundle PARSES (statements are separated, comment text is gone)
(fail) a MULTI-STATEMENT `when message` body ... > the written bundle EXECUTES: two statements, correct result
 8 pass
 2 fail
```

**GREEN: 10 pass / 0 fail.**

### Executed, not grepped — the flagship example, end to end

```
$ scrml compile examples/13-worker.scrml -o dist/
Compiled 1 file in 154.9ms
$ node --check dist/13-worker.primes.worker.js && echo PARSES
PARSES
$ bun run-primes.js dist/13-worker.primes.worker.js     # real Worker, postMessage {limit:30}
WORKER REPLY: {"limit":30,"primes":[2,3,5,7,11,13,17,19,23,29],"count":10}
SIEVE CORRECT
```

The §4.12.4 inline-worker example now works end to end for the first time:
written, parses, loads in a real Worker, and computes the right answer.

### Corpus check

All 32 top-level examples compiled. **31 ok, 1 fail** —
`examples/09-error-handling.scrml`, which fails with 4 errors (`E-ERROR-009`) on
the PRE-fix tree as well. Pre-existing, unrelated, not touched.

`bun run pretest` recompiles all 13 compilation-test samples clean.

---

## Verification summary (FINAL)

| | base `9f6130d0` | final |
|---|---|---|
| `bun test compiler/tests/{unit,integration,conformance}` | 22400 pass / 0 fail | **22421 pass / 70 skip / 1 todo / 0 fail** |
| `bun conformance/run.ts` | 883/883 | **885/885** |
| `bun scripts/s34-census.ts --check-new` | PASS (no new rows) | **PASS (2 new rows, both well-formed)** |
| `examples/*.scrml` | 31 ok / 1 pre-existing fail | **31 ok / 1 pre-existing fail** |
| `bun run pretest` | clean | **clean** |

The base figure is derived, not separately measured: the first instrumented
full-gate run measured 22406 pass + 2 fail = 22408 total INCLUDING the 8 tests
that did not exist on base, and both failures were tests that passed on base —
so base = 22400 pass / 0 fail.

---

## RESIDUALS — updated

Items 1-3 and 5-6 below are unchanged from the list above. Item 7 (emit-worker
readability) is partially addressed and restated. Item 4 is unchanged and is now
the one I would fix next.

- **RESIDUAL 7 (restated).** The token-join still emits token-SPACED JS:
  `self.postMessage( { limit : data . limit , … } )`, and continuation lines
  carry a leading space. It PARSES and RUNS correctly now, but it does not meet
  the readable-output bar. The structurally right fix is for `emit-worker.ts` to
  lower the PARSED body (`whenMessage.bodyExpr`, which the AST already carries)
  instead of re-emitting a token join at all. That would retire the whole
  `bodyRaw` reconstruction class — comment leak, statement collapse, and spacing
  — in one move. I did not do it here: it is a real piece of codegen work with
  its own surface, and the minimal faithful-reconstruction fix was enough to stop
  shipping invalid JS.

- **NEW RESIDUAL 9.** `api.js:~2841` documents the emitted-JS parse gate as
  "FLAG-GATED, default OFF". It is **default ON** (`api.js:870`,
  `validateEmit = true`). A stale comment on a gate that aborts every write is
  worth correcting; I left it rather than touch an unrelated line in a commit
  this size, but it cost me a wrong inference mid-dispatch and would cost the
  next reader the same.

---
---

# ROUND 2 — the operator ruling + the five adversarial findings

Base: rebased onto `origin/main` `1d245134` (S355-peter). Branch:
`nested-program-r2-work`.

## Step 0 — rebase (DONE)

Round 1 was cut from `9f6130d0`; `origin/main` had advanced to `1d245134`.
`git rebase origin/main` replayed 6 commits.

**Conflicts: `docs/FACTS.md` only, three times** (once per commit that touched
`compiler/src`). Resolved by the rule the brief gave — never hand-merge derived
numbers:

- `ffadd957` (`chore(facts): regenerate…`) — **DROPPED** (`git rebase --skip`).
  It was a pure regeneration commit; regenerating against the new base makes it
  redundant, and replaying it would have been hand-merging derived numbers by
  another name.
- `4cc6d0a1`, `d100ef4e` — `git checkout --ours docs/FACTS.md` (ours = the new
  base), then regenerate after the last content commit.

`compiler/SPEC-INDEX.md` merged cleanly and did not conflict; it was regenerated
anyway after the last SPEC edit.

Rebased tip before round-2 work: `67342227`. That SHA is the RED baseline used
throughout below.

> **Incidental:** `git rebase` runs the repo's `post-commit` hook per replayed
> commit, and that hook runs the full test suite + gauntlet + browser
> validation. Each content commit took ~5 minutes to replay. Not a defect, but
> it is why the first `git rebase` call looked like a hang.

---

## Item 1 — ⭐ THE RULING

### Reproduction (EXECUTED — seven shapes compiled on the rebased round-1 tree)

| fixture | attrs | worker bundle written | `new Worker` ref | verdict |
|---|---|---|---|---|
| `w-worker` | `name=` | `w-worker.doubler.worker.js` (66 B, real) | yes | CORRECT §4.12.4 |
| `w-wasm` | `name= lang="rust" mode="wasm"` | `w-wasm.calc.worker.js` **25 B** | yes | **MISCLASSIFIED** |
| `w-route` | `name= route="/api/v1"` | `w-route.api.worker.js` **71 B** | yes | **MISCLASSIFIED** |
| `w-scopeddb` | `name= db=` | `w-scopeddb.analytics.worker.js` **68 B** | yes | **MISCLASSIFIED** + false-positive `E-CHANNEL-INSIDE-NESTED-PROGRAM` |
| `w-sidecar-noport` | `name= lang="go" build=` | `w-sidecar-noport.ml2.worker.js` **24 B** | yes | **MISCLASSIFIED** (not in the brief's list) |
| `w-sidecar` | `name= lang="go" port= health=` | none | none | correct (the §23.4 carve-out) |
| `w-toplevel-named` | top-level `name=` | `w-toplevel-named.w.worker.js` **22 B** | yes | N5 |

**FOUR shapes were misclassified, not three.** The brief enumerated `mode="wasm"`,
`route=` and named `db=`. The fourth is the §4.12.5 sidecar spelled WITHOUT
`port=`: the ratified §23.4 carve-out keyed on `port=` alone, so
`<program name="ml2" lang="go" build="…">` — a legal, SPEC-shaped sidecar
declaration missing only the optional port — was still compiled as a web worker
and shipped a 24-byte stub. The ruling's own wording covers it ("no `lang=`"), so
this is inside the ruling, not an extension of it. Worth noting because it is the
shape a `port=`-keyed carve-out is structurally guaranteed to miss.

Bundle contents, verbatim:

```
$ cat dist/w-wasm.calc.worker.js
// Generated worker: calc
```

That is the whole file. It returns 200, loads, and never assigns
`self.onmessage`.

### THE FIX — one predicate, three consumers

New module `compiler/src/nested-program-kind.ts`. It classifies a nested
`<program>` by the §4.12.3 attribute combination and exports the two predicates
the compiler actually needs:

- `isInlineWorkerProgram(node)` — the ruling verbatim: `name=`, no `lang=`, no
  `mode=`, no `route=`, no `db=` (and, retaining §23.4, no `port=`).
- `nestedProgramSubtreeIsExtracted(node)` — true for the four contexts whose
  subtree leaves the tree.

Three consumers now share it. That is the point of the module, not a side
effect: **the bug was two (then three) sites independently guessing at the same
question and guessing differently.**

| consumer | decides | was |
|---|---|---|
| `codegen/index.ts` `extractWorkerPrograms` | splice / register worker / refuse | `if (nameAttr)` |
| `symbol-table.ts` `walkChannelPlacement` | `E-CHANNEL-INSIDE-NESTED-PROGRAM` | `nestedProgramAttrName(node) != null` |
| `codegen/emit-html.ts` | skip the markup subtree | `if (nameAttr) return` |

The third was **found by executing, not by reading** — see "the second site"
below.

### Precedence in the classifier, and why it is normative

`mode=` → `lang=`/`port=` → `route=` → `db=` → `name=`-alone. Several
context-bearing attributes co-occur legally (the SPEC's own WASM row is
`name=` + `lang=` + `mode="wasm"`), so the order decides. `mode=` is first
because §4.12.2 defines it as `"wasm"` for WASM modules, "omitted for sidecar
processes" — so ANY `mode=` is a WASM-shaped declaration and a non-`"wasm"` value
is a malformed one, never an inline worker. `port=` is retained as a sidecar
discriminator purely for continuity with the ratified §23.4 carve-out; that makes
the gate strictly TIGHTER than the ruling's wording, which is the fail-closed
direction.

`story=`, `protect=`, `callchar=`, `capabilities=`, `build=`, `health=` are
deliberately NOT discriminators — they ride ON an execution context rather than
selecting one.

### What the three misclassified shapes emit instead — DECIDED, not guessed

The brief asked this explicitly. Answers, one per shape:

**1. Named scoped-DB (`name=` + `db=`) — no diagnostic; it now WORKS.** This
context is IMPLEMENTED. §4.12.3's table reads `Scoped DB context | name=
(optional), db=` — `name=` is optional on that row, not absent, so the named
spelling was never anything but legal. It is no longer extracted, so
`annotateDbScopes` tags it in place exactly as it does the `name=`-less form.
Verified: dial `_scrml_ws/metrics_feed` + route `_scrml_route_ws_metrics_feed`,
paired.

**2. WASM module (`mode=`) and 3. server endpoint (`route=`) — a fail-closed
diagnostic.** New code `E-NESTED-PROGRAM-CONTEXT-NOMINAL`, severity `error`. The
brief's instruction was decisive: "silently emitting nothing is how the
top-level-`name=` hole behaves, and it is not good." Neither context has codegen;
the parent's `<#calc>.send()` / `callchar{}` would reach nothing. The message
names the context, its §4.12.3 runtime model, and the shape that IS implemented.

**One code, not two.** It is one condition — "this §4.12.3 execution context is
specified but has no compiler behind it" — and two rows differing only in a noun
would be two ways of saying the same thing. Precedent: `E-FOREIGN-SIDECAR-NOMINAL`
is exactly this shape of code for exactly this situation.

**4. Foreign sidecar (`lang=`, with or without `port=`) — silent splice, NO new
diagnostic.** Deliberate, and the reason is in the corpus:
`conformance/cases/capability/inheritance-inherit-covers` and
`inheritance-closest-wins-no-union` both declare `<program name= lang="ts">` with
a `use foreign:` in the body, and both already assert `E-FOREIGN-SIDECAR-NOMINAL`.
Firing a second code at the declaration would put two errors on one unbuilt shape
in ratified cases. §23.4 owns the sidecar's refusal; this round only stops it
inventing a worker. (Residual: a sidecar declared with NO `use foreign:` in the
parent is silent — pre-existing, listed below.)

### N3 — DISSOLVED, as predicted

```
$ scrml compile w-scopeddb.scrml -o dist/      # <program name="analytics" db=…> holding a <channel>
BEFORE: FAILED — 1 error   E-CHANNEL-INSIDE-NESTED-PROGRAM
AFTER:  Compiled 1 file    (3 warnings, 0 errors)
        client dials:  _scrml_ws/metrics_feed
        server routes: _scrml_route_ws_metrics_feed
```

The channel check had no independent bug. It inherited the extractor's
over-claim, which is exactly why the fix was to make both call one predicate
rather than to patch the check.

### N5 — the hole is closed from BOTH sides

`extractWorkerPrograms` now takes a `programDepth`; the top-level call passes 0,
so the document-root `<program>` can never be claimed. Consequence, measured:

```
BEFORE: errors=[]  dials=[]  routes=[]   <body> EMPTY   + w.worker.js (22 bytes)
AFTER:  errors=[]  dials=[top_feed]  routes=[top_feed]  <body> renders
        warning W-PROGRAM-TOP-LEVEL-NAME
```

The §38.1/§38.2 SHALL no longer has a hole at this shape, and it closes by making
the SHALL's own words true rather than by widening it: the SHALL is about a
**nested** `<program>`, and depth 0 is not nested. The extractor was the thing
disagreeing with the SHALL.

**And the §4.12.2 MUST NOT now has enforcement.** New `W-PROGRAM-TOP-LEVEL-NAME`,
severity `warning`. This is not a fresh direction call: `W-STORY-ON-TOP-LEVEL` is
the ratified treatment of the byte-identical condition (`story=` on the top-level
`<program>` — "emits `W-STORY-ON-TOP-LEVEL` and is ignored"), and with the depth
guard in place `name=` at the root is genuinely inert, so warn-and-ignore is
proportionate. Blast radius zero: 0 corpus files declare a top-level
`<program name=>`.

### The second site — found by EXECUTING, and it changes the shape of the finding

After the extractor fix, the top-level-named case still emitted an EMPTY `<body>`.
`emit-html.ts:2329` carried the identical over-claim:

```js
// Named programs are worker bundles (§4.12.4) — skip entirely.
const nameAttr = attrs.find((a) => a.name === "name");
if (nameAttr) return;
```

Two shapes hit, and the second is a bite **this round opened**:

1. top-level `<program name="X">` — the whole document skipped as a worker body.
   Fixing only the extractor left this.
2. a named scoped-DB context — its markup children silently dropped, while the
   byte-identical `name=`-less form rendered. Before item 1 that shape was
   extracted, so the skip was moot; un-extracting it made the skip bite. **A fix
   that stops deleting a subtree can expose a second site that was deleting the
   same subtree for a different wrong reason.**

Fixed with the shared predicate plus a `programDepth` counter. In practice the
extracted shapes are already spliced before this walker runs, so the guard is
defence-in-depth — but it must AGREE with the pre-pass, which is the whole reason
it calls the same function.

### Two-sided bite proof — item 1

New `compiler/tests/integration/nested-program-execution-context-gate.test.js`
(18 tests). Central invariant deliberately stated over the ARTIFACT SET, not over
filenames, so it survives a rename:

> for every §4.12.3 shape: (a) every `new Worker("…")` in the WRITTEN client
> bundle names a file that exists on disk, AND (b) no `.worker.js` exists on disk
> that nothing references.

**Both halves are load-bearing, and (b) is the round-2 half.** Round 1 satisfied
(a) by WRITING the bogus bundles — which is exactly how a loud 404 became a
silent hang.

**RED** (round-1 source `67342227` restored, round-2 tests): **15 pass / 13 fail.**

```
(fail) WASM: fails closed with E-NESTED-PROGRAM-CONTEXT-NOMINAL naming the context
(fail) WASM: emits NEITHER a new Worker(...) reference NOR a bundle
(fail) route=: fails closed with E-NESTED-PROGRAM-CONTEXT-NOMINAL naming the context
(fail) route=: emits NEITHER a new Worker(...) reference NOR a bundle
(fail) lang= WITHOUT port= is a sidecar too: no Worker ref, no bundle
(fail) a NAMED scoped-DB program compiles clean and keeps its channel
(fail) named scoped-DB: client dial and server route pair up
(fail) named scoped-DB: its markup children RENDER
(fail) W-PROGRAM-TOP-LEVEL-NAME fires
(fail) top-level named: the document is NOT annihilated
(fail) top-level named: a NESTED worker under it still extracts normally
(fail) exactly one shape produces a worker artifact at all
(fail) [channel suite] scoped-DB WITH a name= keeps its channel too
 15 pass / 13 fail
```

**GREEN: 28 pass / 0 fail** across the gate file + the round-1 channel file.

The 15 that pass RED are the OVER-FIRE GUARDS — the §4.12.4 control, the §23.4
`port=` carve-out, the `name=`-less scoped-DB carve-out, the canonical top-level
channel, the "nested worker under a top-level named program still extracts"
regression pin. They must stay green through the change and are what stops the
new refusals breaking working programs.

---

## Item 2 — N2, the half-implemented S353 ruling

### What round 1 actually did, and why it read as done

| shape | base | round 1 | round 2 |
|---|---|---|---|
| `<page>` → `<program name=w>` → `<channel>` | `E-CHANNEL-INSIDE-PAGE` | `E-CHANNEL-INSIDE-NESTED-PROGRAM` | `E-CHANNEL-INSIDE-NESTED-PROGRAM` |
| `<page>` → `<program db=…>` → `<channel>` | `E-CHANNEL-INSIDE-PAGE` | unchanged | **no diagnostic** |

Row 1 moved because round 1 added a NEW, higher-precedence code and ordered it
ahead of the page check. The `pageDepth` reset the ruling names was never
written. **A precedence ruling implemented by adding a higher-precedence code is
not the same change as reversing the precedence** — and the row it leaves behind
is the one that matters, because the non-extracted scoped-DB program is the only
one of the two whose channel can actually work.

### MEASURED before it was taken

```
$ scrml compile p-page-db.scrml     # <page> -> <program db=> -> <channel>, PRE-fix
FAILED — 1 error  E-CHANNEL-INSIDE-PAGE
  client dials:  _scrml_ws/page_feed
  server routes: _scrml_route_ws_page_feed     <-- BOTH halves already emitted
```

Both halves pair up. Un-refusing this releases a shape that works; it does not
admit a broken one. That measurement is what made completing the ruling safe
rather than merely principled.

Implemented as
`childPageDepth = tag === "page" ? pageDepth + 1 : (tag === "program" && programDepth >= 1 ? 0 : pageDepth)`.

### The adjacent question — ANSWERED: no

Should `E-CHANNEL-OUTSIDE-PROGRAM`'s `fileHasProgram` pre-scan be
nested-`<program>`-aware? **No change is owed, and none is possible.** The
pre-scan counts every `<program>` in the file, nested ones included — and it
cannot need an exception, because a nested `<program>` cannot exist without an
enclosing one. A file containing a nested `<program>` therefore always contains a
top-level `<program>` and is never a PURE-CHANNEL-FILE (§38.12.6). Verified by
execution, then pinned by test rather than left as an argument:

```
$ scrml compile o-filetop-chan.scrml   # file-top <channel> + <program> containing <program name=w>
FAILED — 1 error  E-CHANNEL-OUTSIDE-PROGRAM   ✓ still fires
```

### Two-sided bite proof — item 2

New `compiler/tests/integration/channel-placement-ordering.test.js` (8 tests). It
pins the PRECEDENCE — which code wins when two conditions hold at once — not
merely the outcome, so a future re-ordering of the three placement arms fails
here rather than silently changing which diagnostic an author reads. It also pins
that the reset does NOT over-apply: a `<page>` INSIDE the nested program re-arms
the check, so a nested `<program>` is a FRESH scope rather than a disabled one.

**RED** (round-1 `symbol-table.ts` restored): **7 pass / 1 fail.**

```
(fail) <page> -> NON-EXTRACTED <program db=> -> <channel> fires NOTHING — the ruling's visible half
 7 pass / 1 fail
```

Exactly the un-moved row. The other 7 pass both sides by design — they are the
guards and the already-correct precedence.

**GREEN: 8 pass / 0 fail.**

known-gaps `g-channel-in-nested-program-inside-page-ordering`: `open` →
**RESOLVED**, recording BOTH the partial round-1 state and the completion. (The
only `docs/known-gaps.md` edit this dispatch made.)

---

## Item 3 — N4, §38.9's LOCAL error-code table

Added the missing `E-CHANNEL-INSIDE-NESTED-PROGRAM` row and re-grounded the
adjacent `E-CHANNEL-INSIDE-PAGE` row with the S353 precedence note.

**This is a recurrence of `g-channel-spec-38-9-stale`** (`docs/known-gaps.md`
~:5310, RESOLVED S189), which found and fixed the identical class once already:
"§38.9's error-code table … OMITS `E-CHANNEL-OUTSIDE-PROGRAM` + `E-CHANNEL-INSIDE-PAGE`
— directly contradicting §38.1 / §38.4.1". Same table, same failure to update it
when a placement code changed. **Twice is a pattern, not an accident:** §38.9 is a
LOCAL duplicate of rows that also live in §34, and nothing links the two, so an
agent editing §34 has no signal that a second table exists. Recorded here rather
than in known-gaps because the brief restricted `docs/known-gaps.md` edits to
item 2's entry.

> A candidate structural fix, for whoever owns it: have `s34-census.ts` warn when
> a code appears in §34 but not in its section-local table (or vice versa). That
> converts a recurring doc-drift class into a gate failure.

---

## Item 4 — N6, self-host mirror drift

`compiler/self-host/cg-parts/section-assembly.js:~1568` emitted
`new Worker("<name>.worker.js")` — the pre-rename BARE form — while the reference
emitter emits `<sourceBase>.<name>.worker.js` and `api.js` writes the bundle at
the prefixed name. So the mirror named a file nothing produces: the same
dangling-reference class this arc exists to close, one layer down. No test gated
it. Fixed, comment included.

**DEFERRED, surfaced not fixed:** the same file's `extractWorkerPrograms` mirror
(**`section-assembly.js:~1902`**) still claims ANY `name=`d nested `<program>` as
a §4.12.4 worker. It is stale by MORE than this round — it never carried the
§23.4 `port=` sidecar carve-out either, so it is at least two rounds behind. The
brief authorized a one-line drift fix; pa.md defers `compiler/self-host/` work
post-v1.0.0. Recorded with the exact line rather than widened into.

---

## Item 5 — the §34.0 census, and how it slipped

`bun scripts/s34-census.ts --check-new --base origin/main` was run and PASSED
(6 rows) right after the §34 catalog edit — and the §38.9 rows were written
AFTERWARDS. The pre-commit hook does not run the census, so `9cad52f4` landed
with the SPEC in a census-FAILING state:

```
§34.0 gate FAILED — 2 of 8 new/changed §34 row(s) are unverifiable claims:
  E-CHANNEL-INSIDE-PAGE — no emitter provenance note, no spec-ahead declaration, not struck
  E-CHANNEL-INSIDE-NESTED-PROGRAM — no emitter provenance note, no spec-ahead declaration, not struck
```

Fixed in `cab60428`; both rows now name their fire site, and the nested-program
row also names the shared extraction predicate. **The rule is the one the
FACTS/SPEC-INDEX pre-push hook already states about itself: run the gate after
the LAST edit, not after the first one.** Recording it because a census that
passes mid-dispatch reads as "done" and is not.

---

## VERIFICATION BAR

### Execute, don't grep — every §4.12.3 shape, compiled, disk inspected

| shape | diagnostic | written to disk | `new Worker` ref | ref resolves? |
|---|---|---|---|---|
| §4.12.4 inline worker | none | `app.doubler.worker.js` (real: `self.onmessage` + `self.postMessage`) | `app.doubler.worker.js` | **YES — and it RUNS** |
| §4.12.5 sidecar (`port=`) | none here (§23.4 owns it) | no worker file | none | n/a |
| §4.12.5 sidecar (no `port=`) | none here (§23.4 owns it) | no worker file | none | n/a |
| §4.12.3 WASM module | `E-NESTED-PROGRAM-CONTEXT-NOMINAL` | no worker file | none | n/a |
| §4.12.2 `route=` endpoint | `E-NESTED-PROGRAM-CONTEXT-NOMINAL` | no worker file | none | n/a |
| §4.12.6 scoped DB (named) | none | no worker file; `.server.js` with the channel route | none | n/a |
| top-level `name=` | `W-PROGRAM-TOP-LEVEL-NAME` | no worker file; body renders | none | n/a |

The one surviving reference, proved by EXECUTION rather than by `existsSync`:

```
$ node --check dist/app.doubler.worker.js && echo PARSES
PARSES
$ bun run-worker.mjs dist/app.doubler.worker.js '{"value":21}'      # a real Worker
WORKER REPLY: {"result":42}

$ bun run-worker.mjs dist/app.doubler.worker.01yy7q0t.js '{"value":21}'   # hashed build
WORKER REPLY: {"result":42}

$ scrml compile examples/13-worker.scrml -o dist/                   # the flagship
$ bun run-worker.mjs dist/13-worker.primes.worker.js '{"limit":30}'
WORKER REPLY: {"limit":30,"primes":[2,3,5,7,11,13,17,19,23,29],"count":10}
```

### Round-1's core guarantee, re-verified across the build-mode matrix

Eight real `write: true` builds, inspected as bytes on disk. Three invariants per
build: no reference without a file; no worker file without a reference; every
client WS dial has a matching server route.

| build | worker refs | dangling refs | unreferenced `.worker.js` | dials | routes | dangling dials |
|---|---|---|---|---|---|---|
| flat | `app.doubler.worker.js` | NONE | NONE | — | — | NONE |
| flat + channel | `app.doubler.worker.js` | NONE | NONE | `feed` | `feed` | NONE |
| flat + named scoped-DB | none | NONE | NONE | `metrics` | `metrics` | NONE |
| nested-dir (`pages/`) | `about.…`, `index.…` | NONE | NONE | `feed` | `feed` | NONE |
| `contentHashAssets` | `app.doubler.worker.01yy7q0t.js` | NONE | NONE | `feed` | `feed` | NONE |
| `contentHashAssets` (worker-only) | `app.doubler.worker.01yy7q0t.js` | NONE | NONE | — | — | NONE |
| `emitPerRoute` | `about.…`, `index.…` | NONE | NONE | `feed` | `feed` | NONE |
| `emitPerRoute` + hashed | `index.…01yy7q0t.js`, `about.…01yy7q0t.js` | NONE | NONE | `feed` | `feed` | NONE |

`MATRIX: all builds coherent`.

### Suites

| | round-1 tip `67342227` | round-2 final |
|---|---|---|
| `bun test compiler/tests/{unit,integration,conformance}` | 22436 pass / 0 fail | **22471 pass / 70 skip / 1 todo / 0 fail** |
| `bun conformance/run.ts` | 885/885 | **893/893** |
| `bun scripts/s34-census.ts --check-new --base origin/main` | PASS | **PASS — 8 new/changed rows, all well-formed** |
| `examples/*.scrml` | 31 ok / 1 fail | **31 ok / 1 fail** (`09-error-handling`, pre-existing `E-ERROR-009`, unrelated) |
| `bun run pretest` | clean | **clean** |
| self-host consumers (`self-compilation`, `parser-conformance-canary`) | — | **98 pass / 13 skip / 0 fail** |

**ENV-GAP ruled out** at step 0: `bun install` (217 packages) and `bun run pretest`
(13 samples) were run before any measurement, so the gitignored
`samples/compilation-tests/dist/` tree that fresh worktrees lack was populated up
front. No phantom failures observed.

### Conformance — 8 new cases, and which of them BITE

Red half run by restoring round-1 source: **888/893, 5 FAILED.**

```
FAIL  channel/inside-named-scoped-db-program      the N3 false positive
FAIL  channel/page-nested-scoped-db-program       the S353 ruling's visible half
FAIL  nested-program/wasm-module-nominal
FAIL  nested-program/route-endpoint-nominal
FAIL  nested-program/top-level-name
```

Three pass both sides BY DESIGN — they are over-fire guards, and one of them has
a limitation worth stating:
`channel/page-nested-extracted-program` (the precedence pin) and
`nested-program/inline-worker-emits-bundle` (the control) are guards.
`nested-program/foreign-sidecar-no-worker` **cannot bite in conformance at all**:
the conformance runner asserts CODES, and the round-1 compiler emitted no code
for that shape either — it just emitted a bogus artifact. The artifact difference
is only visible to the integration test, which does assert it. Recorded so nobody
later reads that case as proving something it cannot prove.

`channel/inside-scoped-db-program`'s description + rationale were STALE — they
asserted the `name=` discriminator this round disproved. Corrected in place and
cross-linked to the new `name=`-bearing twin, so the case file stops teaching the
wrong rule.

---

## The two HIGHs I was told not to fix — not regressed, and one observation owed

`g-when-message-parent-handler-drops-all-but-the-first-statement` — untouched.
Nothing in this round goes near the parent-side `when message` lowering.

`g-stale-fileanalysis-snapshot-leaks-worker-internals-into-the-client` —
untouched, and **the brief asked whether item 1 makes the ORDERING fix natural.
It does, and more than before:**

- The extraction pre-pass is now **classification-driven and depth-aware**. It no
  longer needs anything `analyzeAll` produces — it reads attributes off the raw
  tree. So hoisting it above `analyzeAll` is a pure MOVE, with no dependency to
  untangle first. That was already true, but it was harder to see when the
  decision was an inline `if (nameAttr)` tangled with the splice.
- The set of shapes that mutate the tree is now **named** (`nestedProgramSubtreeIsExtracted`),
  so "which snapshots go stale" has a predicate answer rather than an
  archaeological one.
- Third data point for the ordering fix: `emit-html.ts` was the THIRD site
  compensating for the pre-pass's timing/semantics. Round 1 found the
  `channelNodes` staleness; this round found a second consumer of the same wrong
  question. `treeMutatedByExtraction` + the post-splice `channelNodes` re-collect
  are both compensations that the reordering would DELETE rather than fix, and
  RESIDUAL 4 (the other seven snapshotted `FileAnalysis` fields) is still
  unaudited.

I did not attempt it, per the brief.

---

## RESIDUALS — round 2

Round-1 residuals 1-9 all still stand except where noted. New and updated:

1. **RESIDUAL 5 is now half-closed.** `route=` is still unimplemented, but it no
   longer mis-compiles as a web worker — it fails closed naming itself. The
   §4.12.2 claim ("declares the nested program as a server endpoint") is now
   honestly labelled Nominal in §4.12.3's implementation-status paragraph rather
   than silently contradicted by the emitter.

2. **NEW — a §4.12.5 sidecar with no `use foreign:` in the parent is silent.**
   The sidecar's only diagnostic (`E-FOREIGN-SIDECAR-NOMINAL`) fires at the USE
   site. Declare `<program name="ml" lang="go" port="9001">` and never write
   `use foreign:ml` and you get nothing at all — no worker (correct, as of this
   round) and no diagnostic. Arguably fine (a declaration nothing uses is dead
   code, and `W-DEAD-FUNCTION` covers the functions inside it); arguably the
   declaration site should say "this context is Nominal". I did NOT route it to
   `E-NESTED-PROGRAM-CONTEXT-NOMINAL` because that would double-fire in the two
   ratified capability conformance cases. Needs a direction call, not a fix.

3. **NEW — §38.9 is a structurally duplicated table with no link to §34.** The
   N4 recurrence (twice now, S189 and S356) is a property of the layout, not of
   the agents. A census rule ("a code in §34 whose section-local table omits it")
   would convert it into a gate failure. See item 3 above.

4. **NEW — the self-host `extractWorkerPrograms` mirror is two rounds stale**
   (`compiler/self-host/cg-parts/section-assembly.js:~1902`). Exact line given;
   deliberately not fixed (pa.md defers self-host).

5. **NEW — `git rebase` replays through the repo's full-suite `post-commit`
   hook**, ~5 min per content commit. Not a defect; worth knowing before someone
   kills a "hung" rebase.

6. **RESIDUAL 1 (a FAILED build still writes a complete dist) is now the one I
   would fix next**, ahead of RESIDUAL 4. Round 2 made the refusals more
   numerous, and every one of them still leaves a dist on disk. The bytes are now
   COHERENT in every case measured (the matrix above), so the danger is narrower
   than it was — but "we fail closed AND write the artifacts anyway" is a
   contract nobody can rely on, and `api.js:2860`'s comment still asserts the
   opposite of what the code does.

7. **RESIDUAL 7 (worker-body token spacing) unchanged.** `self.postMessage( {
   result : twice ( data . value ) } )` — parses, runs, does not meet the
   readable-output bar. The structural fix is still "lower `whenMessage.bodyExpr`
   instead of re-emitting a token join".

---
---

# ROUND 3 — 2026-08-20

## Step 0 — setup (DONE)

- `pwd` = worktree root; `git rev-parse --show-toplevel` matches; tree clean.
- `git fetch origin`; `origin/main` = `1d245134`, `origin/nested-program-r2-work` = `55c87868`.
- **`git merge-base origin/main origin/nested-program-r2-work` = `1d245134` = `origin/main`.**
  Main is already an ANCESTOR of r2, so `git rebase origin/main` reported
  "up to date" and replayed nothing. The brief's ~5-min-per-commit hook-replay
  warning did not apply this round, and there were no `FACTS.md` /
  `SPEC-INDEX.md` conflicts to resolve.
- Branch `nested-program-r3-work` cut from `55c87868`.
- `bun install` (217 packages) + `bun run pretest` (13 samples ->
  `samples/compilation-tests/dist/`) — the gitignored-artifact ENV-GAP ruled out
  up front.

---

## Item 2 (RUN FIRST, per the brief) — ⭐ THE MANDATED SWEEP

### The headline: the mandated grep is ITSELF incomplete — this is the same error, third generation

The reviewer's process finding is correct and it is the most valuable thing in
the report. Round 2's method was "grep for every place that tests a nested
`<program>`'s `name`", and it missed sites because the grep that finds them is
`tag === "program"`.

**Running that grep, then auditing what it does NOT match, the same failure mode
appears one level up.** `tag === "program"` returns 33 hits (31 code + 2 prose
comments — `route-inference.ts:1121`, `types/ast.ts:239`), matching the
reviewer's 31. But the codebase spells the same test four other ways:

| spelling | sites | grep that finds it |
|---|---|---|
| `tag === "program"` | 31 code | the mandated grep |
| `tag !== "program"` | 3 | `tag !== "program"` |
| `(node.tag ?? "") === "program"` | 3 | `\(.*\.tag \?\? ""\) === "program"` |
| `nodeTag === "program"` (hoisted local) | 1 | `nodeTag === "program"` |
| `block.name === "program"` / `tagName.toLowerCase() === "program"` (pre-AST) | 3 | neither |

**41 sites, not 31.** The generalisation worth banking: no single literal grep
enumerates this population, because the discriminator is a *concept* ("is this
node a `<program>` element") spread across five spellings and three IR layers
(tokenizer/block-splitter, ast-builder, post-AST passes). The lasting fix is a
shared predicate, which is what `nested-program-kind.ts` started and what this
round extends with `program-root.ts`.

### The 31 mandated sites, audited

Columns: **root?** = does it need the document-root/nested discriminator ·
**over-claim?** = does it currently key on `name=` (or a depth proxy) to decide
something `name=` does not decide.

| # | Site | Decides | root? | over-claim? | Action |
|---|---|---|---|---|---|
| 1 | `compute-program-config.ts:105` | auth/session config from the root `<program>` | already root-by-position (top-level array `.find`) | no | none |
| 2 | `gauntlet-phase1-checks.js:547` `isProgramRoot()` | is the immediate PARENT a `<program>` (placement msg) | **misnamed** — it is `isProgram`, not `isProgramRoot`; nested is a legal parent too, so the behaviour is right and only the name lies | no | rename-only; not taken (cosmetic, out of scope) |
| 3 | `gauntlet-phase1-checks.js:682` | nearest-enclosing `<program>` for `schema` entries | intentionally ANY program (closest-wins) | no | none |
| 4 | `auth-graph.ts:690` `findProgramNode` | the root `<program>` for gate analysis | already root-by-position | no | **comment is FALSE**: "`<program>` never nests in scrml" — §4.12 is the whole nesting section. Corrected. |
| 5 | `auth-graph.ts:1182` | is a type decl inside ANY `<program>` subtree | intentionally any | no | none |
| 6 | `reachability/entry-points.ts:219` `findRootProgram` | entry point | already root-by-position | no | none |
| 7 | `route-inference.ts:1138` | suppress `E-ROUTE-001` in worker bodies | **YES** | **YES — `hasName` ⇒ worker** | **MEDIUM-3. Fixed.** |
| 8 | `tool-program.ts:37` `isProgramMarkup` | feeds `findTopLevelProgramNode` | already root-by-position (first of top-level array) | no | none |
| 9 | `usage-analyzer.ts:441` | telemetry: `programDocAttrs`, `idempotency-store` | any program, deliberate | no | none |
| 10 | `emit-html.ts:925` | scope boundary push | any program — §6.7.2 makes EVERY `<program>` a scope root | no | none |
| 11 | `emit-html.ts:2340` | skip an EXTRACTED nested subtree | **YES — `programDepth >= 1`** | no (already on the shared kind predicate) | **HIGH-1 instance. Fixed.** |
| 12 | `symbol-table.ts:10080` | `childProgramDepth` feeder | **YES** (feeds 13 + 14) | no | **HIGH-1 instance. Fixed.** |
| 13 | `symbol-table.ts:10106` | `pageDepth` reset at a nested `<program>` | **YES — `programDepth >= 1`** | no | **HIGH-1 instance. Fixed.** |
| 14 | `symbol-table.ts:10129` | `E-CHANNEL-INSIDE-NESTED-PROGRAM` | **YES — `programDepth >= 1`** | no (already on the shared kind predicate) | **HIGH-1 instance. Fixed.** |
| 15 | `emit-theme-reset.ts:94` | "the" `<program>` node for `<theme>` reset | **YES** — it takes the FIRST program in a FULL-TREE walk, so in a `<page>`-rooted file a nested `<program name="w">` becomes "the program" | no | **NEW over-claim found by this sweep. Fixed.** |
| 16 | `type-system.ts:7917` `hasProgramDbAttr` | `E-AUTH-005` server-context gate | already root-by-position | no | pre-existing gap surfaced (a `<page>`-rooted file's `db=` is invisible to it); NOT fixed — outside the arc |
| 17 | `type-system.ts:21653` `resolveProgramLang` | top-level `lang=` for `_{}` | already root-by-position | no | none |
| 18 | `type-system.ts:22367` | `capabilities=` closest-wins | intentionally any | no | none |
| 19 | `emit-server.ts:817` | `_dbScope` -> server driver map | keys on the `_dbScope` ANNOTATION, not on tag shape | no | none (but see MEDIUM-2 — it was never REACHING the named form) |
| 20 | `emit-server.ts:2286` | `session-secure=` | full walk; a nested `<program session-secure=>` outranks the root's `<page>` | no | surfaced, NOT fixed — outside the arc |
| 21 | `ast-builder.js:19234` `hasProgramRoot` | W-PROGRAM-001 | already root-by-position | no | none |
| 22 | `ast-builder.js:19245` | `E-MW-002` ratelimit format | already root-by-position | no | none |
| 23 | `ast-builder.js:19503` | `W-PROGRAM-REDUNDANT-LOGIC` | any `<program>`/`<page>` — correct, §40.8 covers both | no | none |
| 24 | `ast-builder.js:19549` | `<theme>`/`<defaults>` placement | any program — §65.9 "program-scope" reaches a nested one | no | none |
| 25 | `ast-builder.js:19654` | `W-PROGRAM-SPA-INFERRED` | already root-by-position | no | none |
| 26 | `codegen/index.ts:1426` | splice / register worker / refuse | **YES — `programDepth >= 1`** | no | **HIGH-1 PRIMARY. Fixed.** |
| 27 | `codegen/index.ts:1585` `detectNestedDocAttrs` | `W-PROGRAM-TITLE-NESTED` | **YES — `depth >= 1`** | no | **NEW HIGH-1 instance found by this sweep. Fixed.** |
| 28 | `codegen/index.ts:1673` `annotateDbScopes` | `_dbScope` + §44.2 driver | no (the root `<program db=>` legitimately gets a scope) | **YES — `dbAttr && !nameAttr`** | **MEDIUM-2. Fixed.** |
| 29 | `codegen/index.ts:1777` | `_dbScope` consumer | keys on the annotation | no | none |
| 30 | `codegen/index.ts:2382` | §40.7 head metadata | already root-by-position | no | none |
| 31 | `types/ast.ts:239` | *(prose comment)* | — | — | none |

### The 10 sites the mandated grep does not reach

| Site | Spelling | Decides | Verdict |
|---|---|---|---|
| `codegen/index.ts:1556` | `tag !== "program"` | `W-PROGRAM-TOP-LEVEL-NAME` | **HIGH-1's third named instance** (the `return`-after-first). **Fixed.** |
| `emit-html.ts:2049`, `:2819` | `tag !== "program"` | default-logic-mode / render-slot carve-outs | any program; correct |
| `channel-watches.ts:284` | `(tag ?? "") === "program"` | §44.2 driver for channel watches | first program in a full walk — **same shape as #15**, but it reads `db=` and returns on the first HIT, so a `db=`-less nested program does not divert it. Benign today; noted. |
| `api.js:1973` | `(tag ?? "") === "program"` | dbDriver fallback | top-level array `.find` — root-by-position; correct |
| `symbol-table.ts:9941` | `(tag ?? "") === "program"` | `_hasProgramElement` (Insight-30 pure-channel-file dispensation) | intentionally ANY program anywhere; correct |
| `symbol-table.ts:10734` | `nodeTag === "program"` | shell scope for `E-OUTLET-AND-MAIN` | intentionally any program (a nested one opens a new shell); correct |
| `ast-builder.js:1236` | `block.name === "program"` | pre-AST program-root flag | block-splitter layer, root-by-position; correct |
| `ast-builder.js:2868` | `tagName.toLowerCase() === "program"` | pre-AST opener detection | any; correct |
| `block-splitter.js:3381` | `tf.name === "program"` | program-body detection | any; correct |

### Sweep verdict

**Three NEW defect sites this sweep found that the brief did not name:**
`codegen/index.ts:1585` (`detectNestedDocAttrs`), `emit-html.ts:2340` (the
`emit-html` half of HIGH-1), and `emit-theme-reset.ts:94` (first-program-in-walk).
Plus `symbol-table.ts:10080/:10106/:10129` as the symbol-table half of HIGH-1.

**One false comment corrected:** `auth-graph.ts:690` asserts "`<program>` never
nests in scrml".

**Two pre-existing gaps surfaced, deliberately NOT fixed** (outside the arc, no
nested-`<program>` artifact consequence): `type-system.ts:7917` and
`emit-server.ts:2286`.

---

## Item 1 — HIGH-1, the dangling worker BINDING

### Reproduction on the r2 tip — EXECUTED, not read

The brief's fixture verbatim, compiled at `55c87868`:

```
Compiled 1 file in 107.2ms   exit 0, ZERO diagnostics
client.js:19   _scrml_worker_w.send({v: _scrml_cs_reactive_get("v")});
0 files matching *.worker.js
node --check .../h1-page-worker.client.js   PASSES
```

`node --check` passing is the whole reason this class is invisible to
`--validate-emit`: a dangling free identifier is legal JS until it is EVALUATED.
So the proof has to reach the call site. happy-dom + the REAL emitted runtime +
the real emitted HTML body + a stub `Worker` that records constructions, then
click the button:

```
r2 tip   PROBE { buttonFound: true,  loadError: null,
                 thrown: ["ReferenceError: _scrml_worker_w is not defined"],
                 workerRequests: [], workerFilesOnDisk: [] }
r3 HEAD  PROBE { buttonFound: true,  loadError: null,
                 thrown: [],
                 workerRequests: ["h1-page-worker.w.worker.js"],
                 workerFilesOnDisk: ["h1-page-worker.w.worker.js"] }
```

`workerRequests` is load-bearing in the green half: without it a passing
`thrown: []` could just mean the handler never ran.

One methodology note, since round 2's own probe was where this went wrong: the
runtime and the client bundle MUST be evaluated in ONE scope. The runtime's
top-level `const`s are eval-local, so evaluating the two separately produces
`ReferenceError: _scrml_reactive_set is not defined` — a FALSE positive that
looks exactly like the real bug.

### THE DISCRIMINATOR — root-nodes MEMBERSHIP, and why not the alternative

The brief offered two: seed the depth to 1 when the file has no top-level
`<program>`, or identify the root by node identity. **Neither, quite — the right
predicate is membership of the file's ROOT NODES ARRAY**, which is the identity
option generalised so that it is TOTAL.

New module `compiler/src/program-root.ts`. A `<program>` is TOP-LEVEL iff it is a
member of the root nodes array; every other one is NESTED, whatever encloses it.

Why not depth-seeding, in order of weight:

1. **It is not total.** It fixes the `<page>`-rooted file and leaves a SECOND
   top-level `<program name="w">` sibling at depth 0 in a file that DOES have a
   root `<program>` — still unclassified, still silent. Membership classifies
   every `<program>` in the file, with no third state.
2. **Depth is walk-relative; identity is not.** The counter has to be re-derived
   correctly at each of the six sites that track it, and it was not — the same
   off-by-one shipped in `codegen/index.ts`, `emit-html.ts` and `symbol-table.ts`
   independently. A `Set` computed once cannot be re-derived six ways.
3. **It matches the convention already in the tree.** Ten sites in the sweep
   already locate the root with a top-level-array `.find` (`hasProgramRoot`,
   `findTopLevelProgramNode`, `findRootProgram`, `entryProgramNode`, …). A
   SECOND, differently-shaped notion of "root" is precisely the drift this arc
   exists to stop.

**And it is what SPEC says**, once the ambiguity is removed. §4.12.2: "The
compiler SHALL NOT treat a top-level `<program name=>` as a nested execution
context: the extraction pre-pass of §4.12.8 applies to nested `<program>`
elements only." Round 2 wrote "top-level" without defining it, and the whole
defect lived in that gap. §4.12.2 now defines it normatively, requires the
classification to be TOTAL, and explicitly forbids the ancestor-count
formulation.

`programDepth` is RETAINED in `symbol-table.ts` for `E-CHANNEL-OUTSIDE-PROGRAM`,
which genuinely IS a depth question ("does this channel have any `<program>`
ancestor at all"). Replacing that one too would have been a different bug.

### Six sites converted

| site | decides |
|---|---|
| `codegen/index.ts` `extractWorkerPrograms` | splice / register worker / refuse |
| `codegen/index.ts` `detectNestedDocAttrs` | `W-PROGRAM-TITLE-NESTED` |
| `codegen/index.ts` `detectTopLevelProgramName` | dropped the `return`-after-first |
| `codegen/emit-html.ts` | skip an extracted nested subtree |
| `symbol-table.ts` `walkChannelPlacement` | `E-CHANNEL-INSIDE-NESTED-PROGRAM` + `<page>` scope reset |
| `codegen/emit-theme-reset.ts` | which `<program>` owns the §65.3.4 reset |

The last three were found by the sweep, not by the brief.

### The three instances, measured

**Instance 1 — `<page>`-rooted worker WITH `.send()`.** Above. Closed.

**Instance 2 — `<page>`-rooted worker with NO `.send()`.** The brief predicted
"worker body silently discarded, `<body>` renders an empty region". Measured, the
mechanism was the OPPOSITE of that description and equally wrong: the subtree was
NOT discarded, it was RETAINED and rendered INTO the parent page —
`<span>worker body markup</span>` appeared in the emitted `<body>` — while no
bundle was produced. Same root cause (depth 0 means not nested, so neither
extracted nor skipped), opposite symptom. Now: bundle written, markup absent from
the page.

**Instance 3 — a SECOND top-level `<program name="w">` sibling.** Now fires
`W-PROGRAM-TOP-LEVEL-NAME`, and is NOT extracted. Both halves are what §4.12.2
says literally: it IS top-level (a member of the root nodes array), so `name=` is
inert there for exactly the reason the root's is — there is no enclosing
`<program>` that could reference it by name — and the §4.12.8 pre-pass "applies
to nested `<program>` elements only".

> **Instance 3 is IMPROVED, NOT CLOSED.** See RESIDUAL R1 below. The warning
> fires, but the parent's `<#w>.send()` still emits a dangling
> `_scrml_worker_w`. The arc's standing guarantee "every worker binding used is
> declared" does NOT hold for this shape, and closing it needs a code-set
> decision I did not take. This is the one place I am handing back an open
> ReferenceError.

### A fourth site the sweep found, which the HIGH-1 fix EXPOSED

`emit-theme-reset.ts` took "the first `<program>` in a FULL-TREE walk" as the
document root. Measured, on a `<page>`-rooted file holding a §4.12.6
`<program db=>`:

```
BEFORE  dist/ = [client.js, css, html, runtime]     a .css the file should not have
AFTER   dist/ = [client.js, html, runtime]
CONTROL the identical <page> with NO nested <program>: [client.js, html, runtime]
```

§65.3.4 emits the reset `@layer` "only when the file declares a `<program>` (the
reset is a program-level, app-wide concern)" — meaning the DOCUMENT ROOT. A
nested execution context was standing in for a root the file does not have. The
opt-out inverted the same way: `reset="none"` on a NESTED `<program>` suppressed
the reset for the entire document.

I found this because the HIGH-1 fix made the `.css` DISAPPEAR from the
page-rooted-worker output, which read like a regression until the control was
compiled. Worth recording: the disappearance was the CORRECTION.

### Two-sided bite proof — `nested-program-root-discriminator.test.js`

10 tests. Verified by checking the five source files out at `55c87868` and
re-running: **8 BITE, 2 are deliberate regression guards.**

| test | r2 behaviour |
|---|---|
| worker binding USED is DECLARED | `dangling: ["_scrml_worker_w"]`, `declared: []` |
| bundle on disk with a real `onmessage` | 0 `new Worker` refs |
| EXECUTED: click reaches the worker | `ReferenceError: _scrml_worker_w is not defined` |
| nested worker with no `.send()` leaves the DOM | `<span>worker body markup</span>` rendered into the page |
| 2nd top-level `name=` fires the warning | `[W-PROGRAM-REDUNDANT-LOGIC, W-PROGRAM-SPA-INFERRED]` only |
| `W-PROGRAM-TITLE-NESTED` on a `<page>`-rooted nested `title=` | `[]` |
| `E-CHANNEL-INSIDE-NESTED-PROGRAM` on a `<page>`-rooted worker | **`E-CHANNEL-INSIDE-PAGE`** — the WRONG code |
| nested `db=` does not own the CSS reset | emits `app.css`; the control does not |
| *(guard)* 2nd top-level is NOT extracted | held on r2, must keep holding |
| *(guard)* the document root stays diagnostic-free | held on r2, must keep holding |

The channel row is the most informative red half: on r2 the shape did not go
undiagnosed, it was MISdiagnosed — `E-CHANNEL-INSIDE-PAGE` instead of
`E-CHANNEL-INSIDE-NESTED-PROGRAM` — because the `<page>` placement scope was not
reset either. Two consequences of one counter.

### Corpus blast radius: ZERO, and that is not a defence

All 13 nested `<program>` tags across the 2372 tracked `.scrml` sit under a
`<program>` ROOT. Nothing exercised the `<page>`-rooted path, which is why
nothing caught it. §40.8 route files are `<page>`-rooted BY CONSTRUCTION, so the
first adopter to colocate a worker with a route would have hit it on their first
click. Recorded in the test file header so the zero cannot later be read as
evidence the shape does not matter.

---

## Item 3 — MEDIUM-2, the named scoped-DB context

Reproduced exactly as the brief states:

```
BEFORE  <program db="mongodb://localhost/analytics">                  E-SQL-005, FAILED
        <program name="analytics" db="mongodb://localhost/analytics">  silent, exit 0
AFTER   both  E-SQL-005, FAILED
```

`annotateDbScopes` gated on `dbAttr && !nameAttr`. §4.12.3's table spells the row
`Scoped DB context | name= (optional), db=` — optional, not absent.

Gate now keys on the shared `classifyNestedProgram`, not on the attribute pair,
so it cannot drift from the extraction decision: a `db=` co-occurring with
`mode=` or `route=` classifies as THAT context and is refused, never silently
read as a scoped DB. Pinned by a new precedence test.

**A stale test had to be INVERTED, in the same commit.**
`compiler/tests/unit/program-db-driver-resolution.test.js` §H asserted "named
program (with name=) does NOT get `_dbScope`", rationale: *"if name= is present,
the program is a worker, not a DB scope"* — verbatim the `name=`-keyed over-claim
this arc corrected in round 2. The commit gate caught it; it now pins the
corrected behaviour.

**Characterised honestly, NOT over-claimed.** Restoring the annotation restores
§44.2 driver resolution outright (proven above). The downstream `?{}` re-scoping
has its OWN pre-existing gap: a `?{}` inside a `server function` in a scoped-DB
subtree lowers to `_scrml_sql.unsafe(...)` on the PARENT's var. I checked whether
that is something I broke — it is not, the ANONYMOUS form does the same:

```
diff (named server.js) (anonymous server.js)    IDENTICAL
```

So the two spellings are now at parity, and the re-scoping gap is a separate
pre-existing defect (RESIDUAL R3), not part of this item.

Mirror site surfaced, deliberately NOT fixed (pa.md defers self-host):
`compiler/self-host/cg-parts/section-assembly.js:1968`.

---

## Item 4 — MEDIUM-3, the suppression that made another diagnostic LIE

`collectWorkerBodyFunctionIds` keyed on `hasName`. The brief's table, reproduced
on REAL COMPILES (not synthesised ASTs — see below for why that matters):

| fixture | BEFORE | AFTER |
|---|---|---|
| top-level `<program>` (control) | fires | fires |
| top-level `<program name="w">` | **SILENT** | fires |
| nested `<program name="analytics" db=>` | **SILENT** | fires |
| nested `<program db=>` (no `name=`) | fires | fires |
| nested `<program name="w">` (real worker) | silent | silent |

Row 2 is the one that reaches beyond its own blast radius.
`W-PROGRAM-TOP-LEVEL-NAME` tells the author `name=` on the root "has no effect
and is ignored"; while this suppression stood that was FALSE — the attribute had
the very large effect of disabling `E-ROUTE-001` for every function in the file.
**A diagnostic that lies is worse than no diagnostic.** Fixing this is what makes
the warning true, and item 5's severity argument depends on it. The dependency is
now written into both the code comment and the §34 row, so a future change that
gives root-`name=` behaviour again is told to revisit the severity.

Row 3 is where it bit hardest: a §4.12.6 subtree compiles INTO the parent and its
`?{}` reaches a real database, so silencing the server-escalation analysis there
is precisely backwards.

Predicate is now the tightest one that carries the isolation argument: NESTED
**and** classified `inline-worker`. The other extracted contexts are deliberately
NOT suppressed — they are refused at compile time anyway, and firing is the
fail-closed direction.

### The synthetic fixture that kept a broken predicate green

`route-inference.test.js` §25 has covered this suppression since Bug 2, and it
passed against the broken predicate throughout. Cause: `makeWorkerFileAST` placed
the worker `<program name=>` at the **ROOT of the nodes array**, alongside the
top-level logic block — a shape no parser emits. A synthetic AST that is
unconstructable from source cannot pin a nesting rule; it will agree with
whatever the implementation happens to do. Helper corrected to nest the worker
inside a document-root `<program>`, and the new coverage compiles real source.

Two-sided: 5 tests, **2 bite** (rows 2 and 3), 3 are guards.

---

## Item 5 — MEDIUM-4, the citation that does not exist

Both halves verified INDEPENDENTLY rather than relayed:

```
grep -rn 'W-STORY-ON-TOP-LEVEL' compiler/src/     2 hits, BOTH inside the
    comment making the citation. ZERO fire sites.
SPEC.md:35592   "`story=` on the top-level `<program>` SHALL emit
    W-STORY-ON-TOP-LEVEL and SHALL be ignored"   — no MUST NOT anywhere.
SPEC.md:19231   the §34 row: no emitter provenance, no spec-ahead marker.
SPEC-INDEX §58  "Nominal section — spec-ahead-of-implementation".
```

An unimplemented code is not a precedent, and the conditions are not parallel.

The verdict stays `warning`. The argument that carries it, from enumerating
SPEC's attribute prohibitions and their §34 severities:

| condition | SPEC phrasing | severity |
|---|---|---|
| `<page route=>` | "SHALL NOT carry"; regresses filesystem inference AND collides with nested-program `route=` | `E-PAGE-ROUTE-ATTR-FORBIDDEN` |
| `<page>` outside the five per-route attrs | not in the allowed set | `E-PAGE-INVALID-ATTR` |
| `onclient:*` handler declared `server function` | "SHALL NOT be declared" | `E-CHANNEL-006` |
| documentary attrs on a nested `<program>` | "MAY be present syntactically but SHALL NOT emit any HTML" | `W-PROGRAM-TITLE-NESTED` |
| `story=` on the top-level `<program>` | "SHALL be ignored" | `W-STORY-ON-TOP-LEVEL` |

**The discriminator is INERT vs WRONG, not MUST-NOT vs not.** Every Error is a
case where honouring the attribute would do something WRONG; every warn-and-ignore
is one where SPEC describes the attribute as INERT.

`name=` at the root settles it by itself: §4.12.2 phrases it as a genuine **MUST
NOT** and, in the same paragraph, pairs it with "SHALL emit … and SHALL be
ignored". A MUST-NOT-keyed rule would have to call that SPEC text
self-contradictory; inert-vs-wrong reads it straight.

Landed in the code comment, the §34 row, and the §4.12.9 row (which cross-refs
rather than restating). The §34 row also drops its now-stale "the pre-pass is now
depth-aware" claim and records "fires on EVERY top-level `<program name=>`".

---

## Item 6 — the LOW items

### LOW-6 — a declaration the author did not make

```
BEFORE  `<program name="x">` declares the §4.12.3 WASM COMPUTE MODULE execution context…
AFTER   `<program name="x">` carries `mode="native"`, which is not a recognized
        execution mode. SPEC §4.12.2 defines `mode=` as `"wasm"` … and "omitted
        for sidecar processes" — those are the only two spellings. …
        Fix: drop the `mode=` attribute to declare a §4.12.4 inline worker …;
        or correct it to `mode="wasm"` and wait for the WASM context.
```

Same code (item 7 forbids changing the code set). Gated on the VALUE, so
`mode="wasm"` keeps the original context message — pinned by a guard test.

### LOW-7 — FIVE missing, and only THREE should be registered

The brief named `route=`, `port=`, `health=`. Compiling §4.12.2's table against
the registry found `protect=` and `story=` missing the same way.

**Registering all five is the obvious move and it is WRONG for two of them.** The
commit gate caught it: `program-attrs-registry.test.js` pins
`<program protect="x">` to `W-ATTR-001` with the comment "(S80 retired)".

Applying the SAME inert-vs-wrong discriminator this round just banked for item 5:

| attr | verdict | why |
|---|---|---|
| `route=` | REGISTER | drives `E-NESTED-PROGRAM-CONTEXT-NOMINAL`; W-ATTR-001's "no compile-time effect" is FALSE and self-contradictory |
| `port=` | REGISTER | a live DISCRIMINATOR in `nested-program-kind.ts` — it decides whether a worker bundle is emitted at all |
| `health=` | REGISTER | rides the §4.12.5 sidecar declaration, whose refusal §23.4 does emit |
| `protect=` | **NOT** | RETIRED from `<program>` in S80. §38:21348: the field-level surface "remains on `<db>` and `<Type>` declarations per §6.12.1 and §52". Registering would silently reverse a ratified retirement. §4.12.2's table row is STALE SPEC that outlived S80 (RESIDUAL R2) |
| `story=` | **NOT** | §58 is Nominal and `W-STORY-ON-TOP-LEVEL` has ZERO fire sites, so nothing reads it. W-ATTR-001 is TRUE and is the only signal the author gets. Silencing it would be fail-OPEN on an unimplemented attribute — the exact shape §4.12.3 normatively forbids |

Measured:

```
BEFORE  <program name="api" route="/api/v1">    W-ATTR-001 ("no compile-time effect")
                                            AND E-NESTED-PROGRAM-CONTEXT-NOMINAL
                                                ("declares the SERVER ENDPOINT execution context")
AFTER   E-NESTED-PROGRAM-CONTEXT-NOMINAL only
```

**A THIRD list exists and agrees with neither.** `ast-builder.js:19383`
`NESTED_PROGRAM_ATTRS` has `protect`+`health` but not `route`/`story`;
`migrate.js:1272` is a fourth spelling. Surfaced (RESIDUAL R4), not unified —
unifying them is a separate change with its own blast radius.

### LOW-8 — coverage notes, including the reviewer's correction

Verified at `conformance/run.ts:203`: `notCodes` ARE checked unconditionally, so
`foreign-sidecar-no-worker` is NOT inert — its forbidden codes bite. What the
codes-only harness cannot observe is ARTIFACT PRESENCE, which is exactly what
`inline-worker-emits-bundle` (`codes: []`, no runtime half) fails to verify
despite its name. Both descriptions now say so and name the integration tests
that carry the artifact half.

---

## Item 7 — the two defects, closed WITHOUT touching the code set

```
BEFORE  <program name="ml" lang="go" build= port= health=>   exit 0, ZERO diagnostics, body discarded
        <program name="api" route="/api/v1" lang="go">        exit 0, ZERO diagnostics
AFTER   both  E-NESTED-PROGRAM-CONTEXT-NOMINAL, FAILED
```

The second is worse than a missing diagnostic: `lang=` outranks `route=` in
§4.12.3's exclusive precedence, so ADDING `lang=` LAUNDERED a `route=` server
endpoint past the refusal that shape gets when spelled `route=` alone.

Root cause: the §23.4 carve-out was UNCONDITIONAL. Its justification — "§23.4
already fails the sidecar closed at the `use foreign:` site, and two errors on one
unbuilt shape is two diagnostics for one mistake" — holds only when there IS a
`use foreign:` to fire at. With none, the carve-out suppressed the ONLY
diagnostic.

Carve-out is now CONDITIONAL, and the invariant is stated as what it always
should have been — **ONE DIAGNOSTIC PER UNBUILT DECLARATION, never two, never
none**:

| shape | fires |
|---|---|
| sidecar WITH `use foreign:` | `E-FOREIGN-SIDECAR-NOMINAL` (§23.4), only |
| sidecar WITHOUT `use foreign:` | `E-NESTED-PROGRAM-CONTEXT-NOMINAL`, only |

All four combinations compiled and checked; the CLAIMED case still emits exactly
one code (the double-fire guard the ratified carve-out exists for).

§4.12.3's normative sentence already reads this way — it names the two
diagnostics with an "or", expecting one of them. That "or" is now stated as
normative in BOTH directions.

**SCOPE HELD.** The consolidation question — whether the two codes are one
concept split by fire site — is with the operator and is NOT decided here.
Neither code is consolidated, retired or re-scoped; only the CONDITION each fires
on was made precise. Stated explicitly in the §34 row so a later reader cannot
mistake this for the consolidation ruling.

**TWO ROUND-2 EXPECTATIONS HAD RATIFIED THE SILENCE, and both were corrected:**

- `conformance/cases/nested-program/foreign-sidecar-no-worker` declares a sidecar
  and never `use foreign:`s it, yet asserted `E-NESTED-PROGRAM-CONTEXT-NOMINAL`
  **absent**. Now asserts it PRESENT. New sibling case `foreign-sidecar-claimed`
  pins the other half, so the pair encodes the invariant from both sides rather
  than as an unconditional exemption.
- `nested-program-execution-context-gate.test.js`'s "the sidecar declaration does
  NOT also fire …" ran on the same unclaimed fixtures. Split into a CLAIMED test
  (with `use foreign:` fixtures added) and an UNCLAIMED test.

---

## VERIFICATION BAR

### Execute, don't grep — HIGH-1

Done, above. happy-dom + real runtime + real emitted HTML + stub `Worker`;
`ReferenceError` on the red half, a recorded `workerRequests` entry on the green
half. `node --check` passes on the RED output, which is the reason a static gate
could never have caught this.

### The build-mode matrix — 40 builds, FOUR guarantees, ZERO violations

5 fixtures times 4 modes (flat / `contentHashAssets` / `emitPerRoute` / both)
times 2 directory shapes (flat and `pages/`-nested).

| guarantee | |
|---|---|
| G1 | every `new Worker("…")` names a file that EXISTS |
| G2 | every `.worker.js` on disk IS referenced |
| G3 | every client dial has a server route |
| G4 | every `_scrml_worker_X` USED is DECLARED (new this round) |

```
40 builds. VIOLATIONS: 0
```

G4 is checked PER BUNDLE, not per dist, because a declaration in one chunk does
not scope into another — a per-dist check would pass on a split that separates
the `new Worker` from its call site.

> **A blind spot in my own probe, found and fixed before reporting.** The first
> run showed `wkr 0, ref 1` for every `contentHashAssets` row — zero worker files
> yet a live reference, with G1 and G2 both reporting "ok". Under content hashing
> the bundle is `<base>.<name>.worker.<hash>.js`, so a
> `.endsWith(".worker.js")` predicate finds NOTHING and **G2 passed vacuously on
> 20 of the 40 builds**. Predicate corrected to `/\.worker(\.[a-z0-9]+)?\.js$/`;
> the re-run shows non-zero worker counts and genuine passes. Recorded because a
> probe that reports less than it measured is exactly how three sessions were
> lost earlier in this project.

### Suites

```
bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance
  22504 pass   70 skip   1 todo   0 fail

bun conformance/run.ts
  894/894 cases pass          (893 before; +1 new case foreign-sidecar-claimed)

bun scripts/s34-census.ts --check-new --base origin/main
  §34.0 gate: 8 new/changed §34 row(s), all well-formed — PASS
  (run AFTER the last SPEC edit, per the brief's warning)
```

Baseline at branch cut was 20982 pass / 0 fail on unit+integration. No
pre-existing failures to report — the tree was green before and after.

ENV-GAP ruled out up front: `bun install` + `bun run pretest` at step 0, so the
gitignored `samples/compilation-tests/dist/` phantom-failure class never arose.

### New tests

| file | tests | bite on r2 |
|---|---|---|
| `nested-program-root-discriminator.test.js` | 10 | 8 |
| `nested-program-scoped-db-named.test.js` | 4 | 1 |
| `nested-program-route-001-suppression.test.js` | 5 | 2 |
| `nested-program-attribute-surface.test.js` | 4 | 3 |
| `nested-program-sidecar-unclaimed.test.js` | 6 | 4 |

29 new tests, 18 of which fail on the pre-fix tree. The other 11 are deliberate
regression guards and are labelled as such in each file.

---

## RESIDUALS — round 3

### R1 (HIGHEST) — a dangling worker binding is STILL reachable. HANDED BACK.

The arc's standing guarantee **"every worker binding used is declared" holds only
when the name RESOLVES to a nested `<program>`.** Two shapes where it does not,
both measured on r3 HEAD:

```
A. second top-level <program name="w"> + <#w>.send() in the root program
   W-PROGRAM-TOP-LEVEL-NAME fires (warning, so exit 0 and the dist is written)
   `const _scrml_worker_w` declarations: 0
   `_scrml_worker_w` usages:            1        ReferenceError on click

B. a TYPO:  <#dubler>.send()  next to  <program name="doubler">
   ZERO diagnostics, exit 0
   declared: _scrml_worker_doubler
   used:     _scrml_worker_doubler, _scrml_worker_dubler   ReferenceError on click
```

B is PRE-EXISTING on main and untouched by this arc; A was silent+dangling on r2
and is now warning+dangling. **Neither is closed.**

Root cause is one thing, and it is not the discriminator: `<#name>.send()` is
lowered TEXTUALLY to `_scrml_worker_<name>.send(` very early (`tokenizer.ts:1190`,
`ast-builder.js:570`, `codegen/rewrite.ts:772`) with **no check that any worker of
that name was registered**. `emit-client.ts:2409` then declares bindings only for
`ctx.workerNames`. The two sides never meet.

**Why I did not close it.** The fix is a reference-site fail-closed check, and
there is no existing code for "unresolved nested-program reference" — closing it
means MINTING A NEW CODE (§34 row + SPEC + census). Item 7 of the brief sets the
discipline for exactly this situation: *"If you cannot close them without touching
the code set, stop and report rather than deciding."* I applied that here rather
than minting unilaterally.

**Recommended close, if PA rules for it:** a new error at the REFERENCE site,
firing only when the name matches NO nested `<program>` at all. That keeps
one-diagnostic-per-mistake — a name belonging to a Nominal context is already
refused at its declaration, so it must NOT double-fire — and it subsumes both
shapes plus the typo class. Roughly 30 lines next to `workerNames`, plus a §34
row. This is the last hole in the guarantee the arc exists to establish.

### R2 — §4.12.2's `protect=` row is STALE SPEC (post-S80)

§4.12.2 lists `| protect= | YES | Declares protected field names for data
isolation |`, but S80 retired `protect=` from `<program>`; §38:21348 records that
the surface "remains on `<db>` and `<Type>` declarations per §6.12.1 and §52", and
`program-attrs-registry.test.js` pins the `W-ATTR-001`. One of the two is wrong.
Not mine to decide — surfaced, deliberately not implemented. (Left unregistered,
so today's behaviour is unchanged.)

### R3 — `?{}` re-scoping does not reach a `server function` body

A `?{}` inside a `server function` in a §4.12.6 scoped-DB subtree lowers to
`_scrml_sql.unsafe(...)` — the PARENT's connection — for BOTH the named and the
anonymous spelling (verified byte-identical). §44.2 driver resolution and the
`_dbScope` annotation are now correct for both; the downstream consumer is not.
Pre-existing, separate from MEDIUM-2, and a data-correctness issue on its face:
a scoped-DB context silently queries the wrong database.

### R4 — four disagreeing lists of "nested-`<program>` attributes"

SPEC §4.12.2's table, `attribute-registry.js`, `ast-builder.js:19383`
`NESTED_PROGRAM_ATTRS`, and `migrate.js:1272`. No two agree. Same class as the
`tag === "program"` sweep: one concept, several hand-maintained copies.

### R5 — the sweep grep is itself the third generation of the same error

`tag === "program"` finds 31 code sites; the same test is spelled four other ways
across three IR layers, for **41** total. No single literal grep enumerates this
population. Bank the generalisation, not the grep.

### R6 (carried from round 2, unchanged) — a FAILED build still writes a complete dist

Round 3 adds more refusals, and every one of them still leaves a dist on disk. The
bytes are coherent in every case measured (the 40-build matrix), so the danger is
narrower than it was — but "we fail closed AND write the artifacts anyway" is a
contract nobody can rely on, and `api.js:2860`'s comment still asserts the
opposite of what the code does. Interacts with R1: shape A exits 0, so its
dangling-binding dist is written by DESIGN, not as a failed-build side effect.

### R7 (carried, unchanged) — worker-body token spacing

`self.postMessage( { result : twice ( data . value ) } )`. Parses, runs, does not
meet the readable-output bar. Structural fix is still "lower
`whenMessage.bodyExpr` instead of re-emitting a token join".

### R8 (carried from round 2) — self-host mirror

`compiler/self-host/cg-parts/section-assembly.js:1968` — the `!nameAttr` scoped-DB
gate, and now also the root-vs-nested discriminator, are stale in the self-host
mirror. pa.md defers self-host; surfaced only.

# ROUND 4 — 2026-08-22

## Step 0 — setup (DONE)

Branch `nested-program-r4-work`, cut from `origin/nested-program-r3-work` (tip
`9d9f30de`). `git rebase origin/main` was ABANDONED after 2 minutes at 3 of 24
commits — the merge backend re-checks out the whole tree per commit and would have
asked for the same generated-doc conflict resolution up to 24 times. The brief
admits either shape ("Rebase or merge — never file-delta"), so this line takes
`origin/main` (`a0e30329`) by MERGE instead: one resolution point, no rewrite of
the three rounds already reviewed.

One conflict, `docs/FACTS.md`, and it is entirely inside the
`@generated:facts-table` anchor (line counts, test-file count, conformance-case
count). Resolved by `--theirs` + `bun scripts/facts.ts --write`, per the standing
rule that a generated doc is regenerated, never hand-merged.

ENV-GAP ruled out first, both halves: `bun install` (a fresh worktree inherits no
`node_modules`) and `bun run pretest` (browser tests read
`samples/compilation-tests/dist/`, which is gitignored and therefore absent from a
fresh checkout). Baseline after the merge, from the pre-commit gate:
**28966 pass / 0 fail / 86 skip / 1 todo**, 1269 files, 261.97s.

## Item 1 precondition — what fires for a `use foreign:x` that nothing declares

The brief made this a gate on the retirement: *if an existing unresolved-name
diagnostic already covers it, retire cleanly; if nothing covers it, retiring the
code opens that hole.*

**Measured, not reasoned.** `.tmp/r4/ghost-use.scrml` — a `use foreign:ghost { run }`
with no `<program name="ghost">` anywhere in the file:

```
error [E-FOREIGN-SIDECAR-NOMINAL]: the `use foreign:ghost { ... }` sidecar declaration …
FAILED — 1 error, 3 warnings
```

That is the ONLY error. No `E-SCOPE-001`, no `E-IMPORT-005`, no unresolved-name
diagnostic of any kind — and by construction: `ast-builder.js`'s `foreign:` branch
deliberately KEEPS `names` in scope (so a `run(...)` call site does not
double-report) and deliberately leaves `source` null (so MOD skips resolution and
emits no `import … from "foreign:ml"`). Both suppressions are correct for their
own reasons, and together they mean the retiring code is load-bearing for a
condition that has nothing to do with Nominal-ness.

**So: the second case. Retiring alone WOULD open a hole — and the closure is
already ratified.** §23.4's normative statements say, verbatim:

> The `name` in `use foreign:name` MUST match the `name=` attribute of a nested
> `<program>` declared within the same top-level `<program>`. An unresolved name
> SHALL be a compile error (E-FOREIGN-010 …).

`E-FOREIGN-010` is catalogued in §34 (`§23.4 | `use foreign:name` references a name
that matches no nested `<program>` | Error`) and has **zero fire sites** —
`grep` over `compiler/src/`, `compiler/tests/`, `conformance/` returns exactly one
hit, and it is the ast-builder COMMENT saying `E-FOREIGN-010/011/012` supersede the
placeholder when the sidecar layer lands. So the hole is closed by implementing a
code SPEC already requires, not by minting one. This round makes that comment true
for the `010` third of it.

Note what this is NOT: it is not R1. R1 is the `<#name>.send()` WORKER binding
(`<#dubler>` typo, zero diagnostics), a different reference site with a different
resolution table, and it stays untouched per §4 of the brief.

## Item 2 red half — the r3 double-fire, reproduced on HEAD after the merge

`conformance/cases/capability/inheritance-inherit-covers/case.scrml`, unmodified:

```
error [E-FOREIGN-SIDECAR-NOMINAL]: the `use foreign:probe { ... }` … (line 3, col 9)
error [E-NESTED-PROGRAM-CONTEXT-NOMINAL]: `<program name="probe">` … and NOTHING IN
  THIS FILE CLAIMS IT: there is no `use foreign:probe { … }` declaration in the parent …
FAILED — 2 errors, 1 warning
```

Line 3 of that file is `use foreign:probe { run }`. The diagnostic asserts the
absence of a declaration the reader can see two lines up. Both halves of the r3
regression in one output: the invariant broken (two diagnostics for one unbuilt
declaration) and the message false.

## The red-half matrix — every §4.12.3 context, before any r4 edit

`.tmp/r4/*.scrml`, compiled through `compiler/src/cli.js`; `W-PROGRAM-SPA-INFERRED`
elided (fires on every single-file probe and says nothing about this arc).

| probe | shape | error codes BEFORE |
|---|---|---|
| `ghost-use` | `use foreign:ghost`, no declaration anywhere | `E-FOREIGN-SIDECAR-NOMINAL` |
| `p1-inline-worker` | §4.12.4, `name=` only | *(none — implemented)* |
| `p2-sidecar-claimed-parent` | §4.12.5 claimed from the PARENT | `E-FOREIGN-SIDECAR-NOMINAL` |
| `p3-sidecar-claimed-inside` | §4.12.5 claimed from INSIDE the subtree | `E-FOREIGN-SIDECAR-NOMINAL` + `E-NESTED-PROGRAM-CONTEXT-NOMINAL` ⛔ |
| `p4-sidecar-unclaimed` | §4.12.5, no `use foreign:` at all | `E-NESTED-PROGRAM-CONTEXT-NOMINAL` |
| `p5-wasm` | §4.12.3 `mode="wasm"` | `E-NESTED-PROGRAM-CONTEXT-NOMINAL` |
| `p6-server-endpoint` | §4.12.2 `route=` | `E-NESTED-PROGRAM-CONTEXT-NOMINAL` |
| `p7-launder-route-lang` | `route=` + `lang=` (the r2 laundering shape) | `E-NESTED-PROGRAM-CONTEXT-NOMINAL` |
| `p8-scoped-db` | §4.12.6 `db=` | *(none — implemented, stays in-tree)* |

Exactly one row is wrong, and it is the row the seam creates. Every other row
already satisfies one-diagnostic-per-unbuilt-declaration — which is the argument
for removing the seam rather than moving it a fourth time.
