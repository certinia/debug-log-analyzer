#!/usr/bin/env bash
#
# Capture the release screenshots from this branch's build.
#
#   ./scripts/capture-screenshots.sh [outdir]
#
# It builds the extension, opens sample-app in an Extension Development Host on
# the lana-dev profile, then stops before each shot: set the view up, come back,
# press Enter. Press s to skip one.
#
# Building and opening the host here is what ties the images to the branch being
# released, rather than to whatever build happened to be open. The profile is
# yours, so the shots carry your layout - check nothing identifying is in frame.
#
#   --no-build   skip the build and reuse lana/out
#   --keep       leave the host running afterwards
#
# GIFs (preview, timeline-minimap) are recorded by hand - not handled here.
set -euo pipefail

BUILD=1
KEEP=0
OUT=""
for arg in "$@"; do
  case $arg in
    --no-build) BUILD=0 ;;
    --keep) KEEP=1 ;;
    *) OUT=$arg ;;
  esac
done
OUT=${OUT:-lana/assets/1_22}

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
EDITOR_CLI=${EDITOR_CLI:-code-insiders}
APP=${APP:-Code - Insiders} # the process name of $EDITOR_CLI
LOG=${LOG:-$REPO/sample-app/debug-logs/sample-log.log}
PROFILE=${PROFILE:-lana-dev} # the dev-host profile from AGENTS.md, so the shots carry your layout
# What the host window title carries, so a raise never hits your other windows.
# The script lists every open title when nothing matches.
WINDOW_MATCH=${WINDOW_MATCH:-sample-app}
WINDOW_W=1920
WINDOW_H=1080
# The window is all editor once the profile hides the rest, so only the title
# bar is left to drop. Measure it from the first shot and set TOP_CROP if the
# framing is off.
TOP_CROP=${TOP_CROP:-35}
FULL_W=1920 # full views ship at this width
CROP_W=800  # crops ship at this width, 2x their 400px display size

# name | full or crop | what to set up, one step per line
#
# Every step is here because the shot is reproduced from scratch each release
# and "which tab, what selected" is not recoverable from the old image.
SHOTS=(
  "timeline.png|full|Timeline tab, zoomed out to the whole log (double-click the minimap to reset).
Nothing selected, inspector closed, Find closed.
Move the pointer off the chart before you press Enter, so no hover card is caught."

  "calltree.png|full|Call Tree tab, Time Order view.
Expand 3 or 4 levels, so signatures, timings and the DML/SOQL/Rows columns all have values.
Scrolled to the top. Nothing selected, inspector closed."

  "analysis.png|full|Analysis tab, grouped by method, sorted by Self Time descending.
Scrolled to the top so the most expensive methods lead.
Nothing selected, inspector closed."

  "database.png|full|Database tab, SOQL section expanded so rows, timings and selectivity show.
DML and SOSL sections visible below it.
Nothing selected, inspector closed."

  "inspector.png|full|Timeline tab, inspector docked right at about a third of the width.
Select a mid-log frame deep enough to have a real call stack, e.g. a RecursiveSearcher.search frame.
All four sections open: Details, Self time by namespace, Call stack, Call tree.
Call tree in Time Order, expanded 2 or 3 levels.
Pointer away from both panes before Enter, so nothing is dimmed or marked."

  "governor-heap.png|full|Call Tree tab, Memory view, showing Net, Gross and Peak with their self variants.
Sorted by Peak descending and expanded 3 or 4 levels, so a real spike is on screen.
Inspector closed."

  "calltree-time-order.png|full|Call Tree tab, Time Order. First of three shots stitched side by side.
Expand 3 levels. Keep the scroll position and column widths identical across all three."

  "calltree-aggregated.png|full|Same tree, Aggregated view. Change only the view."

  "calltree-bottom-up.png|full|Same tree, Bottom-Up view. Change only the view."

  "timeline-tooltip.png|crop|Timeline tab. Hover a SOQL frame, so the card shows a fitted query with its WHERE.
Let the card fade in fully.
Drag round the card plus a little of the frame under it."

  "timeline-gov-strip.png|crop|Timeline tab, governor strip expanded, hovering a point so the tooltip lists used / limit.
Drag round the strip, its tooltip, and the bottom of the flame chart above it."

  "timeline-find.png|crop|Timeline tab. CMD+F, search a term with several matches, step to one.
Drag round the find bar and the highlighted match."

  "calltree-soql-format.png|crop|Call Tree tab. Find a row whose SOQL is long enough to be formatted.
Drag round that one row, full width."
)

command -v magick >/dev/null || { echo "needs ImageMagick: brew install imagemagick" >&2; exit 1; }
command -v "$EDITOR_CLI" >/dev/null || { echo "no $EDITOR_CLI on PATH - set EDITOR_CLI" >&2; exit 1; }
[ -f "$LOG" ] || { echo "no log at $LOG - set LOG" >&2; exit 1; }
mkdir -p "$OUT"
tmp=$(mktemp -d)
# --keep leaves the temp dir alone: the running host still reads its profile.
trap '[ "$KEEP" -eq 1 ] || rm -rf "$tmp"' EXIT

