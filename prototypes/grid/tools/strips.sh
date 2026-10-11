#!/bin/sh
# Contact strips for the all-layers captures: shots/combo-<name>-strip.png
cd "$(dirname "$0")/.."
S=shots/combo
mk() { name=$1; cols=$2; shift 2; args=""; i=0; for f in $S/$name-0*.png; do args="$args f$i=$f"; i=$((i+1)); done; [ -n "$args" ] && node tools/strip.mjs shots/combo-$name-strip.png $cols 960 $args; }
for n in fight storm storm-s1 storm-s3 storm-reduced storm-2d bossdead bossdead-reduced bossdead-2d bossdead-still bomb bomb-reduced voidheart singularity dash death; do mk $n 2; done
