#!/bin/zsh
# shoot.sh <checkout> <out>: one run of recipe.ts (before: origin/main; after: the fix branch). DUSK_CDP_CHROME may point at a Chrome for Testing.
cd $1 && REPO=$1 OUT=$2 node --experimental-strip-types ${0:A:h}/recipe.ts > $2.log 2>&1
