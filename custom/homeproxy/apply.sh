#!/bin/sh
# Prepare a customized package without changing the upstream mirror.
set -eu
[ "$#" -eq 2 ] || { printf 'Usage: %s SOURCE OUTPUT\n' "$0" >&2; exit 1; }
custom=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source=$(CDPATH= cd -- "$1" && pwd)
[ -s "$source/Makefile" ] || { echo 'Missing HomeProxy Makefile' >&2; exit 1; }
[ ! -e "$2" ] && [ ! -L "$2" ] || { echo 'Output already exists' >&2; exit 1; }
parent=$(CDPATH= cd -- "$(dirname -- "$2")" && pwd)
output="$parent/$(basename -- "$2")"
stage=$(mktemp -d "$parent/.homeproxy-custom.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
cp -a "$source/." "$stage/"
# Backend and UI patches own separate files; validate both before applying.
(cd "$stage" && git apply --check "$custom/runtime.patch" "$custom/ui.patch" &&
    git apply "$custom/runtime.patch" "$custom/ui.patch")
mv "$stage" "$output"
