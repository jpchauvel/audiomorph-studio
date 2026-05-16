"""
Auto-generated Pydantic v2 models from TypeScript type contracts.
DO NOT EDIT MANUALLY - regenerate with: pnpm --filter @audiomorph/shared-types gen:python
"""

from typing import Optional, List
from pydantic import BaseModel, Field


class JobStatus(str):
    """Job status enumeration"""
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class ExportFormat(str):
    """Supported audio export formats"""
    wav = "wav"
    mp3 = "mp3"
    flac = "flac"


class ApiError(BaseModel):
    """API error response structure"""
    code: str
    message: str
    details: Optional[dict] = None
    retriable: bool
    hint: Optional[str] = None


class GenerationRequest(BaseModel):
    """Request to generate music using heartlib"""
    prompt: str
    lyrics: str
    duration_seconds: int
    seed: int
    model_id: str
    tags: Optional[str] = None
    reference_audio_path: Optional[str] = None
    temperature: Optional[float] = None
    cfg_scale: Optional[float] = None


class GenerationStatus(BaseModel):
    """Current status of a generation job"""
    job_id: str
    status: str  # JobStatus enum value
    progress: Optional[int] = None
    eta_seconds: Optional[int] = None
    phase: Optional[str] = None
    error: Optional[ApiError] = None


class GenerationResult(BaseModel):
    """Result of a completed generation job"""
    job_id: str
    file_path: str
    duration_seconds: int
    model_id: str
    seed: int
    prompt: str
    lyrics: str
    created_at: str


class LyricsRequest(BaseModel):
    """Request to transcribe lyrics from audio"""
    audio_path: str


class LyricsSegment(BaseModel):
    """Segment of transcribed lyrics"""
    start: int
    end: int
    text: str


class LyricsResult(BaseModel):
    """Result of lyrics transcription"""
    text: str
    segments: Optional[List[LyricsSegment]] = None


class ModelInfo(BaseModel):
    """Information about an available model"""
    id: str
    name: str
    size_gb: int
    state: str  # "missing" | "partial" | "verified" | "corrupted"
    bytes_done: Optional[int] = None
    bytes_total: Optional[int] = None


class ExportRequest(BaseModel):
    """Request to export a generated audio file"""
    job_id: str
    format: str  # ExportFormat enum value
    bitrate_kbps: Optional[int] = None
    output_path: str


class AppSettings(BaseModel):
    """Application settings"""
    models_dir: str
    hf_token_set: bool
    openrouter_key_set: bool
    cpu_fallback: bool
    theme: str  # "dark"
