#!/bin/bash
# For every truly-changed artifact, classify the diff by what its changed lines mention.
S=/home/bryan-maclee/.cache/scrml-agent-tmp/s459-ref2a-r2
cd $S
bun cmp2.mjs | tail -n +2 | while IFS=: read -r f arts; do
  d=$(echo "$f" | sed 's#/#__#g')
  for a in $arts; do
    if [[ $a == *HASH.js ]]; then
      pb=$(ls cout-base/$d/scrml-runtime.*.js); ph=$(ls cout-head/$d/scrml-runtime.*.js)
    else
      pb=cout-base/$d/$a; ph=cout-head/$d/$a
    fi
    lines=$(diff <(sed "s#$S/base#TREE#g" "$pb") <(sed "s#$S/head#TREE#g" "$ph") | grep '^[<>]')
    tags=""
    echo "$lines" | grep -q "ssr-seed\|_scrml_ssr_seed\|E-CONTRACT-\")) === 0\|try {$\|} catch (_e) {" && tags="$tags ssr-seed-guard"
    echo "$lines" | grep -q "_scrml_refine\|_scrml_deep_set\|_scrml_deep_reactive" && tags="$tags refine-chunk"
    echo "$lines" | grep -q "refine_register\|_scrml_judge_parts_" && tags="$tags registration-descriptor"
    other=$(echo "$lines" | grep -v "_scrml_refine\|refine_register\|_scrml_judge_parts_\|ssr-seed\|_scrml_ssr_seed\|_scrml_deep_set\|_scrml_deep_reactive\|^[<>] *//\|^[<>] *$\|^[<>] *}\|^[<>] *};\|^[<>] *{\|^[<>] *return\|^[<>] *const \|^[<>] *let \|^[<>] *if \|^[<>] *for \|^[<>] *else\|^[<>] *throw\|^[<>] *_scrml_\|^[<>] *[a-z]*(\|^[<>] *[a-z]*: \|^[<>] *\"\|^[<>] *restore\|^[<>] *apply\|^[<>] *raw\|^[<>] *es\|^[<>] *ds\|^[<>] *live\|^[<>] *whole\|^[<>] *before\|^[<>] *outer\|^[<>] *function\|^[<>] *n:\|^[<>] *try\|^[<>] *} catch" | head -3)
    echo "$f :: $a ::$tags :: other=[$other]"
  done
done
