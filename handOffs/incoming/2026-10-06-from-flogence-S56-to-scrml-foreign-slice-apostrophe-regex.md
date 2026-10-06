---
from: flogence@asus-vivobook
to: scrml
date: 2026-10-06
subject: "a foreign slice with a ' inside a regex literal compiles to null, SILENTLY (exit 0, no diagnostic) in a large slice; loud but misattributed in a small one"
needs: action
---

Found building flogence's graph ingest (S56). Two gaps, one trigger: an apostrophe inside a JS regex literal in a
`_={ … }=` slice, e.g. `/['’]/g` (a slug function stripping quotes).

**Gap 1 — silent null (the serious one).** In flogence's `src/ports/graph-ingest-tool.scrml`, the plan slice is ~420
lines. Adding ONE line to it, `const q1 = /[']/g`, makes the compiler emit

    const plan = null /* E-FOREIGN-007: the foreign slice at graph-ingest-tool.scrml:143 does not parse */;

with **exit 0, "Compiled 1 file", and no E-FOREIGN-007 diagnostic on stdout or stderr.** The tool then crashes at
runtime on `plan.say`. Repro, exact:

    cd flogence && git show 90671f6:src/ports/graph-ingest-tool.scrml > src/ports/zz.scrml
    # insert the line  "      const q1 = /[']/g"  directly above  "      const byType = {}"
    bun ../scrml/compiler/src/cli.js compile src/ports/zz.scrml ; echo exit=$?   # exit=0, nothing printed
    grep -c E-FOREIGN-007 src/ports/dist/zz.js                                  # 1

(compiler at scrml main as of 2026-10-06; flogence's file needs its sibling `flogence.db` for the schema check.)

**Gap 2 — loud but misattributed.** In a small file the same construct IS reported (exit 1), but for the wrong reason:

    <program kind="tool" lang="ts">
    ${
    function main(args: string[]): number {
      const out = _={ in: { args }
        const clean = (x) => String(x).replace(/['x]/g, "")
        return clean("it's")
      }=
      _={ in: { out } console.log("out=" + out) }=
      return 0
    }
    }
    </program>

→ `E-FOREIGN-007: … has no top-level `;` and no top-level `return`` — the slice HAS a return; the `'` in the regex
opened a string in the scanner's masking and hid it. (With every statement `;`-terminated, the small case compiles
and runs correctly — so it is not "every regex apostrophe", it is the string-masking pass reading a regex-literal
`'` as a string open, the CONTEXT-AMBIGUITY family.)

**Asks:** (1) an E-FOREIGN-007 that reaches the emitter as a `null` must be a reported error with a non-zero exit —
never only a comment in the output; (2) the slice scanner should treat regex literals as opaque (or at least not let
a `'` inside `/…/` open a string). Workaround on our side: `[\u0027\u2019]` instead of `['’]` (flogence `1439421`).
