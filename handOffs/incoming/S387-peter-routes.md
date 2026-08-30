# S387-peter → bryan — ONE routed item (a runtime/language ruling, turnkey)

**From:** S387-peter (Windows). **Date:** 2026-08-29. **Base:** main `34f95910` (post-#760).
**Lane:** this is a RUNTIME/LANGUAGE decision (how scrml opens the sqlite connection = a
`semantics-changed` behavior change), so it's yours. Everything short of the ruling is done below.

---

## `g-native-sqlite-connection-lacks-wal-and-busy-timeout-config` — MED

**One-line:** scrml emits its sqlite `?{}` connection as a bare `new SQL(connStr)` with **no WAL
journal mode and no busy_timeout**, so a native scrml app cannot survive concurrent readers-during-
write or cross-process writes without `SQLITE_BUSY` failures — the exact reason a real adopter still
keeps a host-JS `db.js` seam and cannot go pure-scrml on its DB layer.

### How it surfaced (the adopter driver)
`pjoliver11/assetManagement` persists its Fleet domain through a 327-line host-JS `db.js` (`bun:sqlite`)
instead of native `?{}`. I audited db.js against `?{}` for full parity: **CRUD, atomic replace-all
(covered by §19.10.2 explicit `transaction {}` / §19.10.5 implicit per-handler tx), the optimistic-
concurrency signature (`scrml:crypto` hash + manual re-read, EC-7-style), and the regex/date
derivation (SPEC §…`raw.match(/\d+/)`) are ALL expressible natively.** The single blocker is
connection-level concurrency config. db.js opens with `PRAGMA journal_mode=WAL` + `PRAGMA
busy_timeout=5000`, and its own comment records this was **empirically required**: *"Verified S25
coexistence probe: 0 → cross-process writes SQLITE_BUSY; 5000 → 0 busy."* aM needs it because of
multiple concurrent testers + cross-process seed/tool scripts + the Pi deployment.

### PA-CONFIRMED BY EXECUTION (not inferred) — `scratchpad/dogfood/wal-empirical.mjs`
Opened a connection exactly as scrml emits it and read the live PRAGMAs:
```
scrml-style  new SQL('sqlite://…'):   journal_mode = delete     busy_timeout = 0
bun:sqlite (db.js's baseline default): delete  →  db.js sets it to  wal / 5000
```
So scrml's native `?{}` connection runs at SQLite's defaults: `journal_mode=delete` (a writer blocks
ALL readers) and `busy_timeout=0` (immediate `SQLITE_BUSY` on any contention). That is precisely the
configuration db.js overrides — and gives the author no visibility into or control over it.

### Traced locus
`compiler/src/codegen/emit-server.ts:727-729` (the `_dbScope` emit): emits
`import { SQL } from "bun";` then `const _scrml_sql = new SQL(<connStr>);` for a `<program db="sqlite:…">`
/ `<db src=…>` scope, with no PRAGMA config and no options threaded through. (There is a SECOND
sqlite open for the SESSION store at emit-server.ts:2438-2441 via `bun:sqlite` `new Database(...)` —
same absence; worth deciding together.)

### Why it's your lane (not a Peter build)
Changing how scrml opens the connection changes runtime behavior of the SAME source (concurrency
semantics) — `semantics-changed` under `pa-base` §8 / the HARD BOUNDARY. Ambiguous-fails-closed → routed.

### THE FORK (both directions laid out; loci + test-sketch each)
- **Fork A — safe defaults BY CONSTRUCTION.** scrml opens every sqlite scope with `journal_mode=WAL`
  + a sane `busy_timeout` (db.js's own choice was 5000ms). Rationale: PROJECT-INTENT — "the compiler
  owns the backend"; SQLite concurrency tuning is exactly the kind of host detail scrml exists to own,
  and the author should never have to know it. Locus: emit the two PRAGMAs immediately after
  `new SQL(connStr)` at emit-server.ts:727 (and the session open at 2441). Cost: tiny. Class:
  `semantics-changed`, strictly safer (no app that worked stops working). Test-sketch: a coexistence
  test — two connections to one file, a write open while a read runs → asserts no SQLITE_BUSY, plus a
  `PRAGMA journal_mode` assertion on the emitted connection.
- **Fork B — an author-facing knob.** e.g. `<program db="sqlite:app.db" journal-mode="wal"
  busy-timeout="5000">` (or a `<db options=…>`), threaded into `new SQL(connStr, opts)`. Rationale:
  explicit author control; matches db.js's "every path is env-overridable." Cost: new surface (attr
  parsing in the `_dbScope` collector + emit threading). Class: additive. Test-sketch: an app
  declaring the attrs compiles them into the connection open.
- **Fork C — both (PA recommendation).** Safe WAL+busy_timeout default (Fork A) AND an override knob
  (Fork B). This is **exactly the shape db.js itself chose** (defaults to WAL/5000, every path
  env-overridable), and it satisfies both the project-intent ("scrml owns the backend" → good default)
  and real deployments (the Pi / multi-process tooling → override). If only one ships first, **A** is
  the higher-leverage half — it unblocks aM's Fleet-domain migration with zero author work.

### Not blocking a Peter build
Once ruled, the rest of aM's db.js → native `?{}` migration is ordinary compute (adopter-lane) and
does not wait on you — only the connection-config decision does. Full purity backlog + a re-launchable
scanner now live in aM at `tools/purity-scan.mjs` (this gap is the sole 🟥 GAP under the db.js row).
