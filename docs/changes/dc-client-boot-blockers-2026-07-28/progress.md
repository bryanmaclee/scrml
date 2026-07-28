# LANE 1 — client-boot blockers (GH #234 + #235 + D-4) — progress log

## 2026-07-28 — startup

- WORKTREE_ROOT: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a1a9a7979fee6fd78
- toplevel == WORKTREE_ROOT: OK
- status --short: clean
- git merge main: "Already up to date."
- bun install: 217 packages
- bun run pretest: compiled 13 test samples -> samples/compilation-tests/dist/
- base HEAD: 19bb27be50f30c7a07bf411e5e336e8c05adf8a0
- NEXT: read maps section "Task-Shape Routing", then reproduce BUG A + BUG B empirically
  before touching source.

## 2026-07-28 — BUG A (GH #234) DONE — commit 839d3415

Reproduced on baseline: the 10-line adopter repro compiled, emitted runtime had
ZERO `_scrml_message_for` bytes while `repro.client.js:19` referenced it. Executed
the bundle in happy-dom: exact adopter stack, `ReferenceError: _scrml_message_for
is not defined at _scrml_cs_message_for ... at _scrml_boot`, errors anchor empty.

LOCUS CORRECTION vs the brief: the defect is NOT in `codegen/index.ts`. `index.ts`
L495/L528 are the CELL_SCOPE_ACCESSORS list + arity table — they are why the
`_scrml_cs_message_for` WRAPPER exists, and they are correct. The missing keep-mark
is in `codegen/emit-client.ts` `detectRuntimeChunks` / the post-emit gate block:
the `messages` chunk was gated ONLY on a state-decl validator carrying an
`inlineOverride` (the comment there still said the `<errors of=>` trigger was
"future, C11"). Fixed there — that layer covers BOTH `embedRuntime:true` (per-file
embedded runtime) and the shared-runtime union in `index.ts`, which derives from
per-file `ctx.usedRuntimeChunks`. A fix in `index.ts` would have missed the embed path.

Second, latent defect found + documented in the new comment: the emitted
`typeof _scrml_message_for === "function"` guard is DEAD. `_scrml_message_for` is a
CELL_SCOPE_ACCESSOR, so `cell-accessor-rename.ts` rewrites the identifier inside
`typeof` too; the prologue always defines `_scrml_cs_message_for`, so the guard is
always true and the fallback stub is unreachable. Left in place (harmless once the
chunk gate is right) but the reason is now written down at the gate.

Fix shape: demand-marking (NOT always-ship). `POST_EMIT_HELPER_CHUNK_GATES` gains
`["_scrml_message_for", "messages"]` — a REFERENCE-form entry, because the `<errors>`
wiring captures the helper as a value, never as a `_scrml_message_for(` call.

Payload check (the §C10.1 / gzip-budget constraint):
- `<errors>` page: runtime 82,763 B -> 95,448 B raw (27,858 B gzip -9). Correct: it
  now ships a chunk it actually references.
- no-`<errors>` page: 58,742 B, zero `_scrml_message_for` bytes. NO regression.

Regression test: `compiler/tests/browser/errors-element-messages-chunk-gh234.browser.test.js`
(6 tests). EXECUTION-based — loads the emitted tree-shaken runtime FILE and drives
`_scrml_boot` through an intercepted `DOMContentLoaded` registration, because
happy-dom swallows listener throws (a `dispatchEvent` harness is a false green).
Adversarially verified: with the fix stashed, 4 of 6 fail with the adopter's
verbatim stack.

## 2026-07-28 — BUG B (GH #235) DONE — commit 3d3be9a0

Reproduced on baseline with a 3-file MPA (`app.scrml` shell + `<outlet/>`,
`models/auth.scrml`, `pages/login.scrml`) — the adopter's evidence table exactly:

    dist/app.html    -> runtime · models/auth.client.js · app.client.js       OK
    dist/login.html  -> runtime ·                         app.client.js · login.client.js

