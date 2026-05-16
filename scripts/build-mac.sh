#!/usr/bin/env bash

set -euo pipefail

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    printf 'Missing required env var: %s\n' "$key" >&2
    exit 1
  fi
}

require_env "CSC_LINK"
require_env "CSC_KEY_PASSWORD"
require_env "APPLE_ID"
require_env "APPLE_APP_SPECIFIC_PASSWORD"
require_env "APPLE_TEAM_ID"

bun run build:all && electron-builder --mac --arm64
