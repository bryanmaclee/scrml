2026-10-09T16:03:01-06:00 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aa895def1d34d27b2
2026-10-09T16:06:52-06:00 RI onclient T7 exemption removed; TS E-CHANNEL-006 reads routeMap boundary; describeServerTrigger moved to escalation-reason-text.ts; probes t7/t1/t3 fire, ok compiles
2026-10-09T16:32:06-06:00 message names trigger (T1/T2/T3/T5/T7) + two fixes; T5 gets its own remedy; tried treating onclient attr as T5 client caller -> routes into open g-5c placement fork (server calls undefined ambient fn), REVERTED; unit tests channel-onclient-inferred-server.test.js (13) pass
2026-10-09T17:02:16-06:00 SPEC §12.2 T7 + §34 + §38.9 + §38.10.3 amended (widened E-CHANNEL-006 + example + provenance); 3 conformance cases; SPEC-INDEX/FACTS/bootstrap-conformance/gap-counts regenerated (master-list.md recent-sessions left stale — pre-existing, PA-owned); TYPES-BASELINE renamed 2 pre-existing diags; corpus 0 newly refused (2633 files); browser fail set == baseline (browser-baseline.ts parser glitch 48 vs 47, pre-existing harness issue); gaps g-bootstrap-no-channel-handler-checks-s462 + g-fn-purity-blind-to-channel-hub-calls-s462 filed

## FIX ROUND 1 brief (verbatim, received 2026-10-09T17:41-06:00)

FIX ROUND 1 for s462-channel-006-inferred — S239 review of adaa65a6c = LAND-WITH-NITS, plus a bryan ruling. Append this message verbatim to progress.md ("FIX ROUND 1 brief") and commit; fix on your branch; same process rules. Do NOT merge origin/main yet (the PA will say when).

R1 — bryan S462 "a" (user-voice §S462, last entries): a handler placed on the server ONLY by §12.2 Trigger 5 (caller-context) is EXEMPT from E-CHANNEL-006 for now — keep main's behaviour for that case exactly (artifacts identical to base). Every direct trigger (T1/T2/T3/T7/onserver) still refuses. Reviewer repro that must go back to BASE behaviour (exit 0, same artifacts as base):
```
<program>
${
  function fmt(e) { return 1 }
  server function boot() { return fmt(1) }
}
<channel name="c" onclient:open=fmt(e)>
    <joined> = 0
</>
<p>${@joined} ${fmt(2)}</p>
<button onclick=boot()>b</button>
</program>
```
(and the simpler `function onOpen` in the channel called only from `server function boot`). If a handler has a direct trigger AND T5, it is refused (name the direct trigger). Update §38.10.3 / §34 / the §12.2 T7 note: state the T5 exemption, its reason (route inference does not count an `onclient:` attribute or a markup reference as a client caller) and that it lasts until the g-5c caller-context fork is ruled. Update your unit test + conformance accordingly (a T5-only case now asserts NO E-CHANNEL-006).
GAP (file, with locus=): "an `onclient:` attribute or markup `${f()}` reference does not count as a CLIENT caller for §12.2 T5 — shared pure helpers are mis-placed on the server (socket open / render does a POST round-trip, §38.10.2 violation)"; link it to g-5c-caller-context-promotes-a-derived-read-helper-to-the-server.

F2 (accept + record): deleting the name-keyed exemption changes artifacts when two channels declare same-named functions (BASE bound `ws.onopen` and the button to the wrong channel's `onOpen`; HEAD binds correctly but `b`'s onOpen gains a server route + an unused fetch stub). HEAD is more correct — keep it; record the artifact change in progress.md + the SPEC-free changelog note, and FILE a gap for the pre-existing name-collision binding bug (name-keyed `collectChannelFunctionMap`, route-inference.ts Step 3 ~4929): two channels' same-named functions are not distinguished. Repro from the reviewer:
```
<program>
<channel name="a" onclient:open=onOpen(e)>
    <joined> = 0
    ${ function onOpen(e) { @joined = @joined + 1 } }
</>
<channel name="b">
    <hits> = 0
    ${ function onOpen(e) { broadcast({ hits: 1 }) } }
</>
<p>${@joined}</p>
<button onclick=onOpen(1)>go</button>
</program>
```
F3 (gap, pre-existing fail-open): `broadcast()` inside a NESTED function declaration within an onclient handler is not seen by `detectChannelBroadcastReason` (arrow lambdas are). Fix it if it's a small structural extension of the same walker (newly-rejecting → measure corpus; zero expected); else file with locus.
F4 (gap/doc): §12.2 T7 says it applies "NOT to `fn`", but impl#1 places a `fn` calling `broadcast()` on the server. Don't change behaviour; add the observation to g-fn-purity-blind-to-channel-hub-calls-s462.
F5 (SPEC wording): reword T7's scope clause ("NOT to `onclient:`/`onserver:` attribute handlers") so it no longer appears to contradict the new sentence after it.

