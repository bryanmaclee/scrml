# Route → bryan: correction to a filed HIGH gap's root-cause characterization (channel mount in match arm)

**From:** S391-peter (flogenceP `app.scrml` dog-food)
**Re:** `@gap g-state-undeclared-over-fires-on-imported-channel-cell-read-inside-a-match-arm` (HIGH, open — known-gaps.md ~L101)
**Kind:** root-cause correction (not a new gap) + fix-direction + fresh adopter witness. PA-verified by execution on HEAD `952cecc6`.

## TL;DR
The filed gap says *"the mount is **irrelevant** (B errors without it)… scope resolution inside a match arm appears not to consult the imported channel's cell table."* That points the fix at the **read** side. **It is wrong on the load-bearing point — I falsified it by execution.** It is the **MOUNT's** position that breaks it, not the read's. Hoisting the mount out of the `<match>` arm (leaving every `@cell` read *inside* the arm) compiles **clean**.

## The two-line executable falsification (run on HEAD)
Both variants use flogenceP's real `channels/fsp.scrml` (declares `<tasks>`,`<lastBeat>`) beside the file.

- **FAILS** (app.scrml's shape) — mount + reads both inside the `<Ready>` arm → `E-STATE-UNDECLARED`.
- **CLEAN (exit 0)** — mount hoisted ABOVE the `<match>`, reads left INSIDE the `<Ready>` arm:
```scrml
<program lang="ts">
  ${ import { "fsp" as fspChannel } from './channels/fsp.scrml'
     <phase>: Phase = .Loading }
  <fspChannel/>                              <!-- mount at body level -->
  <div><match for=Phase on=@phase>
    <Loading><p>load</p></>
    <Ready>
      <p>${@lastBeat}</p>                    <!-- read INSIDE the arm — resolves fine -->
      <each in=@tasks as t key=t.taskId><li>${t.taskId}</li></each>
    </>
  </></div>
</program>
```
Matrix (one variable each, all PA-run): mount-in / read-in → FAIL · mount-**out** / read-in → **CLEAN** · mount-in / read-out → FAIL. ⟹ the discriminating variable is **mount position**, so the gap's "mount is irrelevant / B errors without it" is not reproducible as stated (a mount-less read is a *different* undeclared-name case).

## Mechanism (PA-located; re-derive before fixing)
- Channel-cell collectors `collectChannelNodes` / `collectChannelCellMap` / `collectChannelFunctionMap` (`compiler/src/codegen/emit-channel.ts:~67,~493`) recurse **only via `node.children`**. A `<match>` lowers to `kind:"match-block"` whose arm content lives under `armBodyChildren`/`bodyChildren`, never `.children` — so a mount in an arm is **never collected** → cells never register → every bare `@cell` read is `E-STATE-UNDECLARED`. Same for `<each>` bodies.
- Why the adopter gets the *misleading* error rather than the clean refusal `E-CHANNEL-MOUNT-IN-CONDITIONAL` (`component-expander.ts:4968`, labels ~4947): app.scrml's arms also contain `<each>`, and an **each-bearing bare-body arm is blanked to raw text (S316) before CE runs** — this is **Hole #1**, already documented verbatim at `component-expander.ts:4862-4884`. The refusal walk has no node to find. Closing Hole #1 ("give CE a walkable arm body") is called out there as its own arc.
- **Fix direction:** either descend `armBodyChildren`/`each` bodies in the channel collectors (so an in-arm mount registers — but note that would *support* a shape the S385 ruling deliberately *refuses*, so the coherent move is likely the refusal side), OR close Hole #1 so `E-CHANNEL-MOUNT-IN-CONDITIONAL` fires for the each-bearing arm and the adopter gets the actionable diagnostic instead of `E-STATE-UNDECLARED`. Your ruling — the two limbs move the surface differently.

## Companion notes (both PA-observed this session, reconcile into the gap entry)
- Companion ⑵ ("diagnostic carries NO source location — `stage: TS`, no line/col") appears **RESOLVED** — on HEAD I get `app.scrml:3665:111` etc. (compile-mode source locations landed, cf. #756). Suggest flipping that sub-claim.
- Companion ⑶ ("`each in=` reads never checked") is **partially closed by your S390 #785 (each-in scope check)** — `<each in=@tasks>` / `<each in=@acks>` now DO fire (the adopter's error count went 3→5 across the S390 tightening). Consistent, not a regression.

## Adopter status (no action owed to you here)
flogence's flagship cockpit is **unblocked** — I hoisted both mounts to program level (the supported form) on flogenceP branch `fix/channel-mount-hoist-out-of-match-arm` (281b2d3): compiles 0 errors, boots + serves 200, both channel WS handlers registered, client wires all 4 cells, no dangling mount tags. So this route is about the **scrml-side gap characterization + fix direction**, not an urgent adopter unblock.
