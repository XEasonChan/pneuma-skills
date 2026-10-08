#!/usr/bin/env bash
# One-time: a persistent venv for the tanka-launch stage scripts at ~/.pneuma/tanka-launch/venv (numpy + scipy required;
# soundfile / pyloudnorm optional — the scripts use ffmpeg for audio I/O and their own BS.1770 meter, and cross-check with
# pyloudnorm when it is there). Uses uv when available (works offline from uv's wheel cache), else python3 -m venv + pip.
set -eu
DEST="${1:-$HOME/.pneuma/tanka-launch/venv}"
PKGS="numpy scipy soundfile pyloudnorm"
UV="$(command -v uv 2>/dev/null || true)"; [ -n "$UV" ] || UV="$HOME/.local/bin/uv"
mkdir -p "$(dirname "$DEST")"
if [ -x "$UV" ]; then
  "$UV" venv --python 3.12 "$DEST"
  "$UV" pip install --python "$DEST/bin/python" --offline $PKGS || "$UV" pip install --python "$DEST/bin/python" $PKGS
else
  python3 -m venv "$DEST"
  "$DEST/bin/pip" install $PKGS
fi
"$DEST/bin/python" -c 'import numpy, scipy; print("ok", numpy.__version__, scipy.__version__)'
echo "venv ready: $DEST (scripts/py picks it up automatically)"
