# runtime-size-ratchet — progress

No-regression ratchet on the scrml client runtime's gzip size.
Base: `36ed3d05` (origin/main).

---

## 2026-08-19 — Item 1: reproduce both measurements

**Every figure in the dispatch brief reproduces EXACTLY.** Nothing in the
brief's table is wrong.

Probe: compile each fixture through `compileScrml` (`compiler/src/api.js`,
`write: true`), read `result.runtimeFilename` out of the output dir, size it.
Both fixtures compile with `errors.length === 0`.

Fixtures:

- `SPA_COUNTER` — verbatim from
  `compiler/tests/integration/v0-3-x-spa-tree-shake-phase-b.test.js:47`.
- `SPA_SHELL` — verbatim from
  `conformance/cases/outlet/recognized-clean/case.scrml` (the canonical
  four-line `<program>` + `<outlet/>` shell).

| shape | brief raw | measured raw | brief `gzip -9` | measured `gzip -9` |
|---|---|---|---|---|
| `SPA_COUNTER` | 54,773 B | **54,773 B** | 15,495 B | **15,495 B** |
| `SPA_SHELL`   | 82,744 B | **82,744 B** | 26,012 B | **26,012 B** |

Derived checks: 26,012 − 16,384 = **9,628 B over**, 26,012 / 16,384 =
**1.588×**, 15,495 / 16,384 = **0.946×**. All three match the brief.

Compile is deterministic: 5 recompiles from 5 distinct temp dirs produced
byte-identical runtimes for both shapes (raw and gzip). `gzipSync(level:9)`
called 20× on identical bytes returns one distinct size. There is no
run-to-run noise to band against — the entire band is compressor variance.

### New finding: 21 of the brief's "105 B spread" is a filename, not compression

`gzip -9` on a *file* stores the original filename in the gzip FNAME header
(name + NUL). The scrml runtime's filename is content-hashed and 25 chars
(`scrml-runtime.01kdlle8.js`), so `gzip -9 <file>` carries **26 bytes of
metadata that are not code at all**. Proven by compressing identical bytes
under three names:

```
SPA_COUNTER  runtimeFilename=scrml-runtime.01kdlle8.js (25 chars)  raw=54773
  cli gzip -9, FNAME='scrml-runtime.01kdlle8.js' (25+1 hdr bytes) : 15495
  cli gzip -9, FNAME='r.js' (4+1 hdr bytes)                       : 15474
  cli gzip -9, stdin (no FNAME field)                             : 15469
  FNAME delta (real - short) = 21  (expected 21)
  FNAME delta (short - stdin) = 5  (expected 5)
```

The deltas land on the predicted byte. So the brief's "`gzip -9` gives
15,495 where bun's zlib gives 15,600 — ~105 B for no code reason" is real
but is three stacked effects, only one of which is compression quality.

## 2026-08-19 — Item 3: measured spread, decomposed

`gzip 1.12`; `bun 1.3.14` (node 24.3.0 compat). Same bytes throughout.

| axis | `SPA_COUNTER` | `SPA_SHELL` | what it is |
|---|---|---|---|
| FNAME header (25-char hashed name vs stream) | 26 B | 26 B | pure metadata |
| level (node zlib default vs `level: 9`) | 38 B | **141 B** | compressor setting |
| implementation @ level 9 (node zlib vs GNU gzip) | 93 B | **94 B** | genuine |
| **full observed range, all sane settings** | 15,469–15,600 = 131 B | 25,986–26,221 = **235 B** | |

Raw numbers for `SPA_SHELL`:

```
  cli gzip -9, FNAME='scrml-runtime.00qpgjuj.js' (25+1 hdr bytes) : 26012
  cli gzip -9, stdin (no FNAME field)                             : 25986
  cli gzip -6, stdin (no FNAME field)                             : 26019
  node/bun zlib gzipSync level:9                                  : 26080
  node/bun zlib gzipSync (library default)                        : 26221
  IMPL SPREAD at level 9 (node zlib - cli gzip stdin)             : 94
  LEVEL SPREAD in node zlib (default - level 9)                   : 141
```

### Decision: pin the compressor AND carry a derived band

Pin: `gzipSync(runtimeBytes, { level: 9 })` — node/bun `zlib`, in-memory
buffer, explicit level. This closes two of the three axes outright:

- no file is written, so there is **no FNAME field** — the 26 B artifact
  cannot occur;
- the level is explicit, so the library's default (which is what produced
  the 141 B shell delta, and which a bun upgrade could silently change)
  cannot move the number.

