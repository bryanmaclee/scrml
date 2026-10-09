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
