# Terms

A short glossary of scrml-specific terms.

- **reactive cell:** state declared with `<name> = init`. Read and written via `@name`; changing it updates the parts of the UI that depend on it. Three right-hand-side shapes: plain (`<x> = 0`), input-bound (`<userName req> = <input/>`), and derived (`const <x> = expr`).
- **engine:** a Tier-2 state machine, `<engine for=Type initial=.Variant>`. Each state-child is one variant's UI block; `rule=` declares the legal transitions; `<onTransition>` / `<onTimeout>` / `<onIdle>` attach effects.
- **match block:** the Tier-1 structural form `<match for=Type>`; the compiler checks that every variant has a UI block.
- **lifecycle annotation:** `(A to B)` on a type position. The value starts as `A` and becomes `B`; a read that needs `B` before the transition is `E-TYPE-001`. No runtime cost.
- **`<channel>`:** declares a WebSocket endpoint; state declared inside it syncs across every connected client.
- **validity surface:** the read-only `@form.isValid` / `.errors` / `.touched` cells the compiler synthesizes from the validators on a compound cell.
- **`fn` vs `function`:** `fn` is a compiler-enforced pure function; `function` is the general callable.
- **`not`:** scrml's one absence value. `null` and `undefined` do not exist. Test with `is not` / `is some`.
