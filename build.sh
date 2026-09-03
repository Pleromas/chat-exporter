#!/usr/bin/env bash
# Build an unsigned chat-exporter.xpi.
#
# manifest.json MUST sit at the root of the archive. Zipping the folder itself
# produces chat-exporter/manifest.json and Firefox will reject it.
set -euo pipefail

cd "$(dirname "$0")"
OUT="chat-exporter.xpi"
rm -f "$OUT"

zip -qr "$OUT" . \
  -x ".git/*" ".claude/*" "node_modules/*" "test-*.js" "package.json" \
     "package-lock.json" "out.html" ".gitignore" "build.sh" "CLAUDE.md" "*.zip" "*.xpi"

echo "built $OUT"
unzip -l "$OUT" | tail -3
