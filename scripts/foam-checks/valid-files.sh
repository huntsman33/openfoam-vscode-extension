#!/bin/bash
# List the OpenFOAM dictionary files under the given roots that OpenFOAM itself can read
# (foamDictionary succeeds from the file's own directory). Needs OpenFOAM loaded.
# Usage: valid-files.sh <root>... > files.txt
for root in "$@"; do
    find "$root" -type f \( -path '*/system/*' -o -path '*/constant/*' -o -path '*/0/*' -o -path '*/0.orig/*' \) \
        ! -path '*/polyMesh/*' ! -path '*/triSurface/*' ! -path '*/geometry/*' ! -path '*/processor*' \
        ! -name '*.gz' ! -name '*.stl' ! -name '*.obj' ! -name '*.vtk' ! -name '*.csv' ! -name '*.dat' \
        ! -name '*.py' ! -name '*.awk' ! -name '*.md' ! -name '*.eMesh'
done | xargs -P 16 -I{} sh -c 'head -c 4000 "{}" | grep -q FoamFile && (cd "$(dirname "{}")" && timeout 20 foamDictionary "{}" >/dev/null 2>&1) && echo "{}"' | sort