Band: **188 B = 2 × 94 B**, twice the largest measured cross-implementation
delta. After pinning, the only variance left is *which* zlib bun links.
The one alternative implementation on this machine (GNU gzip 1.12) differs
by 94 B (shell) / 93 B (counter), and does so in the *favorable* direction
(it compresses better). Doubling covers an equal-magnitude drift in the
unfavorable direction with 100% headroom. It is a measured multiple, not a
round number.

Cost, stated plainly: a code change that adds under 188 B gzipped
(0.72% of 26,080) slips through silently. That is the price of not having
a gate that reddens for free. Item 4 proves the ratchet still bites.

**Ceiling = 26,080 (measured, `level: 9`) + 188 (band) = 26,268 B.**

## 2026-08-19 — Items 2 + 5: the ratchet lands

- `compiler/tests/integration/runtime-size-ratchet.test.js` — new, 8 tests.
  Ceiling in one named constant, `SHELL_RUNTIME_GZIP_CEILING = 26080 + 188`,
  commented LOWERABLE-ONLY. Compressor pinned in one helper, `gzipSize()`,
  which takes a Buffer (no FNAME field can exist) at an explicit level 9.
- `v0-3-x-spa-tree-shake-phase-b.test.js` — the aspiration recorded at the
  assertion. The comment sits **below** the `expect`, not above: this file is
  cited as `:145` from `docs/known-gaps.md`, `handOffs/delta-log.md` and
  `handOffs/dpa-queue.md`, so nothing may be inserted above that line.
  Verified after the edit: line 145 is still `expect(gzip.length)...`, and
  the file is still 19/19.

## 2026-08-19 — Item 4: the bite proof, both ways

### 4a — add bytes to `compiler/src/runtime-template.js`, confirm RED

33 lines / 2,769 B of ordinary English prose comment inserted into the
always-present `core` chunk. Prose, not random bytes — random bytes are
worst-case for gzip and would flatter the test; prose compresses ~3:1 and is
the honest shape of a real regression.

```
########## STEP 3 — RATCHET MUST BE RED ##########
error: CLIENT-RUNTIME SIZE REGRESSION — outlet-bearing shell shape.

  measured : 27004 B gzip (level 9), 85513 B raw
  ceiling  : 26268 B  (26,080 recorded + 188 B band)
  over by  : 736 B
...
(fail) §1 client-runtime size ratchet (outlet-bearing shell) > the assembled shell runtime does not exceed the recorded ceiling [146.28ms]

 6 pass
 2 fail
```

2,769 B raw became 924 B gzip — 4.9× the 188 B band. The band is nowhere
near wide enough to hide a real change.

### 4b — restore, confirm GREEN

```
########## STEP 4 — RESTORE ##########
(clean = restored)

########## STEP 5 — GREEN AFTER ##########
 8 pass
 0 fail
Ran 8 tests across 1 file. [534.00ms]
```

### 4c — the pre-existing counter assertion is untouched

`v0-3-x-spa-tree-shake-phase-b.test.js` — **19 pass, 0 fail** both before and
after. Its `expect` on line 145 is unchanged; only comments were added, and
only below it.

### 4d — ⚑ the proof that matters: a regression the counter gate CANNOT see

4a landed in the `core` chunk, which both shapes assemble, so both gates went
red. That does not prove the ratchet is worth having. So: which chunks does
the shell assemble that the counter does not?

```
chunk            counter  shell
  mount           no     YES   <-- SHELL ONLY
  soft-nav(fn)    no     YES   <-- SHELL ONLY
  soft-nav(re)    no     YES   <-- SHELL ONLY
```

The same 2,770 B prose block inserted into the SHELL-ONLY `mount` chunk:

```
########## STEP 7 — regression in a SHELL-ONLY chunk ##########
inserted into the SHELL-ONLY 'mount' chunk: 33 lines, 2770 raw bytes

--- the NEW ratchet:
  measured : 27069 B gzip (level 9), 85514 B raw
  ceiling  : 26268 B  (26,080 recorded + 188 B band)
  over by  : 801 B
(fail) §1 client-runtime size ratchet ... does not exceed the recorded ceiling
 7 pass
 1 fail

--- the PRE-EXISTING counter gate, SAME regression present:
 19 pass
 0 fail
Ran 19 tests across 2 files.
```

**801 B of shipped-runtime regression, and the only pre-existing gzip
assertion in the tree is 19/19 green.** That is the hollow gate, demonstrated
rather than argued — and it is now covered.

### 4e — the deadband, measured rather than asserted

The band's stated cost, proven rather than hand-waved: a 125 B raw insert
passes silently.

```
inserted small block: 2 lines, 125 raw bytes
 8 pass
 0 fail
```

That is the documented and accepted price of not shipping a gate that can
redden for free.

All four `runtime-template.js` mutations were reverted with
`git checkout --`; `git status --short` is clean after each.
