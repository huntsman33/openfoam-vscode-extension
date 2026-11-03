#!/bin/bash
# Compare how OpenFOAM reads an original file and its formatted copy.
# Usage: MIRROR=<mirror root> SRC_ROOT=<source root> foam-compare.sh <original file>
f="$1"; m="$MIRROR/${f#"$SRC_ROOT"/}"
a=$(cd "$(dirname "$f")" && timeout 20 foamDictionary "$f" 2>/dev/null); ra=$?
b=$(cd "$(dirname "$m")" && timeout 20 foamDictionary "$m" 2>/dev/null); rb=$?
if [ $ra -ne 0 ]; then echo "ORIG_UNPARSEABLE $f"
elif [ $rb -ne 0 ]; then echo "BROKE_PARSE $f"
elif [ "$a" != "$b" ]; then echo "CHANGED_MEANING $f"
else echo "SAME $f"; fi
