import { describe, it, expect } from 'vitest';
import { ErrorCode, ApiError, HTTP_STATUS } from '../errors';

describe('ErrorCode and ApiError', () => {
  it('should export all 11 error codes', () => {
    const expectedCodes = [
      'VALIDATION_ERROR',
      'MODEL_NOT_FOUND',
      'GPU_UNAVAILABLE',
      'OUT_OF_MEMORY',
      'SIDECAR_DOWN',
      'JOB_NOT_FOUND',
      'CANCELLED',
      'EXPORT_FAILED',
      'DOWNLOAD_FAILED',
      'KEY_VAULT_ERROR',
      'INTERNAL_ERROR',
    ];

    expectedCodes.forEach((code) => {
      expect(ErrorCode).toHaveProperty(code);
      expect(ErrorCode[code as keyof typeof ErrorCode]).toBe(code);
    });

    expect(Object.keys(ErrorCode)).toHaveLength(11);
  });

  it('should have HTTP_STATUS entry for every ErrorCode', () => {
    Object.values(ErrorCode).forEach((code) => {
      expect(HTTP_STATUS).toHaveProperty(code);
      expect(typeof HTTP_STATUS[code]).toBe('number');
      expect(HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(HTTP_STATUS[code]).toBeLessThan(600);
    });

    expect(Object.keys(HTTP_STATUS)).toHaveLength(11);
  });

  it('should have correct HTTP status mappings', () => {
    expect(HTTP_STATUS.VALIDATION_ERROR).toBe(422);
    expect(HTTP_STATUS.MODEL_NOT_FOUND).toBe(404);
    expect(HTTP_STATUS.GPU_UNAVAILABLE).toBe(503);
    expect(HTTP_STATUS.OUT_OF_MEMORY).toBe(503);
    expect(HTTP_STATUS.SIDECAR_DOWN).toBe(503);
    expect(HTTP_STATUS.JOB_NOT_FOUND).toBe(404);
    expect(HTTP_STATUS.CANCELLED).toBe(409);
    expect(HTTP_STATUS.EXPORT_FAILED).toBe(500);
    expect(HTTP_STATUS.DOWNLOAD_FAILED).toBe(500);
    expect(HTTP_STATUS.KEY_VAULT_ERROR).toBe(500);
    expect(HTTP_STATUS.INTERNAL_ERROR).toBe(500);
  });

  it('should have ApiError interface with required fields', () => {
    const error: ApiError = {
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Invalid input',
      retriable: false,
    };

    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.message).toBe('Invalid input');
    expect(error.retriable).toBe(false);
  });

  it('should support optional fields in ApiError', () => {
    const error: ApiError = {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong',
      retriable: true,
      details: { context: 'test' },
      hint: 'Try again later',
    };

    expect(error.details).toEqual({ context: 'test' });
    expect(error.hint).toBe('Try again later');
  });
});
