## S357 — g-promote-engine-same-named-cell-no-lift (2026-08-21T03:51:24Z)
- Reproduced: promote --engine on <phase>:Phase + <match on=@phase> reverted (E-ENGINE-VAR-DUPLICATE).
- Fix: promote.js lifts redundant same-named decl; initial= seeded from decl's declared value.
- SPEC §56.6.2/§56.6.3 updated; +3 bite tests. Full unit suite 17628 pass / 0 fail.
