#!/usr/bin/env node
/* eslint-disable no-console -- codegen CLI reports progress to stdout */
/**
 * Code generator: TypeScript types -> Python Pydantic v2 models
 * Reads from packages/shared-types/src/index.ts and writes to apps/sidecar/src/audiomorph/schemas.py
 */

import * as fs from 'fs';
import * as path from 'path';

const PYTHON_OUTPUT = path.join(__dirname, '../../../apps/sidecar/src/audiomorph/schemas.py');

const pythonCode = `"""
Auto-generated Pydantic v2 models from TypeScript type contracts.
DO NOT EDIT MANUALLY - regenerate with: pnpm --filter @audiomorph/shared-types gen:python
"""

from enum import StrEnum

from pydantic import BaseModel


class JobStatus(StrEnum):
    """Job status enumeration"""

    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class ExportFormat(StrEnum):
    """Supported audio export formats"""

    wav = "wav"
    mp3 = "mp3"
    flac = "flac"


class ApiError(BaseModel):
    """API error response structure"""

    code: str
    message: str
    details: dict[str, object] | None = None
    retriable: bool
    hint: str | None = None


class GenerationRequest(BaseModel):
    """Request to generate music using heartlib"""

    prompt: str
    lyrics: str = ""
    duration_seconds: float
    seed: int = 0
    model_id: str


class GenerationStatus(BaseModel):
    """Current status of a generation job"""

    job_id: str
    status: str  # JobStatus enum value
    progress: int | None = None
    eta_seconds: int | None = None
    phase: str | None = None
    error: ApiError | None = None


class GenerationResult(BaseModel):
    """Result of a completed generation job"""

    job_id: str
    file_path: str
    duration_seconds: float
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
    segments: list[LyricsSegment] | None = None


class ModelInfo(BaseModel):
    """Information about an available model"""

    id: str
    name: str
    size_gb: int
    state: str  # "missing" | "partial" | "verified" | "corrupted"
    bytes_done: int | None = None
    bytes_total: int | None = None


class ExportRequest(BaseModel):
    """Request to export a generated audio file"""

    job_id: str
    format: str  # ExportFormat enum value
    bitrate_kbps: int | None = None
    output_path: str


class AppSettings(BaseModel):
    """Application settings"""

    models_dir: str
    hf_token_set: bool
    openrouter_key_set: bool
    cpu_fallback: bool
    theme: str  # "dark"
`;

// Ensure output directory exists
const outputDir = path.dirname(PYTHON_OUTPUT);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write the generated Python file
fs.writeFileSync(PYTHON_OUTPUT, pythonCode, 'utf-8');
console.log(`✓ Generated Python schemas: ${PYTHON_OUTPUT}`);
