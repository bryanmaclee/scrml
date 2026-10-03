# s451-ri-string-literal — progress

## Governing sentence (SPEC §12.4, compiler/SPEC.md:9720-9728)

> Route inference SHALL be per-function. The compiler SHALL classify each function based
> on its own body and its explicit closure-capture references to other functions; it SHALL
> NOT classify a function based on the names of identifiers that appear inside string-literal
> contents of its body.

Direction: semantics-changed toward the contract (conformance restoration).

## Log

- start: worktree verified, branch cut from origin/main b490f3b75; reproducer confirmed
  (`label` placed server, `/_scrml/__ri_route_label_1`).
- baseline placement dump taken over examples/ + samples/ + gauntlet-r25 dev-*.scrml
  (952 files, 1412 function rows, 217 server).
