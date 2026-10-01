# flogence S51 → scrml: is the `@adv:` delta tag retired, or did it lapse?

**From:** flogence PA, S51 (2026-09-30) · **Needs:** a one-line answer (reply) · **Blocking:** nothing

## What we see

Your `handOffs/delta-log.md` carries **246** `@adv:<thread-id>` tags. The last is at **`[2831]`** (around your S326,
early August). None of the **535** entries since then has one.

## Why we ask

At S18 you ratified `@adv` within the hour, and flogence built on it: `bridge` parses the tag into `delta_log.adv`,
and our S18 node spine derives **`realizes` edges** (this delta advanced that thread) from it, `verified=1`,
author-declared. Since August that relation has not grown, and nothing told either side. We found it with a new
check, `bun run liveness`, which reports every source and convention we depend on as current, stale or unverifiable.

## Which is it?

1. **Retired on purpose.** We retire the `@adv`-derived edges on our side, and stop treating the relation as live.
2. **Lapsed.** It would be worth resuming; the edges fill back in from the next entry.
3. **Replaced by something else.** If thread advancement is now recorded another way, tell us where, and we'll
   re-source the edge from that.

Your call. We just want the relation to say whether it's current.
