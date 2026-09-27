# F1 — a multi-unit program splits its own cookie name when a 2nd `<program>` shares the compile set

**Status: RULED — option A, BUILT (S436 round 3). `E-MW-008` ships in this change.**
B and C are retained below, examined and rejected, so the ruling has its provenance. The evidence
that produced the ruling is preserved verbatim; the one thing that changed after building is the
FIRING CONDITION, which had to be narrowed — see §5 at the end.

Still owes bryan a language-surface review because it mints a diagnostic. Per the S313 model that
is a review of the built thing, not a pre-approval gate.

Raised by the S239 review of #1080. The fix that PR lands (`<program>` session config is
program-scoped, not build-scoped) is correct and stays; this document is about the *price* its
count-based guard pays, which is a functional regression at population zero, and about the three
ways out. Options A and B each mint a diagnostic, which decides what the language *says* — that is
the operator's call, not the implementer's, so neither is built.

---

## 1. What happens today (on the branch, post-fix)

The guard suppresses cross-unit inheritance whenever a compile set holds 2+ `<program>`
declarations, because the compiler has no unit → owning-`<program>` relation. That is sound for
*unrelated* programs and wrong for a *genuine multi-unit program* that happens to share the set.

**Measured, both input orders, zero diagnostics of any kind distinguishing it:**

| unit | declares | emitted cookie | Max-Age |
|---|---|---|---|
| `index.scrml` — program A | `session-secure="false" sessionExpiry="7d"` | `scrml_sid` | 604800 |
| `pages/minter.scrml` — **A's own member**, mints | nothing | **`__Host-scrml_sid`** | **3600** |
| `other/zzz.scrml` — unrelated program B | nothing | `__Host-scrml_sid` | 3600 ✅ the fix working |

The emitted readers are compile-time specialized to one name each —
`/(?:^|;\s*)scrml_sid=([^;]+)/` vs `/(?:^|;\s*)__Host-scrml_sid=([^;]+)/` — and are disjoint, so a
login served by one of program A's routes leaves A's other route logged out. **This is the #282 /
S433 writer-reader split, reached through a new door.**

**Provenance — this one is INTRODUCED, and the other two review findings were not.** Same fixture
on `origin/main` (`c46ebbf8`): all three units agree on `scrml_sid` / 604800. The shape *worked*
before the guard and breaks after it. (F2 and F3 from the same review were measured on both
`origin/main` and the first draft and were identical on each — pre-existing, and both are fixed in
`e4747602`.)

**It is reachable through the ordinary user-facing path, not just the library API.** Real
`scrml build` on the three-file fixture: **exit 0, "Compiled 3 file(s)", "3 server route(s) wired"**,
no error, no warning naming the condition. Positive control for that probe: the same two programs
each declaring `log=` fail the build with `E-MW-007`, so the probe can see a refusal when one exists.

**Population: 0 of 1137 corpus compile sets, 0 of 15 adopter-clone compile sets.** Zero, and still a
functional regression.

Pinned by `conf-SESSION-PROGRAM-ATTR-SCOPE.test.js` →
`"KNOWN COST (F1, awaiting ruling) — a multi-unit program beside a 2nd program splits its own cookie name"`.
That test asserts the split *as a cost*, not as correct. **When this fork is ruled, that is the test
that must change.**

---

## 2. The governing precedent (§1 gate — the sentence exists, and it is close)

`compiler/SPEC.md:23763`, §40:

> When a build presents MORE than one module declaring a request pipeline in that sense, that is more
> than one application emitted into one server. The compiler SHALL emit `E-MW-007` naming every
> competing source and SHALL NOT compose them. […] (§40.8 reserves `E-PROGRAM-002` for the underlying
> shape: a second top-level `<program>` in another file of the same application. **`E-MW-007` is the
> emitted-server consequence, and fires today.**)

So the project **already refuses** "two applications in one build" — as an `Error`, with the remedy
*"build one application per output directory"* — whenever it can point at a concrete conflict
(the request onion). Session config is the same class of application-scope conflict, detected the
same way, and currently silently mis-resolved instead of refused. Option A is an extension of a
settled rule; it is not a new position.

`E-PROGRAM-002` itself stays reserved: implementing *it* would refuse the second-`<program>` shape
in general, which is **75 of 1137 corpus sets** — a different, much larger arc. Everything below is
scoped to sets where session config is actually contested.

---

## 3. The options

### Option A — REFUSE the configuration

2+ `<program>` declarations in one compile set **and** at least one of them declares
`session-secure` or `sessionExpiry` → hard error. Kills the leak *and* the split: there is no
mis-resolution because there is no compile.

