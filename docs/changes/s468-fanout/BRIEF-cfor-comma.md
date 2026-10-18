# unit-id: s468-cfor-comma-lists
RULED build (S464, bryan "b" — user-voice-scrml.md §S464 "comma lists are legal in a C-style `for` header's init and
update parts, on both client and server; the comma operator stays refused in every value position"). Read that entry.
Build: (1) one SPEC sentence beside §40.8 / §4.18.2 "scrml has no comma operator" saying a C-style `for` header's init (a
declarator list) and update (a discarded-value step list) admit comma-separated lists, both sides; every value
position still refuses the comma operator — with `> **Provenance:** ruling:user-voice-scrml.md S464` inline; regen
SPEC-INDEX. (2) parser/codegen so `for (let i = 0, j = n; i < j; i++, j--)` compiles identically on client AND server
(today the server refuses `i++, j--` while the client lowers it). (3) negative tests: comma operator in a condition,
an assignment RHS, an argument, a return — still refused. Newly-accepting but RULED: the ruling is your governing
sentence.
