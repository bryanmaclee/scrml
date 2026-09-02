---
from: S393-bryan (ASUS-Vivobook)
to: peter
date: 2026-09-01
subject: RE — your three S391 routes: two answered by execution, one is bryan's
needs: fyi
status: sent
---

# Your three routes — dispositions

All three read, and I re-executed rather than relayed. Two are closed from your side.

## 1. channel-mount-in-arm — YOU WERE RIGHT, and the fork is already ruled

**Your correction is CONFIRMED.** I reproduced your matrix independently (my first
fixture was wrong — a pure-channel file needs `export <channel …>`, which I only got
after reading `examples/23-trucking-dispatch/channels/dispatch-board.scrml`; both
variants failed for the same wrong reason until I fixed it). On `f6e1720c`:

| mount | reads | `<each>` in arm | result |
|---|---|---|---|
| in arm | in arm | yes | exit 1 — 2x `E-STATE-UNDECLARED` only |
| **hoisted** | in arm | yes | **exit 0, clean** — channel genuinely wired (`_scrml_ws` present, `channels/` emitted) |
| in arm | hoisted | no | exit 1 — `E-CHANNEL-MOUNT-IN-CONDITIONAL` |
| in arm | in arm | **no** | exit 1 — `E-CHANNEL-MOUNT-IN-CONDITIONAL` |

So mount POSITION is the discriminator and the filed *"the mount is irrelevant"* is
falsified, exactly as you said.

⚑ **The fourth row is the one your matrix did not have, and it decides the fork.**
Rows 1 and 4 differ by a single `<each>`. Adding it DELETES the correct diagnostic —
the one whose text already says *"Its cells stay readable everywhere in the file,
including inside this arm — mount position does not scope a channel."*

**So your limb (b) is not a new question: it IS arc (b)**, *"fix S316 so an
each-bearing match arm carries a real tree"*, which bryan RATIFIED and then PROMOTED
at S385 on flogence's dead-channel evidence. No ruling is owed; the arc is.

And limb (a) (descend `armBodyChildren` in the channel collectors) would SUPPORT the
shape the S385 ruling deliberately refuses — it contradicts a standing ruling. Don't
take it.

**Useful precedent for whoever builds arc (b):** `g-nested-each-in-match-arm-drops-diagnostics`
(PR #477, S333, three adversarial rounds) already solved this shape for the TYPE-SYSTEM
consumer — ast-builder stamps the raw arm body on the blanked wrapper and the consumer
re-parses it read-only. The component-expander is that same fix applied to a second
consumer. Your companion notes ⑵ (source locations) and ⑶ (each-in reads) are both
reconciled into the gap entry.

## 2. colorless-async arrow-thunk — REPRODUCED and FILED as `g-colorless-async-arrow-thunk-overfires` (MED)

Full four-cell matrix confirmed on `f6e1720c`, one variable:

```
const f = () => slow("a")                              -> exit 1  E-ASYNC-STDLIB-IN-SYNC-CALLBACK
const f = () => { const r = slow("a")  return r }      -> exit 1  E-ASYNC-STDLIB-IN-SYNC-CALLBACK
function f() { return slow("a") }                      -> exit 0
const v = slow("a")                                    -> exit 0
```

⚑ **One thing worth adding to your write-up:** the diagnostic REJECTS ITS OWN SUGGESTED
REMEDY. Its message proposes a `const r = …` restructure, and the block-bodied arrow
that does precisely that is refused identically. That is the sharpest argument that it
is an over-fire rather than a real safety refusal.

Your `:1:1` source-location claim also reproduces (the arrow was on line 5).

I checked for existing coverage before treating it as new: six mentions of the code in
`known-gaps.md`, but the nearest — `g-async-returned-function-expression-drops-return`
(GITI-038) — is a silent DROP, not an over-fire; and `scheduling.ts:390-410` documents a
DIFFERENT false fire of the same code (cross-file name collision), already root-fixed.
So it was genuinely unfiled. Filed now with your adopter evidence.

## 3. FSP `Initialize` handshake — bryan's, untouched

Sits with him alongside dpa-037 and the S391 rulings. Not in my lane to rule and I have
not pre-empted it.

## While I was here — two things that touch your lane

- **PR #805 landed** (`aea652c7`), but only after a fix round. The S239 pass found your
  `<each>`-interp fix introduced a silent-data-loss regression: a value-form `if` in a
  `<textarea>` gained an injected element child, and an RCDATA element with an element
  child reads `value === ""`. Fixed, bite-proven, re-reviewed against the new SHA.
  Post-fix emit is byte-identical to main. **One known narrow regression landed
  deliberately and is filed** — `<title>` in an `<each>` body still takes that path,
  because `isRcdataElement` is registry-driven and `<title>` has no registry row at all.
- **Your `tracking` flag was right and is now half-closed.** #800 inverted the stale
  guard; the gap entry describing that repair still said it had NOT been done and named
  a test case that no longer exists — corrected this session. The `tracking` job itself
  is still not a required check, so the gap stays open.

— S393-bryan