- **Direction:** newly-rejecting → reversible.
- **Measured population newly rejected: 0 of 1137 corpus sets, 0 of 15 adopter sets.**
  (Measured from the PARSED AST via a temporary probe in the guard itself, not from source text.
  A text-regex first pass claimed `compiler/self-host` as a hit; that was a **false positive** —
  `ast.scrml`'s `sessionExpiry` is a local variable in self-hosted compiler logic, not a `<program>`
  attribute. Corrected before quoting. No corpus or adopter file declares either attribute at all.)
- **Cost:** one new diagnostic code.
- **Note:** an author who legitimately wants two programs in one directory keeps every existing
  escape — compile them into separate output directories, or declare the attribute explicitly on
  each program. The error says so.

**Code shape** — in `compiler/src/codegen/index.ts`, immediately after `_programDecls` /
`_multiProgramCompileSet` (which already exist and already recurse):

```ts
if (_multiProgramCompileSet) {
  const _contested = _programDecls.filter((p: any) =>
    ((p.attrs ?? []) as any[]).some((x: any) =>
      x && (x.name === "sessionExpiry" || x.name === "session-secure")
      && x.value && x.value.kind === "string-literal"));
  if (_contested.length > 0) {
    errors.push({
      code: "E-MW-008",
      message:
        `this build declares ${_programDecls.length} <program>s and ${_contested.length} of them ` +
        `declare session configuration (session-secure= / sessionExpiry=), but the session cookie ` +
        `NAME and lifetime are application-scope: a compiled server mints one cookie name and its ` +
        `readers are compile-time specialized to it.\n` +
        `  The compiler cannot tell which <program> owns a unit that declares neither (SPEC §40.8 ` +
        `makes entry identity a BUILD fact), so it can only guess — and guessing either downgrades ` +
        `an unrelated program's cookie or splits one program's own units across two cookie names.\n` +
        `  Fix: build one application per output directory, or declare session-secure=/sessionExpiry= ` +
        `explicitly on every <program> in this build.`,
      // file/line from the first contested node's span, as E-MW-007 does with `sources`
    });
  }
}
```

**§34 catalog row** (`compiler/SPEC.md` ~`:20800`, beside `E-MW-007`, same column shape):

```
| E-MW-008 | §20.5.1 | A build declares more than one `<program>` and at least one declares session configuration (`session-secure=` / `sessionExpiry=`) — the session cookie NAME and lifetime are application-scope (§20.5.1) and a compiled server mints exactly one name, whose readers are compile-time specialized to it. Because SPEC §40.8 makes entry identity a BUILD fact and `E-PROGRAM-002` is reserved-not-implemented, the compiler cannot attribute a unit that declares neither attribute to an owning `<program>`; resolving it build-wide silently strips `__Host-`/`Secure` from an unrelated program's cookie, and suppressing it splits one program's own units across two disjoint cookie readers. The diagnostic names every `<program>` declaring session config. Sibling of `E-MW-007` (§40): same "two applications in one compiled server" class, different application-scope fact. | Error |
```

**§40-local mirror row** (~`:23826`, the shorter form):

```
| E-MW-008 | A build declares more than one `<program>` and at least one declares session configuration (`session-secure=` / `sessionExpiry=`) — two applications contesting one application-scope session cookie name (§20.5.1); the server mints exactly one | Error |
```

### Option B — WARN, and keep the current suppression

Same detection, but a warning at each unit whose answer the suppression **actually changed**, rather
than a refusal. Turns the silent break loud without minting a rejection.

- **Direction:** inert on emitted code; adds a diagnostic.
- **Measured population newly warned: 0 of 1137 corpus sets, 0 of 15 adopter sets.**
  Measured *directly*, not statically: a set is hit iff some emitted unit's session config differs
  between the unrestricted build (`origin/main` manifest) and the suppressing build (branch
  manifest). Across all 1137 sets, **no unit's answer changed** — which is the same fact as the
  0-delta corpus A/B, read from the other side.
- **Cost:** one new diagnostic code, and it still ships the broken shape — warned, but broken. A
  warning does not stop program A's two units disagreeing; it only tells you they will.

**Code shape** — the precise condition ("would *otherwise* have inherited") is only knowable in
`emit-server.ts`, where the unit's own read has already returned `undefined` and `_needsSessionInfra`
is known. So the driver stamps the context and emit-server fires it at the exact suppression site:

