# unit-id: s468-errorboundary-returned-error
Gap: `g-errorboundary-runtime-does-not-catch-returned-error-value-s467` (HIGH). Read its full entry in docs/known-gaps.md
(locus, prov, symptom). SPEC §19.6 (errorBoundary; §19.6.4-§19.6.8) is the governing section — quote the sentence.
Cover: a `!` call in markup context under one boundary, nested boundaries (inner catches first), variant `renders` vs
`fallback=` priority (§19.6.5), and that the §19.6.8 host-throw backstop still works.
