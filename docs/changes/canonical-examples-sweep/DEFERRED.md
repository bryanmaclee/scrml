# Canonical-examples sweep — deferred items

**Filed:** 2026-05-14 (S93)
**Origin:** S93 canonical-examples sweep recovery — two files surfaced shape concerns that the sweep did NOT migrate fully. Filed here for follow-up work.

Adjacent to the BS-layer corpus-friction bug batch at `docs/changes/bs-layer-corpus-friction-bugs/SCOPING.md` — both deferred items below are downstream consequences of similar BS-layer / parser surface-area gaps.

---

## Deferred 1 — `22-multifile/types.scrml` non-entry pure-type file requires `${}` wrapper

### Symptom

S85 Q2 canonical shape says: *"non-entry files (modules) have NO `<program>` wrapper at all, just imports + exports + declarations at file-top."*

`22-multifile/types.scrml` currently uses:

```scrml
${
  export type UserRole:enum = {
    Admin
    Moderator
    Member
    Guest
  }

  export function badgeColor(role: UserRole) -> string {
    match role {
      .Admin     => "red"
      ...
    }
  }
}
```

The `${}` wrapper is NOT canonical per S85 Q2. The expected shape per S85 + the in-file `§21.5 pure-type file` comment is:

```scrml
export type UserRole:enum = { ... }

export function badgeColor(role: UserRole) -> string { ... }
```

### Verification of current compiler behavior (S93 test)

Compiling the canonical bare-export shape fires:

```
warning [W-PROGRAM-001]: No <program> root element found. Consider wrapping your file content in <program> ... </program> for explicit configuration of database connections, protection, and HTML spec version.

error [E-IMPORT-001]: `export` declaration is placed outside a `${ }` logic block. All `export` statements must appear inside a `${ }` logic context. Wrap the declaration: `${ export type }`.
```

### Two distinct compiler issues

**Issue 1A — E-IMPORT-001 forces `${}` wrapper for file-top `export` declarations.** This is a direct contradiction of S85 Q2: non-entry files MUST be able to declare bare-top `export type` / `export function` without a `${}` wrapper. The current rule treats `export` as logic-context exclusive, but in a pure-module (no `<program>`) file, the entire file IS logic-context — there's no markup mode to switch into.

**Issue 1B — W-PROGRAM-001 fires misleadingly on pure-type / pure-module files.** Per SPEC §21.5 pure-type files are a canonical shape (no markup, no `<program>`). The W-PROGRAM-001 lint should suppress on files whose content is exclusively `export type` / `export function` / `import` declarations (the SPEC §21.5 shape). It currently fires regardless, encouraging adopters back toward `<program>` wrappers in pure-module files.

### Suspected root cause

**Issue 1A:** parser/pre-processor enforces `export` statements live inside a `${ }` logic block. The rule was authored when `${ }` was the only logic-context-bearing construct; post-S84 (program-as-container) introduced `<program>` body as logic-default, but the file-top non-entry case wasn't extended. Pure-module files need the same "default mode = logic" rule that `<program>` body now has.

**Issue 1B:** W-PROGRAM-001 emission site doesn't classify the file by content shape. Should detect "pure-module file" (no markup, only export/import/decl statements) and suppress.

### Workaround applied

22-multifile/types.scrml retained the `${}` wrapper from pre-v0.3. The agent's progress.md LESSON LEARNED #2 (the component-def auto-lift bug) covers the related case for `22-multifile/components.scrml`; this types.scrml case is a sibling concern with a distinct root cause (E-IMPORT-001 vs component-def lift gap).

### Spec references

- S85 Q2 ratification — non-entry files have NO `<program>` wrapper
- SPEC §21.5 — pure-type files
- SPEC §34 — E-IMPORT-001 catalog entry
- SPEC §34 — W-PROGRAM-001 catalog entry

### Est: 4-6h (split: parser export-context rule extension ~2-3h + W-PROGRAM-001 emission-site classifier ~2-3h)

### Test

Add `compiler/tests/unit/non-entry-file-bare-exports.test.js`:
- Pure-type file with bare `export type` + `export function` at file-top compiles clean
- W-PROGRAM-001 suppressed on pure-module shape
- Cross-file `import { UserRole } from './types.scrml'` resolves the bare-export

---

## Deferred 2 — `examples/23-trucking-dispatch/pages/driver/hos.scrml` non-entry page with stray `<program>` wrapper

### Symptom

S85 Q2 canonical shape: non-entry files have NO `<program>` wrapper. `23-trucking-dispatch/` is the canonical multi-file app, with `app.scrml` as the entry file carrying the program-level config (`<program db= auth=>`). Every other file under `pages/`, `components/`, `channels/`, `models/` should be a non-entry file — no `<program>` wrapper.

**Audit during S93 sweep** confirmed all 23-trucking-dispatch subdir files are clean of `<program>` wrappers EXCEPT one outlier:

`examples/23-trucking-dispatch/pages/driver/hos.scrml` has:

