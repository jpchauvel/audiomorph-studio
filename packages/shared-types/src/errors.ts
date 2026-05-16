export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  GPU_UNAVAILABLE: 'GPU_UNAVAILABLE',
  OUT_OF_MEMORY: 'OUT_OF_MEMORY',
  SIDECAR_DOWN: 'SIDECAR_DOWN',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  CANCELLED: 'CANCELLED',
  EXPORT_FAILED: 'EXPORT_FAILED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  KEY_VAULT_ERROR: 'KEY_VAULT_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  retriable: boolean;
  hint?: string;
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  MODEL_NOT_FOUND: 404,
  GPU_UNAVAILABLE: 503,
  OUT_OF_MEMORY: 503,
  SIDECAR_DOWN: 503,
  JOB_NOT_FOUND: 404,
  CANCELLED: 409,
  EXPORT_FAILED: 500,
  DOWNLOAD_FAILED: 500,
  KEY_VAULT_ERROR: 500,
  INTERNAL_ERROR: 500,
};
