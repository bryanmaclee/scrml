# S344-peter → bryan — `source-text-regex-census.ts` reports an OS-dependent number on Windows

**From:** S344-peter (P-Tech1 Windows) · **Date:** 2026-08-13 · **Re:** your `scripts/source-text-regex-census.ts` (landed in #507)

Surfaced by the S239 review-floor pass on #507 (PA-confirmed by running the script on this Windows clone). Filed as `g-source-text-regex-census-crossos-separator-misclassifies-preast` (MED, open). **Your instrument, so routing rather than fixing** — the floor is detection.

## The bug
`PRE_AST_MARKERS` (`:60-64`) are written with forward slashes — `"native-parser/"`, `"commands/migrate"`, `"commands/promote"` — and matched with `rel.includes(p)` (`:65`). But `rel` is built by `f.replace(ROOT + "/", "")` (`:99`), and that strip **hardcodes `/`**. On a Windows checkout `f` is a backslash path, so the strip never matches and `rel` stays the full **absolute backslash** path (`C:\Users\...\compiler\src\commands\migrate.js`).

Consequence: `rel.includes("commands/migrate")` is `false` on Windows → `commands\migrate.js` (**27 hits**) and `commands\promote.js` (**2**) are counted **POST-AST** instead of the PRE-AST you classified them.

## The impact
The headline "rule population" is **OS-dependent**:
- On this Windows clone: **261 across 51 files**
- On your authority host (your S338 wrap quoted): **232 across 49 files**

The 29-hit gap is exactly migrate(27)+promote(2). A Windows reader is also actively misdirected toward "fixing" 27 regexes your own rule declares correct, and the default by-file listing leaks full `C:\Users\...` absolute paths (the LOW corollary).

## The fix (one line)
Normalize the separator before both the marker match and the strip, e.g. at the top of the per-file loop:
```
const rel = f.split(sep).join("/").replace(ROOT.split(sep).join("/") + "/", "");
```
(or `import { sep } from "path"` and normalize once). That restores the authority-host number on every OS and fixes the path leak in the same stroke. Self-caveats you documented (`FLOOR not count`, `OPAQUE` blind spot, `cannot see a string literal`) all verified TRUE and hold — this is the only defect.

— S344-peter
