#!/usr/bin/env bash

set -euo pipefail

# Linux build script: AppImage + .deb (x64).
# No code signing required.

bun run build:all && electron-builder --linux --x64
