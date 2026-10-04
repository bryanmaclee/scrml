# progress — s452-effect-summary (append-only)

- start: base 6538da913; bun install + pretest OK; BRIEF archived.

## M0 — shadow (effects.scrml + summarize + differential)

- MAP (`.claude/maps/primary.map.md`, stamp d3e660a08): read the bootstrap rows; NOT load-bearing — the
  DD's inventory (W1–W11 line ranges) was the operative map; every row re-read in source at 6538da913.
- DD-vs-code corrections (no step became ill-defined):
  1. W5 (clientReach) and W6 (unresolvedReach) do NOT use W3's edge set: they follow only FUNCTION
     references and STOP at a server callee ("judged on its own"); W5 also seals server callers. One
     uniform edge set (DD §"Recursion": "Build the call graph once … including the IMPLICIT edges")
     cannot reproduce their messages. The engine therefore closes each DIMENSION over its own edge
     list (a per-dimension policy over ONE graph, ONE fixpoint, ONE SCC order) — writes/writesOpen:
     every reference; client/routeOpen: function refs, server callees cut; waits: function refs;
     clock: function CALLS; noValue: `return <call>` edges.
  2. W1's clock set follows CALLS only (no function values). The M0 run found the difference (inline
     program in slice-m4/effect.test.js: `const g = ping` — a function value of a clock reader). The
     clock dimension follows calls (§48.6.2 is a rule about calls; a function value is refused in the
     bootstrap). Regression test in effects-shadow.test.js.
  3. The witness each walker reports is a BREADTH-FIRST one (fewest references, then earliest
     reference). The engine's atoms keep the shortest path per key under that order (depth, then
     the reference-index path lexicographically, then the own site) — proven equal by the shadow.
  4. The DD's `Fx` sketch has a `server` own dimension and `returns: Value|NoValue|Diverges`. Built:
     `server` = the own facts (sqls / modifier), not closed; `returns` = a `noValue` dimension (atoms,
     so the chain is available); nothing in the bootstrap produces `Diverges` — not built.
  5. The summary is NOT stored in `Tables` in M0–M3 (Tables is exported to lower; attaching Fx to Core is
     M5). It is a value analyze computes and hands to its passes.
- Built: `compiler/self-host-v2/effects.scrml` (237 L — FxAtom, path order, closeDim, Tarjan sccOrder,
  atomChain); analyze.scrml +502 L (summarize, own-fact helpers ownNoValue/retCallsOf, the shadow
  `effectsShadow`); `slice-m4/effects-shadow.test.js` (the differential over the 9 slice programs and
  every counter case as written + its §66 twin; G7 pinned; the clock-edge regression);
  `slice-m4/diag-diff.js` + the SCRML_BOOT_DIAG_LOG hook in `slice-m1/harness.js` (every `analyze`
  call of every slice test and counter case → one JSON line; also logs the shadow).
- RESULT: shadow test 5/5 (counter inputs: 0 disagreements). Hook run: every slice test + counter,
  2566 distinct analyze inputs, diagnostics IDENTICAL to base (6538da913); shadow disagreements over
  every inline test program: exactly 1 — `typer-s440.test.js` `function w() -> string { return u() }`
  (W9: walker yields, summary no value) = G7's second form, as expected.
- Slices: m1 99/0, m2 462/0, m3 60/0, m4 1105/0, codec 92/0, m1 lowered 99/0; counter PASS 120 /
  FAIL 48 / UNSUPPORTED 622 (= base); severity --check current; counter doc --check current; lint 0.
- Lines: +502 analyze (0 deleted), +237 effects.scrml, +27/-1 harness, test/tool +257.