if [ "$BUILD" -eq 1 ]; then
  [ -d "$REPO/node_modules" ] || { echo "no node_modules - run pnpm install first" >&2; exit 1; }
  echo "building $(git -C "$REPO" rev-parse --abbrev-ref HEAD) ..."
  (cd "$REPO" && pnpm build)
fi
[ -d "$REPO/lana/out" ] || { echo "nothing built at lana/out" >&2; exit 1; }

# Workspace settings, so the chrome is the same every release without touching
# the profile you share with other windows. sample-app/.vscode is gitignored.
mkdir -p "$REPO/sample-app/.vscode"
cat >"$REPO/sample-app/.vscode/settings.json" <<'JSON'
{
  "workbench.activityBar.location": "hidden",
  "workbench.statusBar.visible": false,
  "workbench.editor.showTabs": "multiple",
  "breadcrumbs.enabled": false
}
JSON

echo "opening the extension host ..."
"$EDITOR_CLI" --new-window \
  --profile "$PROFILE" \
  --extensionDevelopmentPath="$REPO/lana" \
  "$REPO/sample-app" "$LOG" >/dev/null 2>&1

# System Events only. `tell application "Code" to activate` never returns:
# Electron does not answer the AppleEvent, and the window list stays empty
# until the app is focused.
#
# AXRaise picks out the host window first. Raising the application instead
# brings forward whichever window it last had - another of your editor windows,
# and if that one sits on another Space, macOS drags you to that Space.
focus() {
  osascript >/dev/null 2>&1 <<APPLESCRIPT
tell application "System Events" to tell process "$APP"
  try
    perform action "AXRaise" of (first window whose name contains "$WINDOW_MATCH")
  end try
  set frontmost to true
end tell
APPLESCRIPT
}
# The window list reads as empty until the app is focused, so finding the host
# needs this first. Safe while the host is starting: a new window is the app's
# front window, so no older one is pulled forward.
focus_app() {
  osascript >/dev/null 2>&1 -e "tell application \"System Events\" to set frontmost of process \"$APP\" to true"
}
host_window() {
  osascript 2>/dev/null -e "tell application \"System Events\" to tell process \"$APP\"
    repeat with w in windows
      if name of w contains \"$WINDOW_MATCH\" then return name of w
    end repeat
    error \"none\"
  end tell"
}
all_windows() {
  osascript 2>/dev/null -e "tell application \"System Events\" to tell process \"$APP\" to return name of windows"
}

for _ in $(seq 30); do
  sleep 1
  focus_app
  host_window >/dev/null && break
done
host_window >/dev/null || {
  echo "no window matching \"$WINDOW_MATCH\". These are open:" >&2
  focus_app
  all_windows | tr ',' '\n' | sed 's/^ */  /' >&2
  echo "Pick a distinctive part of the host's title and re-run with WINDOW_MATCH=..." >&2
  exit 1
}
echo "host window: $(host_window)"
focus

# Size it, then read back where it landed: the menu bar means the position
# asked for is not the position given.
osascript -e "tell application \"System Events\" to tell process \"$APP\"
  set w to first window whose name contains \"$WINDOW_MATCH\"
  set size of w to {$WINDOW_W, $WINDOW_H}
  set position of w to {0, 0}
end tell" >/dev/null
read -r X Y W H < <(
  osascript -e "tell application \"System Events\" to tell process \"$APP\" to get {position, size} of (first window whose name contains \"$WINDOW_MATCH\")" |
    tr -d ' ' | tr ',' ' '
)
Y=$((Y + TOP_CROP))
H=$((H - TOP_CROP))
echo "capturing ${W}x${H} at ${X},${Y}"
[ "$W" -eq "$WINDOW_W" ] || echo "warning: window is ${W} wide, not ${WINDOW_W} - the display may be too small"
echo "The activity bar, status bar and breadcrumbs are off for this workspace."
echo "Press CMD+B if the side bar is open - that one is UI state, not a setting,"
echo "so VS Code remembers it for sample-app from now on."
echo "Then open the log with 'Log: Show Apex Log Analysis'."

for shot in "${SHOTS[@]}"; do
  IFS='|' read -r -d '' name mode setup <<<"$shot" || true
  setup=${setup%$'\n'} # the here-string's own newline
  printf '\n%s\n' "$name"
  printf '%s\n' "$setup" | sed 's/^/  /'
  printf '  Enter to capture, s to skip: '
  read -r key </dev/tty
  [ "$key" = "s" ] && continue

  if [ "$mode" = full ]; then
    focus
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
  # ship oversaturated, -strip so no EXIF or profile reaches the repo. A 1x grab
  # means the display is not Retina - usable, but softer.
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

[ "$KEEP" -eq 1 ] && echo && echo "host left running on $tmp - delete it when you close the window."
