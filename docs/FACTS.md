# scrml — derived facts

**This file is generated. Do not hand-edit the tables below.**
Regenerate with `bun scripts/facts.ts --write`; CI `gate` runs `--check` and fails on stale.

Every figure here is derived from repo content at the current commit. **Public documents — README, articles, tutorial, site copy, outbound correspondence — SHALL cite this file rather than hardcode a number**, because a hardcoded figure rots silently and nothing fails when it does.

Deliberately **not** here, because they change without a commit and would make `--check` flap red for reasons no pull request caused:

- GitHub stars / forks / clone traffic
- open or closed adopter issue counts
- test pass counts (running the suite is the gate's job, not a published figure)

Also absent: the §34 diagnostic-code total. It is load-bearing but not reliably extractable — a scan from the §34 heading over-counts by catching later tables, and in a file whose whole purpose is accuracy, a wrong number is worse than an absent one.

---

## At a glance

<!-- @generated:facts-table START (do not edit — `bun scripts/facts.ts --write`) -->
| fact | value |
|---|---|
| compiler version | `0.7.1` |
| live compiler source (`compiler/src`) | 225,730 lines across 180 files |
| test files | 1,236 |
| specification lines (`compiler/SPEC.md`) | 36,138 |
| conformance cases | 746 |
| standard-library modules | 21 |
| CLI verbs | 10 |
| LSP capabilities | 7 |
| editor integrations | 2 |
| deploy targets | 4 |
| public code samples under the compile gate | 12 |
<!-- @generated:facts-table END -->

## Detail

<!-- @generated:facts-lists START (do not edit — `bun scripts/facts.ts --write`) -->
**Standard-library modules** (21) — `auth` · `compiler` · `cron` · `crypto` · `data` · `format` · `fs` · `host` · `http` · `math` · `mcp` · `oauth` · `path` · `process` · `random` · `redis` · `regex` · `router` · `store` · `test` · `time`

**CLI verbs** (10) — `build` · `compile` · `dev` · `generate` · `init` · `introspect` · `migrate` · `promote` · `semdiff` · `serve`

**LSP capabilities** (7) — `codeAction` · `completion` · `definition` · `documentSymbol` · `hover` · `semanticTokens` · `signatureHelp`

**Editor integrations** (2) — `neovim` · `vscode`

**Deploy targets** (4) — `docker` · `fly` · `railway` · `render`
<!-- @generated:facts-lists END -->

---

## What each figure means

- **live compiler source** — `compiler/src`, the **default** pipeline. Excludes `compiler/native-parser` (~47k lines, gated behind the opt-in `--parser=scrml-native` flag) and `compiler/self-host-v2` (implementation #2). Verified hand-written: no file averages over 200 chars/line, and there is no bundled, vendored or generated directory under `src`.
- **test files** — files, not test *cases*. A case count requires running the suite, which is exactly the non-determinism this file excludes.
- **conformance cases** — every `expected.json` under `conformance/cases`. The case *is* the assertion: this is the language-1.0 gate, and any implementation has to pass all of them.
- **standard-library modules** — directories under `stdlib/`, each importable as `scrml:<name>`. Bundled with the compiler, single-version, no registry.
- **CLI verbs** — subcommands in `compiler/src/commands/`.
- **LSP capabilities** — providers actually registered by `lsp/server.js`. Note what is *not* there: no rename/refactor provider yet.
- **public code samples under the compile gate** — `.scrml` files in the snippet corpus that `scripts/snippet-gate.js` compiles on every push. A public document cites these files; if one stops compiling, CI fails.
