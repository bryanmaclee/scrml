# BRIEF — §40.8 default-logic body: a `//` comment emits the surrounding statements as page text (S368-bryan)

DONE-PROBE: bash -c 'd=$(mktemp -d); bun compiler/bin/scrml.js compile docs/changes/default-logic-line-comment/repro-minimal.scrml --output-dir "$d" >/dev/null 2>&1; grep -q "log(\"M1\")" "$d"/repro-minimal.html && exit 1 || exit 0'

## The defect — PA-reproduced by EXECUTION on main @ 772c0fb2

In a `<program>` body parsed in **§40.8 default-logic mode** (no explicit `${…}` wrapper), a `//`
line comment causes the contiguous run of statements around it to be emitted **verbatim into the
page body as text** instead of compiled. **Exit 0. Zero diagnostics.**

Minimal reproducer — `docs/changes/default-logic-line-comment/repro-minimal.scrml`, four lines:
```scrml
<program>
// c
log("M1");
<p>ok</>
</program>
```
Emitted `<body>` contains the literal text `log("M1");`.

The original hand-written file that surfaced it is archived beside it as `repro-original.scrml`.

## Measured characterisation — do not re-derive, but DO re-verify

| shape | result |
|---|---|
| `//` + 1 following statement | statement emitted verbatim |
| `//` + 3 following statements | **all three** verbatim |
| statement BEFORE the comment + 1 after | **both** verbatim — it poisons the run in both directions |
| same code inside an explicit `${ … }` block | **CLEAN** — compiles correctly |
| `/* block */` instead of `//` | **CLEAN** — the correct error fires |

**The working path is one function over.** The `${…}` path handles this correctly; the §40.8
auto-lift does not treat a `//` line comment as logic-context content.

## ⚑ The masking limb — why this is HIGH, and it must be covered by the fix

In the original file the swallowed statement is `log(@wop);` where `@wop`'s declaration is
**commented out**, so `@wop` is undeclared. **`E-STATE-UNDECLARED` does not fire** — the statement
was never compiled. Measured: comment removed → exit **1** with the error; comment present → exit
**0**, silent.

**A defect that converts code to text also suppresses every diagnostic that code would have
raised.** So the blast radius is not bounded by any one rule. Your fix must restore BOTH: the
statement compiles, AND the diagnostics it should raise fire.

Separately measured and **not yet traced** — record what you find: adding a `fn` declaration to the
file suppresses the residual diagnostic too (comment-only → exit 1 with the error still raised;
comment + `fn` → exit 0, fully silent). Establish whether that is the same root or a second one.

## Scope

1. **Root fix.** The §40.8 default-logic auto-lift must treat a `//` line comment as logic content.
   Loci are **PA-located, VERIFY THEM** — `compiler/src/ast-builder.js` (`liftBareDeclarations` +
   the default-logic body path), the block-splitter, `compiler/src/tokenizer.ts`. I did not trace
   the decision site; report whether the hypothesis held, was refined, or was wrong.
2. **Sweep the CLASS, not the instance.** A defect that turns code into page text is a
   silent-wrong-output class and is unlikely to have one member. Ask: what OTHER non-declaration
   content in default-logic mode can be silently reclassified as text? Report the population you
   find, including zero.
3. **Merge-blocker test** asserting the minimal reproducer compiles the statement rather than
   emitting it, AND that a diagnostic in the swallowed run still fires.

## Related but OUT of scope — file, do not fix

- `expression-parser.ts:3015` emits *"statement boundary not detected — trailing content would be
  silently dropped"* via **`console.warn`**, so it reaches no diagnostic stream and no adopter ever
  sees it. It did NOT fire on this reproducer (different path — ASI merge inside expression
  parsing), but it is the same silent-drop family reporting to nobody. Worth its own entry.
- `W-PROGRAM-REDUNDANT-LOGIC` tells authors *"Remove the redundant `${...}` for cleaner source"* —
  routing them into the broken mode. Once the root fix lands the two modes are equivalent again and
  the advice is fine; do not touch the lint in this arc.

## Verification

- **Reproduce first, before changing anything.** Do not take this brief on trust.
- **Direction-of-change (pa-base §8).** Making previously-text statements compile is
  `semantics-changed` — same source, different behaviour, likely no diagnostic delta. That is the
  class the gates are weakest against, so a **full-corpus emit differential is mandatory**:
  `bun scripts/corpus-emit-differential.ts`. Any artifact that changes is a program whose meaning
  moved; enumerate every one and say why each is correct.
  ⚑ That tool hashes scope ids against a project root — if you compare against a checkout lacking
  `scrml.toml`/`.git`, every id shifts and you will read ~1000 false diffs. Give both sides a root
  marker.
- Full suite `bun run test` (chains `pretest`); conformance `bun conformance/run.ts`. Known
  pre-existing baseline failures (self-host ×3 / self-compilation / session) are not yours —
  establish your baseline by running at your merge-base rather than assuming.
- Measure exit codes DIRECTLY, never through a pipe.

## Process

Commit after each unit; WIP commits expected; append to `progress.md` here. Never `--no-verify`,
never override `core.hooksPath`. **Do not touch `compiler/src/codegen/emit-each.ts`,
`exportRegistry`, the name-resolver, or `compiler/src/codegen/runtime-chunks.ts` — concurrent
sessions own those surfaces.**

Report: files touched, final SHA, whether each PA locus held, the class-sweep population, the
differential result, and any DEFERRED item WITH ITS REASON.