Executed: `app.html` OK, `login.html` `TypeError: Cannot destructure property
'rolePath' from null or undefined value`.

Root cause (index.ts ~:2775-2850): MPA shell composition rebuilds the ENTIRE script
set from scratch after stripping the page's own tags, and emitted only the two
BUNDLES — dropping BOTH the shell's and the page's transitive dep sets. The shell's
own document was fine because it uses the per-file envelope path (~:2229) where the
deps ARE emitted.

Fix: emit both dep sets deps-before-bundle,
`shell deps -> shell bundle -> page deps -> page bundle`, de-duplicated by src.
`computeDependencyClientScripts` gains an optional `hostFilePath` so the SHELL's
deps are walked from the shell's graph but RESOLVED against the CHILD page's dist
dir (anchoring on the host avoids inheriting `upToRoot`'s "entry sits at dist root"
assumption; a nested route emits `../models/auth.client.js` correctly).

STOP-IF not triggered: the two bundles keep their pre-existing relative order —
this is purely additive, so the `<script>` ordering contract is unchanged.

Also fixed a PRE-EXISTING defect the reproducer surfaced (verified pre-existing by
compiling the same fixture with the fix stashed): the page-envelope script strip
removed a fixed TWO trailing tags — one short as soon as a page has its own dep —
so the page's un-prefixed runtime tag survived alongside the composition's own. At
dist root that is the same URL twice (the second classic `<script>` dies redeclaring
`_scrml_state`); from a nested dir the survivor 404s. Now a repeated-group
trailing-run strip, matching the shell-side strip 120 lines above.

Regression test: `compiler/tests/integration/mpa-shell-child-dep-scripts-gh235.test.js`
(8 tests) — pins relative INDEX not presence, covers leaf / own-dep / nested /
shared-dep-dedup / one-runtime, and EXECUTES all five composed documents with each
src resolved against its own directory. 6 of 8 fail on the pre-fix compiler.
Placed in `integration/` (13 integration tests already use GlobalRegistrator) so
the pre-commit gate covers it.

## 2026-07-28 — D-4 gap widening DONE — commit 2646b8ff

Empirically verified BOTH halves of `g-crossfile-dep-ref-pages-unstripped`:
- CLIENT half: ALREADY RESOLVED (S280 `toDistRel` strip). A nested route emits a
  resolving `../models/fmt.client.js`.
- SERVER half: LIVE, and it bites the single-segment `pages/` case the entry marks
  safe. `emit-server.ts:~1886` rewrites the raw AUTHOR specifier; `pages/login.scrml`
  importing `'../models/session.scrml'` emits `dist/login.server.js` line 4
  `import { currentRole } from "../models/session.server.js"` -> walks above dist ->
  runtime `Cannot find module`.

The two emitters share NO coordinate computation, so per the brief's conditional
only the gap widening was in scope. Entry now carries the reproducer, the exact fix
shape, and the input the fix needs (`fileAST._outputBaseDir`).

Also re-verified: sibling `g-nested-flatpage-runtime-bare-ref` STILL OPEN.

## 2026-07-28 — verification

Pre-commit gate (`unit + integration + conformance`): 21504 pass / 0 fail / 70 skip.
Full suite (`compiler/tests/`) base vs post-fix, both after `bun run pretest`:
- base (19bb27be src for the 2 touched files): 45 fail
- post-fix: 36 fail
- diff is ONE-DIRECTIONAL — the 9 removed entries are exactly this lane's new tests.
  ZERO new failures. The residual 36 are pre-existing whole-suite happy-dom
  global-state-leak failures (verified: the same 11/41 fail on base and post-fix when
  3 of those files are run together); none are in the pre-commit gate subset.

`docs/FACTS.md` is now stale (+101 src lines, +2 test files). DELIBERATELY NOT
committed — three lanes are landing in parallel and each would commit a different
whole-repo count. PA must run `bun scripts/facts.ts --write` ONCE after all lanes land
(the pre-push gate requires it).
