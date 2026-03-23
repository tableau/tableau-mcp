import express from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../config.js';
import { AuthenticatedRequest } from './oauth/types.js';
import { jwtSubClaimHeaderMiddleware } from './jwtSubClaimHeaderMiddleware.js';

function mockConfig(overrides: Partial<Config> = {}): Config {
  return {
    oauth: { enabled: false },
    jwtSubClaimRequestHeaderName: 'x-tableau-jwt-username',
    jwtSubClaimRequestSecretHeaderName: 'x-tableau-mcp-jwt-sub-secret',
    jwtSubClaimRequestSecret: 'the-secret',
    ...overrides,
  } as Config;
}

function createReq(headers: Record<string, string>): AuthenticatedRequest {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    get(name: string): string | undefined {
      return lower[name.toLowerCase()];
    },
  } as AuthenticatedRequest;
}

describe('jwtSubClaimHeaderMiddleware', () => {
  it('sets req.auth.extra.username when headers are valid', () => {
    const mw = jwtSubClaimHeaderMiddleware(mockConfig());
    const req = createReq({
      'x-tableau-jwt-username': '  alice@example.com  ',
      'x-tableau-mcp-jwt-sub-secret': 'the-secret',
    });
    const res = {} as express.Response;
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.auth?.extra).toEqual({ username: 'alice@example.com' });
  });

  it('returns 401 when secret is wrong', () => {
    const mw = jwtSubClaimHeaderMiddleware(mockConfig());
    const req = createReq({
      'x-tableau-jwt-username': 'alice@example.com',
      'x-tableau-mcp-jwt-sub-secret': 'wrong',
    });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as express.Response;
    const next = vi.fn();
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('returns 400 when username is only whitespace', () => {
    const mw = jwtSubClaimHeaderMiddleware(mockConfig());
    const req = createReq({
      'x-tableau-jwt-username': '   ',
      'x-tableau-mcp-jwt-sub-secret': 'the-secret',
    });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as express.Response;
    const next = vi.fn();
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('calls next without auth when username header is absent', () => {
    const mw = jwtSubClaimHeaderMiddleware(mockConfig());
    const req = createReq({});
    const next = vi.fn();
    mw(req, {} as express.Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toBeUndefined();
  });

  it('no-ops when feature is disabled', () => {
    const mw = jwtSubClaimHeaderMiddleware(
      mockConfig({ jwtSubClaimRequestHeaderName: '', jwtSubClaimRequestSecret: '' }),
    );
    const req = createReq({ 'x-tableau-jwt-username': 'alice@example.com' });
    const next = vi.fn();
    mw(req, {} as express.Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toBeUndefined();
  });

  it('no-ops when OAuth is enabled', () => {
    const mw = jwtSubClaimHeaderMiddleware(
      mockConfig({ oauth: { enabled: true } as Config['oauth'] }),
    );
    const req = createReq({
      'x-tableau-jwt-username': 'alice@example.com',
      'x-tableau-mcp-jwt-sub-secret': 'the-secret',
    });
    const next = vi.fn();
    mw(req, {} as express.Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toBeUndefined();
  });
});
