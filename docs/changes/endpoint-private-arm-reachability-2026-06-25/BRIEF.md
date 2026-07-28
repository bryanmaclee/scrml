# BRIEF — g-endpoint-private-arm-handler-tree-shaken (HIGH, §61.2 spec-vs-impl) — archived S136
Dispatched S220 to scrml-js-codegen-engineer, isolation:worktree, opus, bg. Agent `a52702d0ac8f9ea23`. change-id `endpoint-private-arm-reachability-2026-06-25`.

## Bug (ss18-W4 surfaced)
§61.2's "canonical" arm `<FleetStatus : fleetStatus()>` calling a non-exported `fn` → the fn is tree-shaken → emitted .server.js ReferenceError + misleading W-DEAD-FUNCTION. No "private server helper callable only from an endpoint arm" today.
## Fix (ss18 sketch)
DG (dependency-graph.ts collectAllMarkupNodes) + reachability (route-inference.ts markupReferencedNames) sweep endpoint-decl ARM bodies for callees → seed as reachability roots, GATED on endpoint-decl presence (tiny blast radius); emit-server value-export retains them server-side (NOT client, §61.6). Same class as S200 each-component-helper + the adopter #04.
## Mandates
F4 + S126 + `git merge main` (§61 emit-server + ss19 auth JUST landed). S215: dead-fn-still-shaken / non-endpoint-unchanged / no-client-leak + /code-review + R26 + node --check + FULL bun run test. No push.
