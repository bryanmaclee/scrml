# s451-spec-open-items — progress

Authority: ruling:user-voice-scrml.md S451 "your recs on all five" (the last entry of the S451 block).
Branch: spec/s451-open-items (cut from origin/main 2fb41d8b7, which contains #1253).

- 2026-10-03 start. Read the ruling entry in full, the #1253 progress.md, and §13.7, §19.4.3, §19.6, §19.7, §19.8,
  §19.9.1–§19.9.5, §6.7.7, §52 (intro, §52.4, §52.5, §52.6), §55.5.3, §57, §2, §34.0 in full before amending.
- 2026-10-03 ITEM 4 — §57.5 rewritten: R10 wins. Internal routes strict now and from v1.0; `<api>` responses and
  `<endpoint>` requests keep the dual decoder past v1.0. Struck (quoted in the provenance): the "retires at v1.0"
  ratification line, the scaffold-lifetime bullet, the v1.0 canonical-only bullet, the "v1.0+ decoders MAY refuse"
  half, and the OPEN. §12.5.1's "the v1.0 clean-break schedule" pointer updated. Direction: newly-accepting on
  foreign endpoints vs the struck v1.0 schedule; nothing changes today. impl#1: no new gap.
  NOT TOUCHED, flagged: §6.14.4 O-061-12 asks whether persisted storage values bind to "the §57.5 canonical-only
  decoder at v1.0" — that decoder no longer retires at v1.0, so the question's premise moved; still OPEN (not ruled).
