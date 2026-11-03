#!/bin/bash
# Build the test workspace: a minimal case with a 0.orig folder plus files whose
# detection depends on their header or extension.
set -euo pipefail
ws=${1:?usage: make-workspace.sh <dir>}
rm -rf "$ws" && mkdir -p "$ws/case/system" "$ws/case/0.orig"
hdr() { printf 'FoamFile\n{\n    version 2.0;\n    format ascii;\n    class %s;\n    object %s;\n}\n' "$1" "$2"; }
{ hdr dictionary controlDict; echo "application simpleFoam;"; } > "$ws/case/system/controlDict"
{ hdr dictionary caseParams; echo "L 1;"; } > "$ws/case/system/caseParams"
{ hdr volScalarField alphat; echo "dimensions [0 2 -1 0 0 0 0];"; } > "$ws/case/0.orig/alphat"
{ hdr volScalarField p_rgh; echo "dimensions [0 2 -2 0 0 0 0];"; } > "$ws/case/0.orig/p_rgh"
{ hdr volVectorField U.air; echo "dimensions [0 1 -1 0 0 0 0];"; } > "$ws/case/0.orig/U.air"
{ hdr dictionary blockMeshDict; echo "scale 1;"; } > "$ws/case/system/blockMeshDict.main"
printf 'divert(-1)\nFoamFile\n{\n}\n' > "$ws/case/system/blockMeshDict.m4"
printf 'import sys\n' > "$ws/case/compare.py"
printf 'just some notes\n' > "$ws/case/notes.txt"
printf '# Notes\n' > "$ws/case/CASE.md"
