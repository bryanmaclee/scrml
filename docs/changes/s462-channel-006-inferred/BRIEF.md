# BRIEF — s462-channel-006-inferred

Change-id: `s462-channel-006-inferred`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree. Closes the remaining half of gap `g-channel-handler-args-emitted-raw-s460` part concerning E-CHANNEL-006 (read that gap; S461 AUTO resolved part 4 via PR #1379).

## The ruling (quote, do not reinterpret)
bryan, S462, "a" (scrml-support/user-voice-scrml.md §S462): E-CHANNEL-006 widens from "an `onclient:*` handler DECLARED `server function`" to "declared, OR placed on the server by §12.2" (e.g. §12.2 trigger 7: a `function` lexically inside a `<channel>` body calling `broadcast()`/`disconnect()`). The message names the two fixes: move the logic to an `onserver:*` handler, or write a channel cell instead (client-side sync, §38.4/§38.10). Direction: newly-rejecting. Provenance for the SPEC edit: `ruling:user-voice-scrml.md S462 "a"`.

## Governing text (read IN FULL first)
- SPEC §38.10.3 (the E-CHANNEL-006 sentence: "A function designated as the handler for an … SHALL emit E-CHANNEL-006 and reject the program") — amend to the widened wording; §38.9 table row + §34 row (grep `E-CHANNEL-006` in compiler/SPEC.md — there are 3+ mentions incl. a code example ~line 28388; update all consistently).
- SPEC §12.2 trigger 7 (grep "Channel `broadcast()` / `disconnect()` escalation") — note its scope clause; it says the trigger applies to standalone `function` declarations inside a channel body. Today, when such a function is ALSO named by an `onclient:*` attribute, it stays on the client silently.

## Reproducer (PA-verified on main afe2e9212)
`docs/changes/s462-channel-006-inferred/repro-onclient-broadcast.txt` (rename to .scrml in your scratch): compiles exit 0; `onOpen` lands in the CLIENT bundle calling bare `broadcast(...)`. Control (PA-verified): the same function called from a `<button onclick=…>` (no onclient attribute) IS escalated to a server route. After the fix: E-CHANNEL-006 at the attribute, exit non-zero.

## Scope
1. Find WHY route inference does not escalate a T7 function that is an `onclient:*` handler (PA hypothesis, unverified: an exemption in `compiler/src/route-inference.ts` around `detectChannelBroadcastReason` / `collectChannelFunctionMap`, or the handler being treated as client by construction). The E-CHANNEL-006 emitter is `compiler/src/type-system.ts` (~:15654-15770, PA-located-verify). The check must read the SAME placement decision §12.2 makes — do not write a second, parallel "does it broadcast" detector (two readers = a bypass). If type-system runs before RI, find the right stage to emit, or consume RI's reasons; report the design.
2. Cover every §12.2 trigger that can place a handler on the server (T1 SQL, T2/T3 server-only reach, T7 broadcast/disconnect, caller-context T5 if applicable) — test each that is constructible. Handlers that stay client (writes a channel cell, pure compute) MUST still compile.
3. Resolution across import / file top-level / channel body (the #1379 resolution path) — reuse it.
4. MEASURE corpus impact by compiling samples/ examples/ stdlib/ conformance/ + ../scrml-support/docs/gauntlets/gauntlet-r25/*.scrml base vs head; report every newly-firing site. Non-zero → report, do NOT migrate unilaterally.
5. Conformance cases (fires on inferred-server handler; silent on cell-writing handler). Regenerate SPEC-INDEX/FACTS/bootstrap-conformance as `--check` requires. Bootstrap twin: check `compiler/self-host-v2/` for E-CHANNEL-006; implement if small else file a gap with `locus=`.
6. File a NEW gap in docs/known-gaps.md (with `locus=` or `searched:`): `I-FN-PROMOTABLE` suggests promoting a `broadcast()`-calling `function` to `fn` (the repro shows it) — a side-effecting channel hub call is not pure. Do not fix it unless trivial and obviously correct; report.

## In-flight siblings (expect shared-file merges at landing; the PA merges)
s462-given-presence-deprecate, s462-is-some-deprecate, s462-narrowing-ends-on-write — all touch SPEC §34 / §42 and generated docs. Stay in your loci.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-channel-006-inferred): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-channel-006-inferred/` · run the ci.yml browser-tier step + `bun run types:check` before reporting · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · files · root cause of the silent client placement · locus held/refined/wrong · triggers covered · corpus measurement · bootstrap disposition · direction-setting choices for bryan's veto.