```scrml
${
    import { DriverStatus } from '../../schema.scrml'
}

<engine for=DriverStatus initial=.OffDuty>     // engine OUTSIDE <program>
    ...
</>

<program db="../../dispatch.db" auth="required">  // ← redundant <program> wrapper

  ${
      import { driverStatusClasses, driverStatusLabel } from '../../components/driver-card.scrml'
      ...
  }

  <db src="../../dispatch.db" protect="..." tables="...">
    ${
        function getCurrentUser(sessionToken) { ... }
        ...
    }
    ...
  </>

</program>
```

The file is 424 lines, mostly server functions + markup. The `<program db="../../dispatch.db" auth="required">` wrapper is REDUNDANT with `examples/23-trucking-dispatch/app.scrml`'s `<program db="./dispatch.db" auth="required">`.

### Why it wasn't migrated in the S93 sweep

Substantial restructure required — not a simple wrapper drop:
- Engine declaration is currently file-top OUTSIDE the redundant `<program>` (legacy pre-v0.3 placement)
- `<db>` declaration is nested INSIDE the redundant `<program>`
- Multiple `${...}` wrappers nested at varying levels
- Server functions reference state cells declared inside the `<db>` body

The migration needs careful per-fragment analysis to preserve scope semantics. Filed as a deferred standalone dispatch rather than risk a brittle PA-hands-on edit.

### Open questions

**OQ-DEF2-A: db/auth attribute inheritance.** Does the entry-file `<program db= auth=>` propagate the `db=` + `auth=` config to all non-entry pages? If YES, hos.scrml's redundant `<program db= auth=>` can be dropped without re-declaring. If NO, the spec needs to define how non-entry pages access the same db/auth context.

**Audit:** the other 29 non-entry files under `23-trucking-dispatch/{pages,components,channels,models}/` have NO `<program>` wrapper and presumably work — implying the answer to OQ-DEF2-A is YES (inheritance works) and hos.scrml is the outlier needing fix-up.

**OQ-DEF2-B: `<engine>` placement in non-entry pages.** Per v0.3 canonical, engines live INSIDE `<program>`. In a non-entry page (no `<program>` wrapper), where does the `<engine>` go? Options:
- (a) At file-top, as a direct file-scope child — same as types/functions
- (b) Disallowed in non-entry files (engines are app-scope singletons; auto-declared engine variables would conflict with the entry-file program scope)

Mario uses option-(a)-shape inside its `<program>` (engine as direct child); whether engines can appear at file-top of non-entry pages is unclear.

**OQ-DEF2-C: pre-existing E-CG-006 + I-AUTH-REDIRECT-UNRESOLVED on 23-trucking-dispatch.** Compiling `23-trucking-dispatch/app.scrml` today (S93) surfaces:
- `E-CG-006`: server-only pattern in client JS output (security violation; pre-existing, NOT migration regression per S93 verify)
- `I-AUTH-REDIRECT-UNRESOLVED`: `/login` redirect target not in RouteMap (Info; expected from v0.3 AuthGraph S91)

These are pre-existing but adjacent. Worth investigating whether the hos.scrml restructure could resolve OR exacerbate either.

### Recommended dispatch shape

Standalone deep-dive + restructure dispatch (T1 surface — touches scrml source in canonical-app fixture):

1. **Phase 0:** verify db/auth inheritance from entry `<program>` → non-entry pages (OQ-DEF2-A). Test by removing hos.scrml's `<program db= auth=>` wrapper + checking whether server functions still escalate correctly. If inheritance works, proceed.

2. **Phase 1:** restructure hos.scrml — drop redundant `<program>` wrapper; move engine to file-top OR inside the file's main markup section; flatten nested `${...}` wrappers where the v0.3 logic-default applies (subject to BS-layer bug batch — some may need to stay).

3. **Phase 2:** verify the file compiles cleanly + still serves the `/driver/hos` route under 23-trucking-dispatch's app shell.

4. **Phase 3:** if OQ-DEF2-B reveals engines can't live at file-top of non-entry pages, surface the gap for spec ratification.

### Est: 8-12h (424-line file + 3 open questions; deep-dive shape)

### Trigger conditions

- A 23-trucking-dispatch full-stack benchmark dispatch (queued bench refresh would touch this app) may benefit from clean state
- Adopter friction on multi-file app shape would accelerate
- BS-layer corpus-friction bug batch fix could be folded in if it touches engine-placement-in-non-entry surface

---

## Cross-link

- Canonical-examples sweep landing: commits `a011a1d` + `6469e96` + `1054f22`
- BS-layer corpus-friction bug batch: `docs/changes/bs-layer-corpus-friction-bugs/SCOPING.md` (related root-cause surface)
- S85 user-voice — Q2 verdict: ONE `<program>` per app; non-entry files have NO wrapper
- S86 user-voice — corpus is artifact, not evidence of design intent
- `feedback_stated_intent_vs_corpus_migration.md` (PA auto-memory) — migration not deliberation rule
