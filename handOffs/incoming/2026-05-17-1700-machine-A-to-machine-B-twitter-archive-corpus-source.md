---
from: scrmlTS-PA-machine-A (S99)
to: scrmlTS-PA-machine-B (next pickup)
date: 2026-05-17
subject: Twitter archive added to voice/corpus-sources — ready for next corpus-refresh pass
needs: action (corpus-refresh)
status: unread
---

# Twitter archive — new corpus source

User dropped their full Twitter / X archive on Machine A. Moved to the voice corpus pipeline. Pushed at scrml-support `6ef8782`.

## Where

```
scrml-support/voice/corpus-sources/twitter-archive-2026-05-17.zip   (21 MB)
scrml-support/voice/corpus-sources/README.md                         (pipeline doc)
```

`corpus-sources/` is a NEW subdirectory I created — it formalises the staging area for raw archives (distinct from candidate JSONs + curated quote-library). README at that path documents the convention.

## What's in the zip

Standard Twitter export: `data/*.js` (JSONP files — `window.YTD.<name>.part0 = [ ... ]`), `assets/` (twemoji + images), `Your archive.html` (top-level index). Voice-mining substance:
- `data/tweets.js` — original tweets + replies + RTs
- `data/note-tweet.js` — long-form tweets
- `data/account.js` — handle + display name
- `data/profile.js` — bio
- `data/like.js` — likes (exclude — not voice)

## Extraction caveats per voice-author S95 rules

- **JSONP prefix strip needed** — `data/*.js` start with `window.YTD.<name>.part0 = ` then pure JSON. Extract by chopping the prefix.
- **Voice-mining scope**: include original tweets + replies user wrote (not RT'd / not parent of reply); include note-tweets; exclude likes + DMs + media-only-no-text.
- **Voice texture**: tweets carry industry-vernacular shorthand + short-form rhetorical compression — preserve grammar/punctuation per S95 preserve-voice-texture rule. Loose-correct obvious typos only.
- **Topic tagging**: use the existing 20-vector approach from `machine-B-corpus-candidates-2026-05-17.json`. Twitter-source quotes likely cluster heavier in `industry-field-culture`, `language-design`, `react-vue-comparison`, `llm-era-adoption`.

## Suggested output

`scrml-support/voice/machine-B-corpus-candidates-twitter-2026-05-17.json` (or similar naming continuing the per-source candidate file pattern).

## Parallel: Machine-A-side Claude-project corpus extraction is STILL PENDING

Machine B's S98B wrap report flagged that the same `/tmp/extract_corpus.py` script could run against Machine A's Claude-project dirs to produce a parallel `machine-A-corpus-candidates-<date>.json`. I have NOT done that audit yet this session — explicitly answered the user about it; deferring to a session-end window or a dedicated dispatch. Not blocking the twitter pass; the two sources are file-disjoint and can be processed independently.

## Tags

#cross-machine #s99 #voice-corpus #twitter-archive #raw-source-staged #corpus-sources-new-dir #fyi
