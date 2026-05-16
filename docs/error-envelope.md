# Error Envelope Contract

This document defines the unified error response envelope and error code catalog for AudioMorph Studio APIs.

## Error Response Structure

All API errors follow this structure:

```typescript
interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  retriable: boolean;
  hint?: string;
}
```

- **code**: Machine-readable error code (see catalog below)
- **message**: Human-readable error message
- **details**: Optional structured data (e.g., validation errors, context)
- **retriable**: Whether the client should retry the operation
- **hint**: Optional guidance for the client (e.g., "Try again in 30 seconds")

## Error Code Catalog

| Error Code       | HTTP Status | Description                                                                | Retriable |
| ---------------- | ----------- | -------------------------------------------------------------------------- | --------- |
| VALIDATION_ERROR | 422         | Input validation failed (malformed request, missing fields, invalid types) | No        |
| MODEL_NOT_FOUND  | 404         | Requested model not found in registry or cache                             | No        |
| GPU_UNAVAILABLE  | 503         | GPU resources unavailable (no CUDA devices, out of VRAM)                   | Yes       |
| OUT_OF_MEMORY    | 503         | System ran out of memory during processing                                 | Yes       |
| SIDECAR_DOWN     | 503         | Python sidecar process is unavailable or crashed                           | Yes       |
| JOB_NOT_FOUND    | 404         | Job ID does not exist or has expired                                       | No        |
| CANCELLED        | 409         | Operation was cancelled by user or system                                  | No        |
| EXPORT_FAILED    | 500         | Audio export/encoding failed (codec error, file I/O)                       | No        |
| DOWNLOAD_FAILED  | 500         | Model or asset download failed (network, storage)                          | No        |
| KEY_VAULT_ERROR  | 500         | Secure key storage operation failed                                        | No        |
| INTERNAL_ERROR   | 500         | Unexpected server error (unhandled exception)                              | No        |

## Usage Guidelines

### Server-Side

- Never include stack traces in the `message` field
- Place stack traces and sensitive context in `details` (server-side only)
- Set `retriable: true` only for transient failures (503, timeouts)
- Provide actionable `hint` for user-facing errors

### Client-Side

- Check `retriable` flag before implementing retry logic
- Display `message` to users
- Log `code` for analytics and debugging
- Use `hint` to guide user actions

## Example Responses

### Validation Error

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid audio format",
  "details": {
    "field": "format",
    "value": "mp5",
    "allowed": ["mp3", "wav", "flac", "aac"]
  },
  "retriable": false
}
```

### Transient Service Error

```json
{
  "code": "GPU_UNAVAILABLE",
  "message": "GPU resources exhausted",
  "retriable": true,
  "hint": "Try again in 30 seconds or use CPU mode"
}
```

### Not Found

```json
{
  "code": "MODEL_NOT_FOUND",
  "message": "Model 'heartmu-v2' not found",
  "details": {
    "requested": "heartmu-v2",
    "available": ["heartmu-v1", "heartmu-v1.5"]
  },
  "retriable": false
}
```
