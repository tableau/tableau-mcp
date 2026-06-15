/**
 * @file Tests for getOAuthTokenToolClient
 */
import { describe, expect, it, vi } from 'vitest';

import { callGetOAuthTokenTool } from './getOAuthTokenToolClient.js';

describe('callGetOAuthTokenTool', () => {
  it('should successfully retrieve OAuth token', async () => {
    const mockApp = {
      callServerTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              token: 'test-bearer-token-12345',
              tokenType: 'Bearer',
            }),
          },
        ],
      }),
    };

    const token = await callGetOAuthTokenTool(mockApp as any);

    expect(token).toBe('test-bearer-token-12345');
    expect(mockApp.callServerTool).toHaveBeenCalledWith({
      name: 'get-oauth-token',
      arguments: {},
    });
  });

  it('should throw error when response format is unexpected (non-text content)', async () => {
    const mockApp = {
      callServerTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'image',
            data: 'invalid-content',
          },
        ],
      }),
    };

    await expect(callGetOAuthTokenTool(mockApp as any)).rejects.toThrow(
      'Unexpected response format from get-oauth-token',
    );
  });

  it('should throw error when response has no content', async () => {
    const mockApp = {
      callServerTool: vi.fn().mockResolvedValue({
        content: [],
      }),
    };

    await expect(callGetOAuthTokenTool(mockApp as any)).rejects.toThrow();
  });

  it('should throw error when JSON parsing fails', async () => {
    const mockApp = {
      callServerTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'invalid-json',
          },
        ],
      }),
    };

    await expect(callGetOAuthTokenTool(mockApp as any)).rejects.toThrow();
  });

  it('should throw error when token is missing from response', async () => {
    const mockApp = {
      callServerTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              tokenType: 'Bearer',
              // token field is missing
            }),
          },
        ],
      }),
    };

    const token = await callGetOAuthTokenTool(mockApp as any);
    expect(token).toBeUndefined();
  });

  it('should propagate errors from callServerTool', async () => {
    const mockApp = {
      callServerTool: vi.fn().mockRejectedValue(new Error('Tool call failed')),
    };

    await expect(callGetOAuthTokenTool(mockApp as any)).rejects.toThrow('Tool call failed');
  });

  it('should handle MCP error responses', async () => {
    const mockApp = {
      callServerTool: vi
        .fn()
        .mockRejectedValue(
          new Error('OAuth Bearer token retrieval is only available for Bearer authentication'),
        ),
    };

    await expect(callGetOAuthTokenTool(mockApp as any)).rejects.toThrow(
      'OAuth Bearer token retrieval is only available for Bearer authentication',
    );
  });
});
