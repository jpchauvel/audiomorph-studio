## [2026-05-16] Session Init
- Project: AudioMorph Studio — Electron + Next.js + FastAPI Python sidecar + heartlib submodule
- heartlib is at /heartlib/ (submodule, read-only)
- heartlib has: examples/, src/heartlib/, pyproject.toml, assets/, uv.lock
- Target platforms: macOS Apple Silicon, Windows x64 CUDA, Linux x64 CUDA
- Python version: 3.14 (PBS bundled)
- No accounts, no telemetry, no auto-update, no cloud
- NEVER store API keys in localStorage/sessionStorage/Zustand persistence
- NEVER render raw API key after save (mask only)
- Do NOT use Jest — use Vitest
- Do NOT skip JUnit reporter
- Repo structure: apps/desktop/ apps/web/ apps/sidecar/ packages/shared-types/ packages/ui/

## [2026-05-16] P0.1 - PBS Verification Complete
- **Task:** Verify python-build-standalone 3.14 availability for 3 target platforms
- **Release:** 20260510 (Python 3.14.5)
- **Status:** ✅ Complete
- **Key Findings:**
  - All 3 target platforms have Python 3.14.5 builds available
  - macOS arm64: Verified working with fastapi 0.115.0 install test
  - Windows x64 & Linux x64: Builds available, SHA256 verified from GitHub API
  - PBS install_only variant is ~25MB (good for distribution)
  - Pip 26.1.1 included, works correctly
- **Deliverables:**
  - `docs/pbs-platform-matrix.md` - Platform matrix with URLs, SHA256, test results
  - `.sisyphus/evidence/task-P0.1-macos-pbs-verify.txt` - macOS verification output
  - `.sisyphus/evidence/task-P0.1-doc-completeness.txt` - Doc completeness check
- **Commit:** 9f4ef63 "chore(phase0): verify python-build-standalone 3.14 availability"

## [2026-05-16] FFmpeg 8.x Static Build Verification (P0.3)
- macOS arm64: evermeet.cx provides x86_64 binary (runs via Rosetta 2 on ARM)
  - Version: 8.1.1, SHA256: 543d6861b3254d344b2e2737d175bab0d55f67019263b36be2d22adb0e5a96b0
  - All 4 required codecs verified: libmp3lame, aac, flac, pcm_s16le
  - Bundle size: 17 MB (7z), extracted: 76 MB
- Windows x64 & Linux x64: BtbN/FFmpeg-Builds provides daily auto-builds
  - Version: 8.1 (latest), GPL-enabled with all dependencies
  - Windows: ffmpeg-n8.1-latest-win64-gpl-8.1.zip (~208 MB)
  - Linux: ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz (~134 MB)
  - SHA256 checksums available in BtbN releases
- All platforms confirmed for required codecs (MP3, AAC, FLAC, WAV)
- Documentation: docs/ffmpeg-platform-matrix.md created with URLs, SHA256, sizes
- Evidence files: .sisyphus/evidence/task-P0.3-{macos-version,codecs}.txt

## [2026-05-16] P0.4 heartlib API surface findings
- Music generation public entry is `HeartMuLaGenPipeline.from_pretrained(...); pipe({...})`, not a dedicated `generate_music` method.
- Generation inputs accept inline strings OR file paths for `tags` and `lyrics`; both are lowercased and tags are normalized to `<tag>...</tag>`.
- Generation output path currently writes via `torchaudio.save(..., 48000)` after `HeartCodec.detokenize`; adapter should wrap temp path and return WAV bytes.
- Lyrics transcription entry is `HeartTranscriptorPipeline` (Whisper ASR pipeline subclass) using inherited `__call__` rather than custom `transcribe()`.

## [2026-05-16] W1.3 - Error Envelope Contract + Structured Logging
- **Task:** Define unified error envelope contract and error code catalog
- **Status:** ✅ Complete
- **Key Deliverables:**
  - `packages/shared-types/src/errors.ts`: ErrorCode enum (11 codes), ApiError interface, HTTP_STATUS mapping
  - `packages/shared-types/src/index.ts`: Re-exports for error types
  - `packages/shared-types/src/__tests__/errors.test.ts`: 5 comprehensive tests (all passing)
  - `docs/error-envelope.md`: Complete error code catalog with HTTP status, descriptions, retriable flags, usage guidelines
- **Error Codes (11 total):**
  - VALIDATION_ERROR (422), MODEL_NOT_FOUND (404), GPU_UNAVAILABLE (503), OUT_OF_MEMORY (503)
  - SIDECAR_DOWN (503), JOB_NOT_FOUND (404), CANCELLED (409), EXPORT_FAILED (500)
  - DOWNLOAD_FAILED (500), KEY_VAULT_ERROR (500), INTERNAL_ERROR (500)
- **Test Results:** 8 tests passing (5 in errors.test.ts, 3 in contracts.test.ts)
- **Verification:** All 11 error codes present in docs/error-envelope.md, HTTP_STATUS complete, ApiError interface validated
- **Commit:** f73e0de "feat(types): unified ApiError envelope + error code catalog"
- **Evidence:** `.sisyphus/evidence/task-W1.3-error-coverage.txt`
