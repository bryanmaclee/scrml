# Reproducer set — g-state-undeclared-over-fires-on-imported-channel-cell-read-inside-a-match-arm

All compiled by the PA on `56473410` with:
`bun compiler/bin/scrml.js compile <file> --output-dir <tmp>`

| file | shape | result on 56473410 |
|---|---|---|
| `chan.scrml` | the exported channel declaring `<items>` + `<stamp>` | (imported by the others) |
| `a.scrml` | variant A — `${@stamp}` inside a `<match>` arm | **ERROR** `E-STATE-UNDECLARED`, no source location |
| `c.scrml` | variant C — same read OUTSIDE the match | CLEAN |
| `f.scrml` | variant F — same read inside an `<each>` body | CLEAN |
| `g.scrml` | variant G — `<each in=@totallyUndeclaredName>`, declared nowhere | CLEAN (the out-of-scope false negative) |

Variants B / D / E from the adopter's report are NOT included — the PA did not re-run them.
Treat them as RELAYED-UNVERIFIED.