Report: new FINAL_SHA; per item before/after (R1 artifact identity vs base proven); gates re-run.

## FIX ROUND 1 — work log
2026-10-09T18:10-06:00 R1: type-system.ts checkClientHandlerNotServer judges DIRECT reasons only (escalationReasons minus explicit-annotation minus caller-context-propagation); a T5-only handler is not judged; declared+T5 -> S461 declared message; direct+T5 -> refused naming the direct trigger. Base-vs-head artifact identity (diff -r of the full output dir; base = archive of 42d1a7459): reviewer repro `fmt` (r1a) IDENTICAL, exit 0/0; channel-body onOpen called only from `server function boot` (r1b) IDENTICAL; t5 (onOpen called only from a ?{} server fn) IDENTICAL; r1c (SQL body + T5) base exit 0 -> head exit 1, E-CHANNEL-006 "trigger: a `?{}` SQL query".
2026-10-09T18:10-06:00 F3 FIXED (not filed): detectChannelBroadcastReason now descends nested function-decl bodies (same rule as walkBodyForTriggers' nested ?{}). f3 (onclient handler with a nested broadcaster) base exit 0 (client calls undefined broadcast) -> head E-CHANNEL-006. f3b (plain channel publisher with a nested broadcaster, button-called) base: everything on the client calling undefined broadcast -> head: announce server-placed, `tell` + the §38.6 broadcast binding in server.js, client gets a fetch stub (silent fix; placement change).
2026-10-09T18:10-06:00 Corpus re-measured (2633 files, base 42d1a7459 vs head incl. R1+F3, now hashing html/css/clientJs/serverJs): E-CHANNEL-006 3 -> 3 (the S461 declared -err cases); artifacts byte-identical for all 1626 error-free files (artDiff 0); error-set diffs only in the 15 stdlib/compiler files (base-outside-repo E-IMPORT-008 artifact, as before); 1 identical crash both sides.
2026-10-09T18:10-06:00 F2 ACCEPTED + RECORDED (changelog note, artifact change): with two channels declaring `function onOpen` (reviewer repro), BASE bound `ws.onopen` and the button to channel b's broadcasting onOpen, emitted on the client calling an undefined `broadcast`; HEAD binds both to channel a's client onOpen (correct) and channel b's onOpen gains a server route `__ri_route_onOpen_1` + an unused client fetch stub. Cause: the deleted name-keyed onclient exemption also exempted b's same-named function. Gap filed: g-channel-same-name-functions-not-distinguished-s462. (docs/changelog.md is the PA's session log — not edited.)
2026-10-09T18:10-06:00 F4: observation appended to g-fn-purity-blind-to-channel-hub-calls-s462 (fn + broadcast IS server-placed despite T7's "NOT to fn"). F5: §12.2 T7 scope clause reworded (attribute VALUE vs the function it names; nested declarations count for the parent). SPEC §34/§38.9/§38.10.3/§12.2 state the T5 exemption + reason + "until the g-5c fork is ruled". Gap filed: g-t5-onclient-and-markup-refs-not-client-callers-s462 (MED, linked to g-5c). Conformance: +handler-onclient-inferred-t5-only-ok (notCodes E-CHANNEL-006), +handler-onclient-inferred-nested-broadcast (E-CHANNEL-006). Unit tests pass. Gates: conformance 1527/1592 + 65 xfail; types:check OK; state --check fails only on the pre-existing master-list recent-sessions.
