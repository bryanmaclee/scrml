# progress — s454 handler rejection root fix

- step 0: startup verified, base b35593879, bun install + pretest ok; BRIEF archived.
- step 1: map read (structure.map S453 inventory load-bearing for the 15-site list; it MISSES a 16th site: emit-variant-guard.ts in-arm non-delegable wiring, never coloured). Hypothesis CONFIRMED by probe: emit-event-wiring.ts:1188 fnNameMap.get pre-substitution is the ONLY pre-mangled site; `${}` form keeps author names and relies on emit-client post-fn-name-mangle pass (:3184). <each>/lift call-refs already wrap. Uncoloured call-ref sites: registry/non-delegable/arm-factory (event-wiring call-ref + formFor submit + bareRef `continue`), variant-guard arm non-delegable, channel onclient:*.
- decision: option (i) — emit author name, colour, let the post-pass mangle (same pipeline as `${}`).
- step 2: code+tests committed 3b086ecb7 (event-wiring call-ref/formFor/bareRef author-name + colour; variant-guard in-arm call-ref colour; B-2 async boundary). Gate 0 fail. Deferred: channel onclient:* (onclose reconnect ordering hazard), onserver:open/close server-side unlogged, arm non-delegable `${}` form uncoloured.
