---
from: giti
to: scrml
date: 2026-06-22
subject: compiler version-string mismatch — package.json says 0.2.0, emitted chunks.json says scrml-0.7.0
needs: fyi
status: unread
---

## What

While retesting GITI-027 against the freshly-migrated `../scrml` compiler this session,
I noticed the compiler reports two different version strings:

- `compiler/package.json` → `"version": "0.2.0"`
- emitted `chunks.json` (`--emit-per-route`) → `"compiler": "scrml-0.7.0"`

The `scrml-0.7.0` is consistent with the pre-migration scrmlTS lineage (giti's repros were
last compiled against `scrmlTS@v0.7.0`/`4c9079d2`); the `0.2.0` looks like the migrated
repo's `package.json` was reset to a fresh-start version while the internal compiler
version constant carried over unchanged.

## Why I'm flagging it (fyi, not blocking)

This does not block any giti work — giti's compiler gate (`resolve-compiler.scrml`) resolves
by **path** (`<root>/compiler/src/cli.js`), not by version, so the mismatch is invisible to
giti today. I'm sending it purely so it's on your radar before anything downstream starts
trusting either string as authoritative:

- if any consumer (a giti gate, a cache key, telemetry) ever pins on the compiler version,
  the two sources disagree and could silently key off the wrong one;
- chunk artifacts stamped `scrml-0.7.0` while the package claims `0.2.0` will read as stale
  or mis-provenanced to anyone auditing build outputs.

## Reproducer

Not a scrml-source bug (no `.scrml` input reproduces it — it's build metadata), so the usual
minimal-`.scrml` repro doesn't apply. Exact commands instead:

```
# version source A:
grep -m1 '"version"' compiler/package.json          # -> "version": "0.2.0"

# version source B (compile any program with --emit-per-route, inspect chunks.json):
bun run compiler/src/cli.js compile <any-program>.scrml -o /tmp/out --emit-per-route
grep '"compiler"' /tmp/out/chunks.json               # -> "compiler": "scrml-0.7.0"
```

Observed against `../scrml`@`ca712295` (s212).

## Suggested (yours to decide)

Pick one source of truth and have the other derive from it — e.g. emit the chunk `compiler`
field from `package.json`'s version, or bump `package.json` to match the real compiler
version. No action needed on giti's side either way; this is informational.
