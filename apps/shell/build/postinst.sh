#!/usr/bin/env bash

set -euo pipefail

# AudioMorph Studio .deb post-install GPU check.
# Verifies that an NVIDIA GPU driver is present via nvidia-smi.
# Aborts installation if missing.

RED='\033[0;31m'
NC='\033[0m'

find_nvidia_smi() {
  if command -v nvidia-smi >/dev/null 2>&1; then
    echo "nvidia-smi"
    return 0
  fi
  if [[ -x /usr/bin/nvidia-smi ]]; then
    echo "/usr/bin/nvidia-smi"
    return 0
  fi
  if [[ -x /usr/local/bin/nvidia-smi ]]; then
    echo "/usr/local/bin/nvidia-smi"
    return 0
  fi
  return 1
}

if ! NVIDIA_SMI=$(find_nvidia_smi); then
  printf "${RED}NVIDIA GPU required for AudioMorph Studio${NC}\n" >&2
  exit 1
fi

if ! "${NVIDIA_SMI}" >/dev/null 2>&1; then
  printf "${RED}NVIDIA GPU required for AudioMorph Studio${NC}\n" >&2
  exit 1
fi

exit 0
