#!/usr/bin/env bash
# Build an unsigned chat-exporter.xpi.
#
# manifest.json MUST sit at the root of the archive. Zipping the folder itself
# produces chat-exporter/manifest.json and Firefox will reject it.
#
# This packs an EXPLICIT allowlist of files, not "everything except a denylist".
# A denylist silently ships whatever stray file lands in the folder — a stray 5 MB
# PDF once bloated the xpi this way. If it is not listed here, it does not ship.
set -euo pipefail

cd "$(dirname "$0")"
OUT="chat-exporter.xpi"

# Everything the extension needs at runtime, plus the docs we want in the package.
FILES=(
  manifest.json
  background.js
  content.js
  extract.js
  markdown.js
  doc.js
  popup.html
  popup.js
  print.html
  print.js
  icon.svg
  LICENSE
  PRIVACY.md
  README.md
)

# Fail loudly if an expected file is missing, rather than shipping a broken xpi.
missing=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "MISSING: $f" >&2; missing=1; }
done
[ "$missing" -eq 0 ] || { echo "build aborted: files missing" >&2; exit 1; }

rm -f "$OUT"
zip -q "$OUT" "${FILES[@]}"

echo "built $OUT"
unzip -l "$OUT" | tail -n +2

# The project folder two levels up keeps a convenience symlink to this artifact,
# so testing ../../chat-exporter.xpi always picks up the latest build instead of a
# stale copy. Recreate it if missing or wrong; never leave a rotting duplicate.
ln -sfn "$PWD/$OUT" "../../chat-exporter.xpi" 2>/dev/null || true

echo
echo "canonical xpi : $PWD/$OUT"
echo "also at (link): $(cd ../.. && pwd)/chat-exporter.xpi"
