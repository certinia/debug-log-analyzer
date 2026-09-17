#!/usr/bin/env bash
#
# Turn a screen recording into the README hero gif.
#
#   ./scripts/screenshots/mov-to-gif.sh <recording>.mov [out.gif]
#
# Two passes: one reads a palette from the whole clip, one maps the frames onto
# it. A single pass takes its palette from the first frame and bands everything
# after it.
#
#   WIDTH=1800   2x the 900px the README renders it at
#   FPS=12       resampled from whatever the recording really delivered
#   COLORS=128   palette size
#   TOP_CROP=70  the title bar, in recorded pixels. 0 if you framed it out.
set -euo pipefail

SRC=${1:-}
[ -n "$SRC" ] || { echo "usage: $(basename "$0") <recording>.mov [out.gif]" >&2; exit 1; }
[ -f "$SRC" ] || { echo "no recording at $SRC" >&2; exit 1; }
OUT=${2:-lana/assets/1_22/preview.gif}
WIDTH=${WIDTH:-1800}
FPS=${FPS:-12}      # smooth enough for UI motion, and frames are what cost bytes
COLORS=${COLORS:-128} # a dark editor theme needs nowhere near 256
TOP_CROP=${TOP_CROP:-70}

command -v ffmpeg >/dev/null || { echo "needs ffmpeg: brew install ffmpeg" >&2; exit 1; }

# `|| true`: tr leaves no trailing newline, so read reports EOF having set them.
read -r src_w src_h dur < <(
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
    -show_entries format=duration -of csv=p=0:s=x "$SRC" | tr 'x\n' '  '
) || true
# A screen recording only stores a frame when something changes, and the header
# still claims the rate it was asked for - 60 here, against 40 really delivered.
# Left alone, fps= trusts that header and stretches the clip into slow motion, so
# the real rate is worked out from the frames and handed back on the input.
frames=$(ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames -of csv=p=0 "$SRC")
in_rate=$(python3 -c "print(f'{$frames/$dur:.4f}')")
echo "source: ${src_w}x${src_h}, ${dur}s, ${frames} frames (${in_rate}fps)"
[ "$src_w" -ge "$WIDTH" ] || echo "warning: recorded at ${src_w}px, under the ${WIDTH}px target - it can only be upscaled"

# -map_metadata -1 so no creation time or device name rides along into the repo.
# -nostdin: ffmpeg reads stdin by default and eats whatever is feeding the shell.
ffmpeg -nostdin -v error -y -r "$in_rate" -i "$SRC" -map_metadata -1 -vf \
  "crop=iw:ih-${TOP_CROP}:0:${TOP_CROP},fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${COLORS}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  "$OUT"

# Before the size is read, so what is reported is what lands in the repo.
echo "compress"
"$(dirname "${BASH_SOURCE[0]}")/compress.sh" "$OUT"

size=$(du -h "$OUT" | cut -f1 | tr -d ' ')
out_frames=$(magick identify "$OUT" | wc -l | tr -d ' ')
echo "-> $OUT  $(magick identify "$OUT" | head -1 | awk '{print $3}') ${size}, ${out_frames} frames, $(python3 -c "print(f'{$out_frames/$FPS:.1f}')")s"
# The README hotlinks this from raw.githubusercontent, so the weight is paid on
# every page load. Around 5MB is what a 6s clip costs at these defaults; much
# over that means the clip ran long, since the width is what makes it sharp and
# is the last thing to cut.
bytes=$(stat -f%z "$OUT")
if [ "$bytes" -gt 6291456 ]; then
  echo "over 6MB - shorten the clip, or drop FPS, before touching WIDTH"
fi

leftover=$(magick identify -format '%[profiles]' "$OUT[0]" 2>/dev/null)
if [ -n "$leftover" ]; then
  echo "warning: still carries $leftover"
fi
