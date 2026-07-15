# Cross-OS invariants — one scrml, every OS

> **Status: working principle (Peter/Windows seat, S254-follow).** The compiler must produce
> identical results on Linux (Bryan), macOS (Ryan), and Windows (Peter). This note states the
> invariants that make that true *by construction* — not by branching on the host OS. The
> **deploy/runtime-target** OS story (how `scrml build --target …` factors the *deployed app's*
> runtime) is a separate, Bryan-owned decision and is explicitly out of scope here.

## The invariants

1. **Paths are POSIX-canonical (`/`) at every internal boundary.** Module graph keys, the
   `outputs` Map keys, export-registry keys, the watch set, and every path used as a Map key or
   compared with `startsWith`/`===` are `/`-form. Native separators exist **only** at the
   filesystem-syscall edge — and even there, `/` works on Windows (Node/Bun accept it), so a
   round-trip to native is rarely needed.

2. **Internal text is `\n`-canonical.** The compiler reasons in `\n`. EOL only materializes at
   file-write, respecting the target file's existing EOL (see `scripts/state.ts` `findAnchorSpan`).
   Emitted-content assertions normalize EOL before comparing.

3. **No `process.platform` / `os.platform()` branching in path logic.** If a fix needs to know the
   OS, it's the wrong fix — canonicalize at the boundary instead. (Runtime code that legitimately
   targets a deploy OS is a different layer and not covered by this rule.)

## Why this, and not "register the target OS"

Switching path formats on a host-OS flag multiplies code paths and lets them drift — you maintain
"one scrml" by hand, and it silently isn't. Canonicalization makes it true for free: the compiler
doesn't know or care what OS it runs on. This is the same answer esbuild/vite/rollup/TypeScript/
Node-ESM all converged on.

**The stakes are not cosmetic.** GitHub #26 was a Windows-only path-comparison bug
(`C:\repo\stdlib\…`.startsWith(`C:\repo\stdlib/`) → `false`) that mis-classified stdlib auth code
as sync → shipped a `Promise`-returning check **un-awaited** → a truthy Promise accepted every
password. **Invisible on Linux/macOS (all `/`).** Honoring invariant #1 everywhere is how that
class stays dead. (S254-follow found and fixed a *second* un-normalized copy of exactly this
predicate in `lint-async-user-source.ts`.)

## Why the Windows seat is the high-signal one

Linux and macOS are both POSIX, so `\`, drive letters, and CRLF are **invisible** there. Windows is
the strictest test harness in the project: every foundational fix that honors these invariants is a
**no-op on POSIX** (which is why the Linux `gate` stays green through these changes) and turns a
latent cross-OS bug into a caught one. Fixing Windows-green foundationally makes the other two
platforms correct for free.

## Enforcement (the gate)

- **`windows` CI job** (`.github/workflows/ci.yml`, #36) — `unit + conformance` on `windows-latest`.
  It is the falsifiable, merge-relevant check that the invariants hold. Non-blocking today; the goal
  is to make it fully green so it can gate.
- The canonical normalizer is `toPosixSpecifier(p)` (`compiler/src/api.js`) — `p.replaceAll("\\","/")`.
  `module-resolver.js` carries a local `normalizeSep` mirror. Prefer the shared helper for new code.

## The boundary with the deploy decision (Bryan)

The **compiler-internal** invariants above are correctness, not a design choice — we just do them.
The **deploy/runtime-target** story (does the generated app assume a POSIX runtime? how does
`--target fly|railway|docker` factor it?) is Bryan's call and a *runtime* concern, cleanly separable.
Landing these invariants means that decision arrives unencumbered by any compiler-internal path mess.
