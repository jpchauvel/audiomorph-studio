export { ErrorCode, HTTP_STATUS } from './errors';
export type { ErrorCode as ErrorCodeType, ApiError } from './errors';

/**
 * Job status enumeration for generation tasks
 */
export enum JobStatus {
  queued = "queued",
  running = "running",
  completed = "completed",
  failed = "failed",
  cancelled = "cancelled",
}

/**
 * Supported audio export formats
 */
export enum ExportFormat {
  wav = "wav",
  mp3 = "mp3",
  flac = "flac",
}

/**
 * Request to generate music using heartlib
 */
export interface GenerationRequest {
  prompt: string;
  lyrics: string;
  duration_seconds: number;
  seed: number;
  model_id: string;
  tags?: string;
  reference_audio_path?: string;
  temperature?: number;
  cfg_scale?: number;
}

/**
 * Current status of a generation job
 */
export interface GenerationStatus {
  job_id: string;
  status: JobStatus;
  progress?: number;
  eta_seconds?: number;
  phase?: string;
  error?: ApiError;
}

/**
 * Result of a completed generation job
 */
export interface GenerationResult {
  job_id: string;
  file_path: string;
  duration_seconds: number;
  model_id: string;
  seed: number;
  prompt: string;
  lyrics: string;
  created_at: string;
}

/**
 * Request to transcribe lyrics from audio
 */
export interface LyricsRequest {
  audio_path: string;
}

/**
 * Result of lyrics transcription
 */
export interface LyricsResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * Information about an available model
 */
export interface ModelInfo {
  id: string;
  name: string;
  size_gb: number;
  state: "missing" | "partial" | "verified" | "corrupted";
  bytes_done?: number;
  bytes_total?: number;
}

/**
 * Request to export a generated audio file
 */
export interface ExportRequest {
  job_id: string;
  format: ExportFormat;
  bitrate_kbps?: number;
  output_path: string;
}

/**
 * Application settings
 */
export interface AppSettings {
  models_dir: string;
  hf_token_set: boolean;
  openrouter_key_set: boolean;
  cpu_fallback: boolean;
  theme: "dark";
}
