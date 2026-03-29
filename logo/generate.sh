#!/usr/bin/env bash
#
# Generate all raster logo assets from an SVG source.
# Usage: ./generate.sh [source.svg]
# Default source: logo-black.svg
# Requires: ImageMagick 7 (magick)
#
set -euo pipefail
cd "$(dirname "$0")"

SRC="${1:-logo-black.svg}"

if [[ ! -f "$SRC" ]]; then
  echo "Error: $SRC not found" >&2
  exit 1
fi

if ! command -v magick &>/dev/null; then
  echo "Error: ImageMagick 7 (magick) is required" >&2
  exit 1
fi

echo "Source: $SRC"

echo "Generating favicon.ico (16x16 + 32x32)..."
# The logo is ~723x757 (slightly taller than wide).
# Rasterize with padding so it breathes at small sizes.
magick "$SRC" -background none -resize 14x14 -gravity center -extent 16x16 /tmp/kr-16.png
magick "$SRC" -background none -resize 28x28 -gravity center -extent 32x32 /tmp/kr-32.png
magick /tmp/kr-16.png /tmp/kr-32.png favicon.ico
rm /tmp/kr-16.png /tmp/kr-32.png

echo "Generating apple-touch-icon.png (180x180)..."
magick "$SRC" -background white -resize 150x150 -gravity center -extent 180x180 apple-touch-icon.png

echo "Generating og.png (1200x630)..."
magick "$SRC" -background white -resize x252 -gravity center -extent 1200x630 og.png

echo "Generating github-social.png (1280x640)..."
magick "$SRC" -background white -resize x256 -gravity center -extent 1280x640 github-social.png

echo "Generating avatar.png (500x500, ~12% padding)..."
magick "$SRC" -background white -resize 420x420 -gravity center -extent 500x500 avatar.png

echo "Done. Generated:"
ls -la favicon.ico apple-touch-icon.png og.png github-social.png avatar.png
