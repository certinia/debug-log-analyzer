#!/usr/bin/env bash
#
# Compress the release images, with the commands CI runs on them.
#
#   ./scripts/screenshots/compress.sh <dir or file> ...
#
# .github/workflows/imgcmp.yml runs imgcmp on main, and these are its own
# commands. Running them here lands an image in the repo at the size CI would
# make it, so no optimize pull request comes back for work already done.
#
# capture.sh and mov-to-gif.sh both call this on what they have written. It
# stays a script of its own because the gif is recorded by hand, long after
# capture.sh has exited.
#
# optipng, gifsicle and svgo are lossless. jpegoptim -m85 and cwebp are not:
# each re-encodes above its quality ceiling, so the file loses a little on every
# run, here and again on each CI pass. Capture png, and this stays lossless.
#
# A result that is not smaller is thrown away, so a tool that does not converge
# cannot leave a file dirty in git for a few dozen bytes. A missing tool is
# reported, not fatal: CI still makes the pass.
set -euo pipefail

# No default target. Both callers pass theirs, and a copy of the release folder
# name here would be a third one - RELEASING.md's sweep and its grep verify step
# both stop at lana-docs/, so scripts/ is where a stale one would go unnoticed.
[ $# -gt 0 ] || { echo "usage: $(basename "$0") <dir or file> ..." >&2; exit 1; }

# Templated, so TMPDIR is honoured: a bare `mktemp -d` ignores it on macOS.
tmp=$(mktemp -d "${TMPDIR:-/tmp}/compress.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

human() {
  awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.2fMB", b / 1048576; else printf "%.0fKB", b / 1024 }'
}
pct() {
  awk -v a="$1" -v b="$2" 'BEGIN { printf "%+.1f%%", (b - a) * 100 / a }'
}

files=()
for t in "$@"; do
  if [ -d "$t" ]; then
    while IFS= read -r f; do files+=("$f"); done < <(
      find "$t" -type f \( -name '*.png' -o -name '*.gif' -o -name '*.jpg' \
        -o -name '*.jpeg' -o -name '*.svg' -o -name '*.webp' \) | sort
    )
  elif [ -f "$t" ]; then
    files+=("$t")
  else
    echo "no such path: $t" >&2
    exit 1
  fi
done
[ ${#files[@]} -gt 0 ] || { echo "no images under $*"; exit 0; }

total_before=0
total_after=0
missing=()
for f in "${files[@]}"; do
  # imgcmp v2.0.4's own commands, from its src/optimize.ts. A flag that differs
  # from these is a pull request from CI later, so they move with the pin in
  # .github/workflows/imgcmp.yml, which Dependabot bumps.
  case ${f##*.} in
    png) cmd=(optipng -o2 "$f") ;;
    gif) cmd=(gifsicle -b -O3 --colors 256 "$f") ;;
    jpg | jpeg) cmd=(jpegoptim -m85 "$f") ;;
    svg) cmd=(svgo "$f") ;;
    webp) cmd=(cwebp "$f" -o "$f") ;;
    *)
      # Only a file named on the command line reaches this: the find filters.
      echo "  $(basename "$f"): no optimizer for .${f##*.}, left as is" >&2
      continue
      ;;
  esac
  if ! command -v "${cmd[0]}" >/dev/null; then
    [[ " ${missing[*]-} " == *" ${cmd[0]} "* ]] || missing+=("${cmd[0]}")
    continue
  fi

  before=$(stat -f%z "$f")
  # Every tool here writes in place, so the original is held to put back.
  cp "$f" "$tmp/orig"
  # The failure is reported and the run carries on. Discarding stderr under
  # `set -e` would take the whole script down with no output at all, and the
  # caller with it - after a full interactive capture session.
  if ! err=$("${cmd[@]}" 2>&1 >/dev/null); then
    cp "$tmp/orig" "$f"
    echo "  $(basename "$f"): ${cmd[0]} failed, left as is${err:+ - $err}" >&2
    continue
  fi
  after=$(stat -f%z "$f")
  # gifsicle does not converge on preview.gif: it alternates by a few dozen
  # bytes, run to run. Keeping only a smaller result stops every capture leaving
  # a multi-megabyte binary dirty in git for nothing.
  if [ "$after" -ge "$before" ]; then
    cp "$tmp/orig" "$f"
    after=$before
  fi
  total_before=$((total_before + before))
  total_after=$((total_after + after))
  # Compared as rendered, not as bytes: a saving too small to show is noise.
  hb=$(human "$before")
  ha=$(human "$after")
  [ "$hb" = "$ha" ] || printf '  %-34s %8s -> %8s  %s\n' \
    "$(basename "$f")" "$hb" "$ha" "$(pct "$before" "$after")"
done

tb=$(human "$total_before")
ta=$(human "$total_after")
if [ "$tb" = "$ta" ]; then
  echo "  nothing to save"
else
  printf '  %s -> %s (%s)\n' "$tb" "$ta" "$(pct "$total_before" "$total_after")"
fi
if [ ${#missing[@]} -gt 0 ]; then
  for tool in "${missing[@]}"; do
    # cwebp ships in the webp formula, and svgo is not a formula at all.
    case $tool in
      cwebp) echo "  not run: cwebp - brew install webp" ;;
      svgo) echo "  not run: svgo - pnpm add -g svgo" ;;
      *) echo "  not run: $tool - brew install $tool" ;;
    esac
  done
fi
