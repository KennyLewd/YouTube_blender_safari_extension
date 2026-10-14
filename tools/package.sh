#!/bin/sh
# Builds dist/ambient-light-safari-<version>.zip from the extension folder.
set -eu
cd "$(dirname "$0")/.."
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' extension/manifest.json | head -n 1)
mkdir -p dist
out="dist/ambient-light-safari-${version}.zip"
rm -f "$out"
(cd extension && zip -qr "../$out" . -x '*.DS_Store')
echo "Created $out"
