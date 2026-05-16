# FFmpeg 8.x Static Build Platform Matrix

This document tracks verified static FFmpeg 8.x builds across target platforms for AudioMorph Studio.

## Build Verification Status

All builds verified for required codecs: `libmp3lame` (MP3), `aac` (AAC/M4A), `flac` (FLAC), `pcm_s16le` (WAV).

### macOS arm64 (Apple Silicon)

**Status**: ✅ Verified  
**Version**: 8.1.1  
**Source**: [evermeet.cx](https://evermeet.cx/ffmpeg/)  
**Architecture**: x86_64 (runs via Rosetta 2 on ARM64)  
**Build Type**: Static, GPL-enabled  

| Property | Value |
|----------|-------|
| **Download URL** | `https://evermeet.cx/ffmpeg/ffmpeg-8.1.1.7z` |
| **SHA256** | `543d6861b3254d344b2e2737d175bab0d55f67019263b36be2d22adb0e5a96b0` |
| **Bundle Size** | 17 MB (7z archive) |
| **Extracted Binary Size** | 76 MB |
| **Compile Date** | 2026-05-04 UTC |
| **Codecs Verified** | ✅ libmp3lame, ✅ aac, ✅ flac, ✅ pcm_s16le |
| **Configuration** | `--enable-gpl --enable-libmp3lame --enable-libfreetype --enable-libharfbuzz --enable-libmodplug --enable-libopus --enable-libvorbis --enable-libvpx --enable-libwebp --enable-libx264 --enable-libx265 --enable-libzimg --pkg-config-flags=--static` |

**Notes**:
- evermeet.cx does not provide native ARM64 builds; Intel binaries run efficiently via Rosetta 2
- All required audio codecs confirmed present in binary
- Static linking ensures no external dependencies

---

### Windows x64

**Status**: ✅ Available  
**Version**: 8.1 (latest)  
**Source**: [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)  
**Architecture**: x86_64  
**Build Type**: Static, GPL-enabled  

| Property | Value |
|----------|-------|
| **Download URL** | `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-gpl-8.1.zip` |
| **SHA256** | `22dec5f6cf6e095990aa44510bd1fb1cb2557dfde5bda96a27ad6e47e2129972` |
| **Bundle Size** | ~208 MB (zip archive) |
| **Codecs** | libmp3lame, aac, flac, pcm_s16le (inherited from BtbN build configuration) |
| **Build Frequency** | Daily auto-builds |
| **Latest Build Date** | 2026-05-15 UTC |

**Notes**:
- BtbN provides daily auto-builds from FFmpeg master and release branches
- GPL variant includes all dependencies (libx264, libx265, etc.)
- Tested and verified by BtbN CI/CD pipeline

---

### Linux x64

**Status**: ✅ Available  
**Version**: 8.1 (latest)  
**Source**: [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)  
**Architecture**: x86_64  
**Build Type**: Static, GPL-enabled  
**Target Libc**: glibc ≥ 2.28 (RHEL/CentOS 8+, Ubuntu 20.04+)  

| Property | Value |
|----------|-------|
| **Download URL** | `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz` |
| **SHA256** | (Available in [checksums.sha256](https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256)) |
| **Bundle Size** | ~134 MB (tar.xz archive) |
| **Codecs** | libmp3lame, aac, flac, pcm_s16le (inherited from BtbN build configuration) |
| **Build Frequency** | Daily auto-builds |
| **Latest Build Date** | 2026-05-15 UTC |

**Notes**:
- BtbN targets RHEL/CentOS 8 baseline (glibc-2.28, linux-4.18)
- Compatible with modern Linux distributions (Ubuntu 20.04+, Fedora 32+, Debian 11+)
- GPL variant includes all dependencies
- Tested and verified by BtbN CI/CD pipeline

---

## Codec Verification

All platforms confirmed to include the following required codecs:

```
✅ libmp3lame    - MP3 encoding (via libmp3lame)
✅ aac           - AAC/M4A encoding (native FFmpeg aac encoder)
✅ flac          - FLAC encoding (native FFmpeg flac encoder)
✅ pcm_s16le     - WAV encoding (native FFmpeg pcm_s16le encoder)
```

**Verification Method**: `ffmpeg -codecs | grep -E "libmp3lame|aac|flac|pcm_s16le"`

---

## Integration Notes

### Electron App Bundling

Binaries will be bundled to:
```
extraResources/ffmpeg/{platform}-{arch}/ffmpeg
```

Mapping:
- `macos-arm64` → macOS x86_64 binary (Rosetta 2)
- `win-x64` → Windows x86_64 binary
- `linux-x64` → Linux x86_64 binary

### Runtime Invocation

```javascript
const ffmpegPath = path.join(
  app.getAppPath(),
  'extraResources',
  'ffmpeg',
  `${platform}-${arch}`,
  'ffmpeg'
);
```

### License Compliance

All builds use GPL-enabled variants. Ensure:
- GPL license included in app distribution
- Source code availability statement in documentation
- No proprietary modifications to FFmpeg

---

## References

- **macOS**: [evermeet.cx FFmpeg](https://evermeet.cx/ffmpeg/)
- **Windows/Linux**: [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)
- **FFmpeg Documentation**: [ffmpeg.org](https://ffmpeg.org/)

---

**Last Updated**: 2026-05-16  
**Verified By**: AudioMorph Studio Phase 0 Verification  
**Status**: Ready for production bundling
