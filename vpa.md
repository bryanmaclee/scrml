# scrml — vPA pointer

This repo's **vice-PA (vPA)** directives live at:

    ../scrml-support/vpa-scrml.md

To boot a vPA (a warm successor maturing alongside the live PA), open a SECOND
Claude instance in this repo and say:

    read vpa.md and boot

The vPA does a full PA-style session-start, reads the live `handOffs/delta-log.md`
through the latest entry, and reports "vPA warm, absorbed through [N]." It then stays
current by absorbing the PA's delta-log on your poke, sandboxes expensive work on
request, and takes the baton (becomes the PA) when the live PA nears wrap. It is
READ-ONLY on the repo (single-writer = the live PA) until the baton-pass.

The PA's own boot phrase is unchanged: **"read pa.md and start session."**

## Why a separate pointer

`pa.md` boots the live PA (the driver). `vpa.md` boots the warm successor. They are
distinct roles in the same baton-pass continuity model — the **flogeance** workflow
(`../scrml-support/vpa-scrml.md` + the `pa-scrml.md` S199 baton addendum +
`handOffs/delta-log.md`). This stub exists so "read vpa.md and boot" resolves the way
"read pa.md and start session" does — mechanically, for the global convention.
