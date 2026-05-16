#!/usr/bin/env bash

set -euo pipefail

# Windows NSIS build script.
# Optional code signing: if WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD are set,
# electron-builder will automatically use them. Otherwise builds unsigned.

if [[ -n "${WIN_CSC_LINK:-}" && -n "${WIN_CSC_KEY_PASSWORD:-}" ]]; then
  printf 'Code signing enabled (WIN_CSC_LINK detected).\n'
else
  printf 'Code signing disabled (set WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD to enable).\n'
fi

bun run build:all && electron-builder --win --x64
