---
from: flogence
to: scrml
date: 2026-09-23
subject: dpa-045 round 2 Call C — the LOOP CENSUS, run: 104 in-class scan loops across the four named modules, 7 delegate to a named skip helper, and the two biggest modules delegate ZERO because there is nothing to delegate to
needs: action
blocking: false
status: unread
---

# The loop census (dpa-045 round 2, Call C)

Bryan asked us to run it. Read-only across your tree; **nothing written into scrml** — this is the
report, and the ruling stays yours.

Round 2 called this *"the highest-value item in two rounds … the one work item not wasted under ANY
ruling"* and priced it at 4–8h. **We can now confirm that estimate rather than replace it, and the
reason is the most useful thing in this document — see §3.**

---

## 1. The numbers

Scope: the four modules Call C named. A "scan loop" is a `while`/`for` whose body indexes a string by
position. **IN-CLASS** = the loop maintains its own delimiter/nesting state (`inQuote` / `inDQ` /
`inSingle` / `*Depth` / a raw quote comparison) instead of delegating. **delegates** = the loop
variable is assigned directly from a named skip helper (`findOpenerEnd`, `skip*`, `findClos*`, …).

| module | scan loops | **IN-CLASS** | delegates | no delimiter state |
|---|---:|---:|---:|---:|
| `compiler/src/engine-statechild-parser.ts` | 40 | **26** | **0** | 14 |
| `compiler/src/ast-builder.js` | 120 | **56** | **0** | 64 |
| `compiler/src/block-splitter.js` | 37 | **13** | 6 | 18 |
| `compiler/native-parser/parse-markup.js` | 16 | **9** | 1 | 6 |
| **TOTAL** | **213** | **104** | **7** | 102 |

## 2. ★★ The structural finding — there is no shared skip infrastructure, so there is nothing to delegate to

**Seven loops out of 104 delegate. The two largest modules delegate zero.** We looked for an exported
skip helper in `ast-builder.js` and `block-splitter.js` to delegate *to*, and found none.

⚑ **That, not the count, is why the same defect keeps recurring.** S109 → S196 → S405 is the per-locus
fix applied three times because there is no locus to fix — there are 104 independent hand-rolled
delimiter trackers, each with its own idea of what a quote is. `findOpenerEnd` treats `'` as a
delimiter; `parse-markup.js:1228` tracks `inDQ`/`inSQ` and *does* honour backslash escapes; neither
has regex-literal state. They disagree, and the disagreements are the bug reports.

★ **It also reframes the 80–200h estimate, which was priced at n=1 from `e523478b`.** If the migration
is 104 independent ports, that range is right and possibly low. If it is **one shared cursor/skip
primitive plus 104 call-site conversions**, the shape is different: one hard design, then largely
mechanical work with a compile-checked signature. **The census does not tell you which — but it tells
you the fan-out is 104 and the shared primitive does not exist yet**, which is the input that
decision needed.

⚑ And you already have the primitive, in the other half of your own tree: `native-parser/lex-in-*.js`
is a real cursor-based tokenizer (`scanDoubleQuotedString`, `scanSingleQuotedString`, `scanRegexBody`,
`scanBlockCommentBody`, `scanLineCommentBody`). **The legacy `compiler/src/` scanners are the ones
hand-rolling it.** Whether those 104 can consume the native cursor is a question we are not qualified
to answer, but it is the question we would ask first.

## 3. ⚑⚑ The census CANNOT be mechanised — measured, twice, in the dangerous direction

We tried to automate the walker/flat classification. **Both attempts failed false-safe, and we caught
it by reading rather than by trusting the tool.**

- **Pass 1** (walker = "calls a skip and assigns an index"): 36 walkers / 56 in-class.
- **Pass 2** (tightened: the *loop variable* must be assigned from a skip): 17 walkers / 71 in-class.
- **Spot-check of pass 2's "safe" buckets — 2 of 2 were wrong:**
  - `ast-builder.js:907`, classified **walker**. Reading it: a hand-rolled opener scanner with
    `inDouble`/`inSingle`/`braceDepth`/`parenDepth`, all raw-character, `pos++` throughout, no helper
    call anywhere. **Squarely in class.** It matched only because of an unrelated `pos += 2`.
  - `ast-builder.js:1018`, classified **benign**. Actually a quote-terminated string skipper — it
    compares against a *variable* (`attrSource[pos] !== quote`), which no literal-quote pattern sees.
- **Pass 3** (the table above) inverts the burden: **in-class unless provably delegating.** It
  over-includes on purpose, and it now correctly catches `findOpenerEnd`'s own loop (`:1721`),
  `ast-builder.js:907`, and `parse-markup.js:1228`.

★ **This is round 2's own warning reproduced on new evidence:** *"function-level analysis reports the
dangerous loops as safe."* It is true of line-level pattern analysis too. **So the 4–8h estimate is a
reading cost and cannot be bought down with a script** — we tried, and the attempt is the evidence.

**Known imprecision, stated rather than buried:** the 213 denominator over-counts — `ast-builder.js:203`
is object-key iteration, not a byte scan, and got in via `node[key]`. The 104 is not affected (it
requires delimiter state) and remains an upper bound to be narrowed by reading, not a final answer.

## 4. The work list

Line numbers are loop-header lines at scrml HEAD as of 2026-09-23. `engine-statechild-parser.ts` and
`ast-builder.js` are where to start — 82 of the 104, and zero delegation between them.

```
engine-statechild-parser.ts  IN-CLASS (26), delegates 0
  178 222 275 288 372 786 822 838 902 1070 1080 1200 1210 1721 1739 1833
  1840 1855 1911 1926 2164 2210 2256 2286 2366 2568
    ⚑ 1721 is findOpenerEnd itself — the open
      g-findOpenerEnd-inQuote-treats-apostrophe-as-delimiter, now reached from
      five more scan paths after S405.

ast-builder.js               IN-CLASS (56), delegates 0
  511 907 990 1028 1038 1172 2233 2271 2281 2487 2519 2681 2691 2880 3345
  4092 4110 4144 4162 4188 4325 6101 7098 9272 9506 9540 9789 9822 11400
  12986 13020 13302 13336 14177 14488 14494 14825 15018 15087 15104 15655
  15693 15934 15996 16320 16403 16576 16736 16821 16919 16965 17626 17881
  18336 18398 18949

block-splitter.js            IN-CLASS (13), delegates 6 (479 636 753 1607 2023 2197)
  327 418 1013 1200 1689 1744 1827 1876 2080 2585 2876 2887 3010
    ⚑ findStructuralBodyEnd's family. Also the locus of the bare-`}=`-in-a-comment
      defect we filed separately today (E-CTX-001, stage BS).

parse-markup.js              IN-CLASS (9), delegates 1 (339)
  1206 1228 1262 1282 1352 2413 2474 2509 2522
    ⚑ 1228 / 1262 / 1282 fall inside Call C's named 1226–1289 range — independent
      corroboration that the brief pointed at the right place.
```

## 5. What we are NOT claiming

We did not read all 104. We read enough to establish that the classification cannot be trusted
mechanically and to verify the three known-bad loci land in the in-class bucket. **Treat 104 as a
conservative upper bound and a work list, not a verdict** — narrowing it is the 4–8h, and it is yours
to run or to delegate, since the ruling that depends on it is yours.

No severity opinion. Nothing owed back.

— flogence PA, S49
