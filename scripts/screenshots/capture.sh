#!/usr/bin/env bash
#
# Capture the release screenshots from this branch's build.
#
#   ./scripts/screenshots/capture.sh [outdir]
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
# Only the shots that need VS Code itself are here. capture-web.mjs beside this
# takes the log viewer shots, in the dark and the light theme.
#
# preview.gif is recorded by hand, then converted by mov-to-gif.sh beside this.
# A run lists it at the end.
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
# The folder $OUT was copied forward from. A shot still identical to its copy
# there was never recaptured, which is the thing worth knowing before skipping
# one. PREV= turns the comparison off.
# `|| true`: with no older folder to find, grep exits 1 and pipefail would take
# the whole script down here, before anything has even been built.
PREV=${PREV-$(ls -d "$(dirname "$OUT")"/*/ 2>/dev/null | sed 's:/$::' | grep -vx "$OUT" | tail -1 || true)}

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
EDITOR_CLI=${EDITOR_CLI:-code-insiders}
APP=${APP:-Code - Insiders} # the process name of $EDITOR_CLI
LOG=${LOG:-$REPO/sample-app/debug-logs/sample-log.log}
PROFILE=${PROFILE:-lana-dev} # the dev-host profile from AGENTS.md, so the shots carry your layout
# What the host window title carries, so a raise never hits your other windows.
# The script lists every open title when nothing matches.
WINDOW_MATCH=${WINDOW_MATCH:-sample-app}
WINDOW_W=1920
WINDOW_H=1080
# A ceiling, never a target: see the resize below.
CROP_W=2400 # a crop keeps the pixels it was dragged at, up to this
COUNTDOWN=${COUNTDOWN:-8} # seconds a region shot gives you before the select starts

# name | width the docs show it at | what to set up, one step per line
#
# Each shot gives a countdown to find what it is of, then you drag the region.
# A hover held through the countdown survives into the drag.
#
# A crop keeps the pixels it was dragged at, and the screen is 2x, so a drag is
# worth double its width in the file. Each crop below says the width the docs
# render it at: drag at least that many screen pixels across and it lands at 2x.
# Dragging much wider is the other failure - the whole thing is then scaled into
# that box and the text goes to nothing.
#
# Every step is here because the shot is reproduced from scratch each release
# and "which tab, what selected" is not recoverable from the old image.
SHOTS=(
  # --- Editor, not the webview ---
  "vscode/show-analysis-lens.png|350|Open sample-log.log in the editor, so the Show Apex Log Analysis lens sits above line 1.
Drag round the lens and the first line of the log under it."

  "vscode/settings-custom-themes.png|300|Open settings.json and define two themes under lana.timeline.customThemes, so the color chips show in the gutter.
Drag round the customThemes block alone."
)

# Motion the script cannot drive, so these are recorded by hand and listed at the
# end of a run. Match the window and the crop above, so they sit with the rest.
MANUAL=(
  "preview.gif|The README hero, so it has to read at a glance.
Screen record the host window, then: ./scripts/screenshots/mov-to-gif.sh <recording>.mov
Open the log, move across the Timeline, pick a frame so the inspector fills, then step through a tab or two.
Keep it under about 6s: the README shows it 900px wide, so 1800 is what makes it sharp, and length is what costs the bytes."
)

# What is already there, so you can tell a shot worth keeping from one that only
# looks fine because it is last release's.
have() {
  local f=$OUT/$1
  if [ ! -e "$f" ]; then
    echo "  on disk: nothing yet"
    return
  fi
  local secs=$(($(date +%s) - $(stat -f%m "$f")))
  local age
  if [ "$secs" -lt 3600 ]; then age="$((secs / 60))m old"
  elif [ "$secs" -lt 86400 ]; then age="$((secs / 3600))h old"
  else age="$((secs / 86400))d old"
  fi
  local info
  # [0] so an animation answers with its size, not one per frame.
  info="$(magick identify -format '%wx%h' "$f[0]" 2>/dev/null), $(du -h "$f" | cut -f1 | tr -d ' '), $age"
  if [ -n "$PREV" ] && [ -e "$PREV/$1" ] && cmp -s "$f" "$PREV/$1"; then
    echo "  on disk: $info - unchanged from $(basename "$PREV"), so never recaptured"
  else
    echo "  on disk: $info"
  fi
}

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

# The same window size every release, so crops are dragged at the same scale.
osascript -e "tell application \"System Events\" to tell process \"$APP\"
  set w to first window whose name contains \"$WINDOW_MATCH\"
  set size of w to {$WINDOW_W, $WINDOW_H}
  set position of w to {0, 0}
end tell" >/dev/null
echo "Set the window up before the first shot: side bar and activity bar closed."

for shot in "${SHOTS[@]}"; do
  IFS='|' read -r -d '' name shown setup <<<"$shot" || true
  setup=${setup%$'\n'} # the here-string's own newline
  # What the docs render it at, doubled: anything under this is upscaled in the
  # page, which no amount of care in the capture can undo.
  need=$((shown * 2))

  # Re-entered when a shot comes out too small, so a bad drag costs one more go
  # rather than a whole run.
  while true; do
    printf '\n%s\n' "$name"
    have "$name"
    printf '%s\n' "$setup" | sed 's/^/  /'
    # The drag is in screen points and the display is 2x, so dragging the width
    # the docs show it at is what lands the file at twice that.
    printf '  [area select, %ss countdown] drag %spx+ across, to land %spx.\n' \
      "$COUNTDOWN" "$shown" "$need"
    printf '  Enter to capture, s to skip: '
    read -r key </dev/tty
    [ "$key" = "s" ] && break

    # Enter was pressed in the terminal, so the terminal is what is in front.
    # The countdown is to raise the window and find what the shot is of - and,
    # where it needs a hover, to get the pointer onto it. The region select that
    # follows takes the pointer off the window, so the app stops being told
    # where it is and whatever is hovered stays up while you drag.
    focus
    for s in $(seq "$COUNTDOWN" -1 1); do
      printf '\r  find what the shot is of - region select in %ss ' "$s"
      sleep 1
    done
    printf '\r%*s\r' 52 ''
    screencapture -i -s "$tmp/raw.png"
    [ -f "$tmp/raw.png" ] || { echo "  cancelled"; continue; }

    # `>` only ever shrinks. Without it a crop is forced to the target whatever it
    # was dragged at, so a wide drag is squeezed below 1x and the text goes to mush
    # - a full-width row dragged at 3840 used to ship at 800. -colorspace so a P3
    # display does not ship oversaturated, -strip so no EXIF or profile reaches the
    # repo. A 1x grab means the display is not Retina - usable, but softer.
    raw=$(magick identify -format '%wx%h' "$tmp/raw.png")
    # Written aside and only moved into place once it measures up, so a short
    # drag never overwrites a good shot from a previous run.
    pending="$tmp/pending.${name##*.}"
    magick "$tmp/raw.png" -resize "${CROP_W}x>" -colorspace sRGB -strip "$pending"
    rm -f "$tmp/raw.png"
    got=$(magick identify -format '%w' "$pending")
    if [ "$got" -lt "$need" ]; then
      rm -f "$pending"
      echo "  came out ${got}px, needs ${need}px for its ${shown}px slot - drag wider and go again"
      continue
    fi
    mkdir -p "$(dirname "$OUT/$name")"
    mv "$pending" "$OUT/$name"
    echo "  -> $OUT/$name  ($(magick identify -format '%wx%h' "$OUT/$name") from $raw)"
    break
  done
done

# Each shot is stripped as it is written, so this only catches a file carried in
# from an older assets folder. Dropping the chunk keeps the original pixels;
# `magick -strip` re-encodes and can leave the file bigger than it found it.
strip_metadata() {
  python3 - "$1" <<'STRIP' 2>/dev/null
import pathlib, struct, sys

path = pathlib.Path(sys.argv[1])
data = path.read_bytes()
if data[:8] != b'\x89PNG\r\n\x1a\n':
    sys.exit(1)
drop = {b'eXIf', b'tEXt', b'zTXt', b'iTXt', b'tIME', b'iCCP'}
out, i = bytearray(data[:8]), 8
while i < len(data):
    end = i + 12 + struct.unpack('>I', data[i:i + 4])[0]
    if data[i + 4:i + 8] not in drop:
        out += data[i:end]
    i = end
path.write_bytes(bytes(out))
STRIP
}

echo
echo "metadata"
stripped=0
# The same walk compress.sh makes, so the two passes never disagree about what
# is in the folder. A glob would need every subdirectory spelled out.
while IFS= read -r f; do
  # [0] as above: without it this walks every frame of an animation.
  [ -n "$(magick identify -format '%[profiles]' "$f[0]" 2>/dev/null)" ] || continue
  stripped=1
  if strip_metadata "$f"; then
    echo "  stripped ${f#"$OUT"/}"
  else
    echo "  ${f#"$OUT"/} still carries metadata - strip it by hand: exiftool -all= $f"
  fi
done < <(
  find "$OUT" -type f \( -name '*.png' -o -name '*.gif' -o -name '*.jpg' \
    -o -name '*.jpeg' -o -name '*.svg' -o -name '*.webp' \) | sort
)
if [ "$stripped" -eq 0 ]; then
  echo "  clean"
fi

# After the strip, never before: optipng keeps the ancillary chunks it is given,
# so a shot compressed first would carry its metadata into the repo compressed.
echo
echo "compress"
"$(dirname "${BASH_SOURCE[0]}")/compress.sh" "$OUT"

echo
echo "record by hand"
for entry in "${MANUAL[@]}"; do
  IFS='|' read -r -d '' name note <<<"$entry" || true
  note=${note%$'\n'}
  printf '  %s\n' "$name"
  have "$name" | sed 's/^  /    /'
  printf '%s\n' "$note" | sed 's/^/    /'
done

if [ "$KEEP" -eq 1 ]; then
  echo
  echo "host left running on $tmp - delete it when you close the window."
fi