```ts
// codegen/index.ts, beside the existing stamps:
const _suppressed = _multiProgramCompileSet && _programDecls.some((p: any) =>
  ((p.attrs ?? []) as any[]).some((x: any) =>
    x && (x.name === "sessionExpiry" || x.name === "session-secure")
    && x.value && x.value.kind === "string-literal"));
for (const f of files) (f as any)._programSessionConfigSuppressed = _suppressed;

// codegen/emit-server.ts, where _sessionSecureSetting / _sessionMaxAgeSec fall through
// to the default AND _needsSessionInfra && _webAppShape is already true:
if ((fileAST as any)._programSessionConfigSuppressed && _sessionSecureSetting === undefined) {
  warnings.push({
    code: "W-SESSION-CONFIG-NOT-INHERITED",
    message:
      `this unit declares no session configuration, and the build contains more than one ` +
      `<program>, so it CANNOT inherit one — it falls back to the secure default ` +
      `(__Host-scrml_sid, 1h). If this unit belongs to a <program> that declares ` +
      `session-secure=/sessionExpiry=, its cookie will NOT match that program's other units. ` +
      `Declare the attribute on this unit, or build one application per output directory.`,
  });
}
```

**§34 catalog row:**

```
| W-SESSION-CONFIG-NOT-INHERITED | §20.5.1 | A unit declares no session configuration and the build contains more than one `<program>`, at least one of which declares `session-secure=` / `sessionExpiry=`, so the §20.5.1 program-wide inheritance is SUPPRESSED (the compiler cannot attribute this unit to an owning `<program>` — §40.8 makes entry identity a BUILD fact and `E-PROGRAM-002` is reserved-not-implemented) and the unit falls back to the secure default `__Host-scrml_sid` / 1h. If the unit in fact belongs to a declaring `<program>`, its cookie name will not match that program's other units and the two readers are disjoint. | Warning |
```

### Option C — REVERT to the pre-#1062 build-wide behaviour, and rule from scratch

Stated so it is visibly rejected rather than unexamined.

- **It restores the security hole**, and the hole is worse than the brief recorded: executed against
  a real `Request`, the bled `session-secure="false"` strips the **`Secure` attribute itself**, not
  just the `__Host-` prefix — program B's session cookie becomes transmissible over plain HTTP.
  Verbatim pre-fix header: `scrml_sid=…; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`.
- It trades a population-zero *functional* regression for a live *security* regression in the same
  population. Strictly worse than both A and B.
- **Rejected.** Recorded only for completeness.

---

## 4. Recommendation: **A**

1. **It is the only option that actually closes F1.** B leaves program A's units disagreeing; it
   just narrates the break. A shape that cannot be compiled correctly should not compile.
2. **It follows settled precedent rather than setting one.** `E-MW-007` already refuses "two
   applications in one compiled server" as an `Error` with the remedy *"build one application per
   output directory"*. Session config is the same class of application-scope fact, and §40's own
   parenthetical already frames `E-MW-007` as "the emitted-server consequence" of the reserved
   `E-PROGRAM-002` shape. A is the second member of an existing family.
3. **Newly-rejecting is the reversible direction**, and the measured population is 0 / 1137 and
   0 / 15. If it turns out to bite, relaxing an error is cheap; un-shipping a silently split session
   is not.
4. **It keeps the guard honest.** Today the fix's correctness argument is "we suppress, and the
   suppression is safe" — which F1 shows is false in one shape. Under A the argument becomes "we
   suppress only where suppression is safe, and refuse where it is not", with no remaining shape
   where the compiler silently guesses.

The one real argument for B is that A refuses a configuration that *might* be legitimate — two
genuinely separate apps in one directory, one of which sets `session-secure="false"`. A's message
names both escapes for exactly that author, and the measured population choosing it today is zero.

**If A is chosen**, the F1 known-cost test flips from asserting the split to asserting the refusal,
and the `TODO(bryan-ruling)` block in `codegen/index.ts` is replaced by the emit.
**If B is chosen**, that test stays as-is and gains a warning assertion.

---

## 5. THE RULING, AND WHAT BUILDING IT CHANGED (S436 round 3)

**Ruled: option A.** Reasons, as accepted: it is the only option that CLOSES F1 rather than
narrating it; the `E-MW-007` precedent at `SPEC.md:23763` makes it an extension of a settled rule
rather than a new language position; newly-rejecting is the reversible direction; and the measured
population is zero.

### 5.1 The firing condition had to be NARROWED, and a real test caught it

The condition proposed in §3 above was:

> 2+ `<program>` declarations in one compile set **and** at least one of them declares
> `session-secure` or `sessionExpiry`.

**That is wrong, and shipping it would have been a second regression.** It fires on a compile set
where EVERY `<program>` declares both attributes explicitly — a shape with no unattributable unit,
where nothing is guessed and nothing bleeds, and which **S433 deliberately RULED valid** and pinned
in `compiler/tests/integration/session-program-scope-multi-unit.test.js` ("a unit's OWN
sessionExpiry outranks a SIBLING program's (F1-1)": `aaa` at `30m` and `zzz` at `7d`, each keeping
its own). That test went **red** on the first cut and caught it.

It was worse than a false positive. The message in §3 advertises, as its second remedy, *"declare
`session-secure=`/`sessionExpiry=` explicitly on every `<program>` in this build"* — and under the
§3 condition, following that advice **did not clear the error**. The diagnostic promised an escape
the implementation did not honour.

**The shipped condition**, per attribute, because the two are independent:

> 2+ `<program>` declarations **and**, for `sessionExpiry` or for `session-secure`, some
> `<program>` declares it **and** some compilation unit cannot resolve it for itself.

That last clause is the whole rule stated honestly: *fire exactly when the compiler would otherwise
have to guess a unit's owner.* It refuses every shape where guessing happens (the original
build-wide leak, F1's split, F2's two-programs-in-one-file) and permits every shape where it does
not (S433's mutually-declaring programs, a single program over many units, two programs that
contest nothing).

**One deliberate over-approximation, recorded rather than hidden:** a unit counts as
"would have to inherit" whether or not it would actually EMIT session infrastructure. Testing that
too would mean mirroring emit-server's `_needsSessionInfra && _webAppShape` predicate inside the
driver, and a mirrored predicate is exactly the thing that drifts. The cost is over-rejecting a
compile set whose second program never touches sessions; the measured population of that
over-rejection is **0**. Note also that any divergence between the driver's
`_unitResolvesForItself` and emit-server's `_readRawProgramAttr` fails **closed** — missing a
self-declaration makes the error fire where it need not, never the reverse.

### 5.2 Measured population of the SHIPPED condition

Measured by compiling and counting the diagnostic — the IMPLEMENTED condition, not the §3
hypothesis, and not a source-text regex (see the withdrawn measurement in round 2):

| population | newly rejected |
|---|---|
| corpus: 1,137 directory compile sets over all 2,640 tracked `.scrml` | **0** |
| adopter clone `assetManagement`: 15 per-directory sets + the whole `app/src` tree as one set | **0 of 16** |

Positive control, so the zeroes are not blind — the same harness on the synthetic canary:
`two-programs`, `f2-two-programs-one-file` and `f1-multiunit-beside-2nd` each report
`{"E-MW-008":1}`, while `one-program-two-units` and `f3-nested-program` report none.

### 5.3 Scoping, verified through the real CLI

| fixture | result |
|---|---|
| two programs, `log=` on both, no session config | `E-MW-007`, **not** `E-MW-008` — the older sibling is not masked |
| two programs, `session-secure` on one, no pipeline attrs | `E-MW-008` |
| two programs, neither pipeline nor session config | **exit 0** — this is NOT `E-PROGRAM-002` |
| one program + a member page | **exit 0** — #282 preserved |

`E-MW-008` is emitted in `compiler/src/codegen/index.ts`, so it is carried by the `compileScrml`
library API as well as by `scrml build` and `scrml dev`. Confirmed through the real CLI: the F1
fixture now fails the build with `[CG] …/index.scrml:1:1 E-MW-008: …`, where before the ruling it
exited **0** and silently emitted the split.

### 5.4 SPEC rows, and a deviation from the instruction

Both rows landed: the §34 catalog form beside `E-MW-007`, and the §40-local mirror.

The instruction asked for them **with `prov=`** citing the S436 review and the `E-MW-007`
precedent. **`prov=` is not a SPEC.md convention** — it occurs 0 times in `compiler/SPEC.md`. It is
the `@gap` marker vocabulary in `docs/known-gaps.md` (`prov=review:…`, `prov=spec:§…`,
`prov=ruling:…`, `prov=empirical:…`, 643 uses repo-wide, "as of S313"). Rather than invent a new
attribute syntax inside SPEC.md, both rows carry the provenance in SPEC.md's own established in-row
prose form — the same form `E-MW-007` uses for its own `(Emitted at …)` provenance — ending
*"Provenance: S436 review of the §20.5.1 program-scope fix; precedent `E-MW-007` at §40 (line
~23763)."* If a `prov=` marker is wanted, it belongs on a `known-gaps.md` entry, not on a SPEC row.

### 5.5 What the ruling changed in the test suite

`conf-SESSION-PROGRAM-ATTR-SCOPE.test.js` previously carried
`"KNOWN COST (F1, awaiting ruling) — a multi-unit program beside a 2nd program splits its own
cookie name"`, which asserted the split and asserted the two emitted reader regexes were disjoint.
That configuration no longer compiles, so the test is **inverted**: it now asserts the refusal, and
says in its own comment why it changed and where the old expectations went (here). The file also
gained the scoping matrix of §5.3 and a test pinning the advertised escape of §5.1.
