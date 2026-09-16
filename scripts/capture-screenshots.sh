#!/usr/bin/env bash
#
# Capture the release screenshots from a real VS Code window.
#
#   ./scripts/capture-screenshots.sh [outdir] [app name]
#
# You drive VS Code; the script owns window size, naming, scaling, colour space
# and metadata. It stops before each shot: set the view up, return here, press
# Enter. Press s to skip one.
#
# GIFs (preview, timeline-minimap) are recorded by hand - not handled here.
set -euo pipefail

OUT=${1:-lana/assets/1_22}
APP=${2:-Code - Insiders} # "Code" for the stable build
WINDOW_W=1920
WINDOW_H=1080
FULL_W=1920 # full views ship at this width
CROP_W=800  # crops ship at this width, 2x their 400px display size

# name | full or crop | what to set up
SHOTS=(
  "timeline.png|full|Timeline tab, whole log, nothing selected"
  "calltree.png|full|Call Tree tab, Time Order"
  "analysis.png|full|Analysis tab"
  "database.png|full|Database tab"
  "inspector.png|full|Inspector docked right, sections expanded, call tree expanded"
  "governor-heap.png|full|Memory view showing net, gross and peak"
  "calltree-time-order.png|full|Call Tree, Time Order (stitched into calltree-combined)"
  "calltree-aggregated.png|full|Call Tree, Aggregated"
  "calltree-bottom-up.png|full|Call Tree, Bottom-Up"
  "timeline-tooltip.png|crop|Hover a frame - drag round the details panel"
  "timeline-gov-strip.png|crop|Governor strip expanded with a tooltip - drag round the strip and the timeline above it"
  "timeline-find.png|crop|Find open on the Timeline - drag round the find bar and a match"
  "calltree-soql-format.png|crop|A formatted SOQL cell - drag round the row"
)

command -v magick >/dev/null || { echo "needs ImageMagick: brew install imagemagick" >&2; exit 1; }
mkdir -p "$OUT"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Size the window once, then read back where it actually landed: the menu bar
# means the position asked for is not the position given.
osascript -e "tell application \"System Events\" to tell process \"$APP\"
  set size of window 1 to {$WINDOW_W, $WINDOW_H}
  set position of window 1 to {0, 0}
end tell" >/dev/null
read -r X Y W H < <(
  osascript -e "tell application \"System Events\" to tell process \"$APP\" to get {position, size} of window 1" |
    tr -d ' ' | tr ',' ' '
)
echo "window: ${W}x${H} at ${X},${Y}"
[ "$W" -eq "$WINDOW_W" ] || echo "warning: window is ${W} wide, not ${WINDOW_W} - the display may be too small"

for shot in "${SHOTS[@]}"; do
  IFS='|' read -r name mode setup <<<"$shot"
  printf '\n%s\n  %s\n  Enter to capture, s to skip: ' "$name" "$setup"
  read -r key </dev/tty
  [ "$key" = "s" ] && continue

  if [ "$mode" = full ]; then
    osascript -e "tell application \"$APP\" to activate"
    sleep 1 # let the window come forward and any hover state settle
    screencapture -x -R"$X,$Y,$W,$H" "$tmp/raw.png"
    target=$FULL_W
  else
    echo "  drag the region..."
    screencapture -i -s "$tmp/raw.png"
    [ -f "$tmp/raw.png" ] || { echo "  cancelled"; continue; }
    target=$CROP_W
  fi

  # -resize down from the Retina grab, -colorspace so a P3 display does not
  # ship oversaturated, -strip so no EXIF or profile reaches the repo.
  # A Retina grab comes back at 2x, which downscales sharp. A 1x grab means the
  # display is not Retina - the shot is usable but softer.
  raw=$(magick identify -format '%wx%h' "$tmp/raw.png")
  magick "$tmp/raw.png" -resize "${target}x" -colorspace sRGB -strip "$OUT/$name"
  rm -f "$tmp/raw.png"
  echo "  -> $OUT/$name  ($(magick identify -format '%wx%h' "$OUT/$name") from $raw)"
done

# The three Call Tree views side by side, as the docs show them.
combined=("$OUT/calltree-time-order.png" "$OUT/calltree-aggregated.png" "$OUT/calltree-bottom-up.png")
if [ -f "${combined[0]}" ] && [ -f "${combined[1]}" ] && [ -f "${combined[2]}" ]; then
  magick "${combined[@]}" +append -strip "$OUT/calltree-combined.png"
  rm -f "${combined[@]}"
  echo "combined -> $OUT/calltree-combined.png"
fi

echo
echo "checking no metadata reached the repo..."
found=0
for f in "$OUT"/*.png "$OUT"/*.gif "$OUT"/vscode/*; do
  [ -e "$f" ] || continue
  profiles=$(magick identify -format '%[profiles]' "$f" 2>/dev/null)
  [ -n "$profiles" ] && { echo "  $f carries: $profiles"; found=1; }
done
[ "$found" -eq 0 ] && echo "  clean" || echo "  run: magick mogrify -colorspace sRGB -strip <file>"
