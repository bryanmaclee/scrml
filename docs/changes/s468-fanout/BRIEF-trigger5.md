# unit-id: s468-trigger5-helper-route
Gap: `g-trigger5-server-only-function-helper-still-a-public-route-s464` (HIGH, security surface — a server-only helper
`function` reached only through caller-context promotion still gets a public route + client stub). Read its full entry.
Locus hypothesis (verify): compiler/src/route-inference.ts (runRI Step 5c caller-context promotion) +
compiler/src/codegen/emit-server.ts (route handler + client stub emitted for every server-boundary fn). Governing
sections: §12 (route inference; §12.2 triggers) — quote. Related landed work: a plain `fn` is never a route (S464);
#1435 CPS server-tier rules. ⚑ Concurrency: PR #1434 (branch s467-await-r10) and the s468 CPS unit also touch
emit-server.ts — keep your diff minimal and structural there; landing order is resolved at PR time.
Cover: helper reached only from server fns (no route), helper ALSO called from client code (route stays), helper
referenced as a first-class value (conformance server-db/first-class-fn-ref-server-helper-rt must keep passing),
exported helpers, and prove the route is gone at RUNTIME (a request to it 404s / is not registered).
