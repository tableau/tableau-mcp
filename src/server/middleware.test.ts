import { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { handlePingRequest, validatePassthroughHeaders, validateProtocolVersion } from './middleware.js';

describe('middleware', () => {
  function createMockReqResNext(headers: Record<string, string | undefined> = {}) {
    const req = {
      headers,
      body: {},
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    return { req, res, next };
  }

  describe('validatePassthroughHeaders', () => {
    it('should call next when both Authorization and X-Tableau-User-Id headers are present', () => {
      const { req, res, next } = createMockReqResNext({
        authorization: 'Bearer abc123|xyz789|site-luid',
        'x-tableau-user-id': 'user-luid-123',
      });

      validatePassthroughHeaders(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header is missing', () => {
      const { req, res, next } = createMockReqResNext({
        'x-tableau-user-id': 'user-luid-123',
      });

      validatePassthroughHeaders(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          error: expect.objectContaining({
            code: -32001,
            message: expect.stringContaining('Authorization'),
          }),
        }),
      );
    });

    it('should return 401 when X-Tableau-User-Id header is missing', () => {
      const { req, res, next } = createMockReqResNext({
        authorization: 'Bearer abc123',
      });

      validatePassthroughHeaders(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          error: expect.objectContaining({
            code: -32001,
          }),
        }),
      );
    });

    it('should return 401 when both headers are missing', () => {
      const { req, res, next } = createMockReqResNext({});

      validatePassthroughHeaders(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
