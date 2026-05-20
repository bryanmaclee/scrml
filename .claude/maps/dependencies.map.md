# dependencies.map.md
# project: scrmlts
# updated: 2026-05-20T13:42:44-06:00  commit: 78faa65

The repo is a Bun workspace: root `scrmlts` + `compiler` workspace member.
External-dependency surface is intentionally tiny — scrml's "no-build" pitch.

## Runtime Dependencies (root — package.json)
vscode-languageserver@^9.0.1 — LSP protocol implementation for lsp/server.js
vscode-languageserver-textdocument@^1.0.11 — text-document model for the LSP

## Runtime Dependencies (compiler workspace — compiler/package.json)
acorn@^8.16.0 — JavaScript parser; used in logic-context expression parsing
astring@^1.9.0 — JS AST → source serializer; codegen output stringification

## Dev / Build Dependencies (root)
@happy-dom/global-registrator@^20.8.9 — registers happy-dom globals for `bun test` (DOM in unit tests)
happy-dom@^20.8.9 — headless DOM implementation for runtime/browser tests
@playwright/test@^1.49.0 — e2e test runner (e2e/playwright.config.ts)
puppeteer@^24.40.0 — headless-browser automation (benchmarks, browser tests)
marked@^14.1.3 — markdown → HTML for the docs-site builder (docs/build.ts)

## Editor Extension Dependencies (editors/vscode/package.json)
vscode-languageclient@^9.0.1 — VS Code ↔ LSP client glue
typescript@^5.0.0 (dev) — extension build

## Engine / Runtime
Bun >= 1.3.13 (package.json `engines`) — the only supported runtime
No transpile step — `.ts` source runs directly under Bun.

## Internal Module Graph
The compiler pipeline is a linear chain orchestrated by `api.js`.
api.js imports, in pipeline order:
  block-splitter → ast-builder → name-resolver / symbol-table → module-resolver
  → component-expander → validators/{post-ce-invariant, attribute-interpolation, attribute-allowlist}
  → protect-analyzer → route-inference → monotonicity-analyzer → idempotency-store-resolver
  → type-system → meta-checker / meta-eval → dependency-graph → batch-planner
  → reachability-solver / auth-graph → codegen/route-splitter → code-generator

Lint passes called from api.js: lint-ghost-patterns, lint-i-match-promotable,
gauntlet-phase1-checks, gauntlet-phase3-eq-checks, validators/lint-try-catch,
validators/lint-async-user-source.

code-generator.js → codegen/index.ts, which fans out to ~50 `emit-*.ts` modules
(emit-html, emit-css, emit-server, emit-client, emit-machines, emit-match,
emit-control-flow, emit-bindings, emit-validators, ...) plus support modules
(ir.ts, runtime-chunks.ts, var-counter.ts, fnv1a-hash.ts, source-map.ts,
binding-registry.ts, type-encoding.ts).

reachability-solver.ts → reachability/{component-1..5, entry-points,
gate-classifier, outer-fixpoint}.

## Tags
#scrmlts #map #dependencies #compiler #bun

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [structure.map.md](./structure.map.md)
