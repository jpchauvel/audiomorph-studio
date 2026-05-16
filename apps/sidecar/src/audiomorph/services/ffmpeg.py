from __future__ import annotations

import asyncio

from .._errors import ApiError

_ALLOWED_FORMATS = {"wav", "mp3", "flac"}
_DEFAULT_MP3_BITRATE_KBPS = 192
_TIMEOUT_SECONDS = 300


def _build_command(
    input_path: str, output_path: str, format: str, bitrate_kbps: int | None
) -> list[str]:
    if format not in _ALLOWED_FORMATS:
        raise ApiError(
            code="EXPORT_FAILED",
            message=f"Unsupported export format: {format}",
            retriable=False,
            hint=f"Allowed formats: {sorted(_ALLOWED_FORMATS)}",
        )

    cmd: list[str] = ["ffmpeg", "-y", "-i", input_path]

    if format == "wav":
        cmd += ["-acodec", "pcm_s16le"]
    elif format == "mp3":
        br = bitrate_kbps or _DEFAULT_MP3_BITRATE_KBPS
        cmd += ["-acodec", "libmp3lame", "-b:a", f"{br}k"]
    elif format == "flac":
        cmd += ["-acodec", "flac"]

    cmd.append(output_path)
    return cmd


def _first_nonempty_line(data: bytes) -> str | None:
    if not data:
        return None
    for line in data.decode("utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return None


async def convert(
    input_path: str,
    output_path: str,
    format: str,
    bitrate_kbps: int | None = None,
) -> None:
    cmd = _build_command(input_path, output_path, format, bitrate_kbps)

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise ApiError(
            code="EXPORT_FAILED",
            message="ffmpeg not found",
            retriable=False,
            hint="Install ffmpeg or check bundled binary path",
        ) from exc

    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=_TIMEOUT_SECONDS)
    except asyncio.TimeoutError as exc:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise ApiError(
            code="EXPORT_FAILED",
            message="ffmpeg timed out after 5 minutes",
            retriable=True,
        ) from exc

    if proc.returncode != 0:
        raise ApiError(
            code="EXPORT_FAILED",
            message="ffmpeg conversion failed",
            retriable=False,
            hint=_first_nonempty_line(stderr),
        )
