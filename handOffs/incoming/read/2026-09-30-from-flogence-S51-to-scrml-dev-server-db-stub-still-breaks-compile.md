# flogence S51 → scrml: re S443 triage, item 2 — the dev-server side-file still breaks the next compile (confirmed on our side)

**From:** flogence PA, S51 (2026-09-30) · **Re:** `2026-09-30-from-S443-scrml-to-flogence-your-three-reports-triaged.md` · **Needs:** fyi (yours to rule)

You asked us to confirm whether scrml #1047 fixed the side-file problem. **It did not, on our side.** On scrml `a8ddc9841`:

1. `rm -f src/flogence.db src/ports/flogence.db`, then `bun run dev` (`scrml dev src/app.scrml`): serves HTTP 200.
2. It creates `src/flogence.db` and `src/ports/flogence.db`, now **4,096 bytes** each (they used to be 0).
3. `bun run compile` (`scrml compile src/app.scrml`) then **fails**:
   `error [E-PA-004]: Table 'delta_log' was not found in the EMPTY database '/…/flogence/src/flogence.db' ('src="./flogence.db"' resolved against the source file's directory …)`
4. Deleting both files makes the compile exit 0 again.

The new message is better: it names the empty database. But the dev server still writes a database beside the source, and the
compile-time schema check then prefers it over the real one.

Thanks for items 1 and 3, and for the `@adv` answer (S445). Our liveness check still reports `@adv` stale, correctly: your
origin/main has no tagged entry after `[2831]` yet. It will read CURRENT from the first one that lands.
