# Python Build Standalone (PBS) Platform Matrix

**Release:** 20260510
**Python Version:** 3.14.5
**Last Updated:** 2026-05-16

## Overview

This document tracks the availability and verification status of Python 3.14.5 builds from [python-build-standalone](https://github.com/astral-sh/python-build-standalone) across AudioMorph Studio's target platforms.

All builds use the `install_only` variant (minimal, no debug symbols).

## Platform Matrix

| Platform                    | Version         | Download URL                                                                                                                                           | SHA256                                                             | Tested FastAPI Install              |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------- |
| macOS Apple Silicon (arm64) | 3.14.5+20260510 | https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.14.5%2B20260510-aarch64-apple-darwin-install_only.tar.gz     | `53ab0f338f508356a5e169316972c3a2cf3553fef3f20ff18512e253342d29db` | ✅ Success (fastapi 0.115.0)        |
| Windows x64 (MSVC)          | 3.14.5+20260510 | https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.14.5%2B20260510-x86_64-pc-windows-msvc-install_only.tar.gz   | `ac1956f94994cb33553949e7dda92d5e5567ad70ec7cd67a13ec884174813f96` | ⏳ Not tested (Windows unavailable) |
| Linux x64 (GNU)             | 3.14.5+20260510 | https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.14.5%2B20260510-x86_64-unknown-linux-gnu-install_only.tar.gz | `b3916b829fb0bc9efe93e800e6738a629ee4ade4aad798378d9326f4a0bac2db` | ⏳ Not tested (Linux unavailable)   |

## Verification Details

### macOS arm64 (Primary Dev Platform)

- **Status:** ✅ Verified
- **Python Version:** 3.14.5
- **Pip Version:** 26.1.1
- **Test Package:** fastapi==0.115.0
- **Test Result:** Successfully installed with all dependencies
- **Evidence:** `.sisyphus/evidence/task-P0.1-macos-pbs-verify.txt`

### Windows x64

- **Status:** ⏳ Pending (CI/CD or Windows runner required)
- **Build Available:** Yes
- **SHA256 Verified:** Yes (from GitHub API)

### Linux x64

- **Status:** ⏳ Pending (CI/CD or Linux runner required)
- **Build Available:** Yes
- **SHA256 Verified:** Yes (from GitHub API)

## Usage

To use these builds in AudioMorph Studio:

```bash
# macOS
curl -L -o pbs.tar.gz "https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.14.5%2B20260510-aarch64-apple-darwin-install_only.tar.gz"
tar -xzf pbs.tar.gz
./python/bin/python3 --version

# Windows (PowerShell)
Invoke-WebRequest -Uri "https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.14.5%2B20260510-x86_64-pc-windows-msvc-install_only.tar.gz" -OutFile pbs.tar.gz
tar -xzf pbs.tar.gz
.\python\Scripts\python.exe --version

# Linux
curl -L -o pbs.tar.gz "https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.14.5%2B20260510-x86_64-unknown-linux-gnu-install_only.tar.gz"
tar -xzf pbs.tar.gz
./python/bin/python3 --version
```

## References

- [python-build-standalone GitHub](https://github.com/astral-sh/python-build-standalone)
- [PBS Documentation](https://gregoryszorc.com/docs/python-build-standalone/main/)
- [Release 20260510](https://github.com/astral-sh/python-build-standalone/releases/tag/20260510)
