/**
 * @file Tests for getEmbedTokenToolClient
 */
import { describe, expect, it, vi } from 'vitest';

import { callGetEmbedTokenTool } from './getEmbedTokenToolClient.js';

describe('callGetEmbedTokenTool', () => {
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

    const token = await callGetEmbedTokenTool(mockApp as any);

    expect(token).toBe('test-bearer-token-12345');
    expect(mockApp.callServerTool).toHaveBeenCalledWith({
      name: 'get-embed-token',
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

    await expect(callGetEmbedTokenTool(mockApp as any)).rejects.toThrow();
  });

  it('should throw error when response has no content', async () => {
    const mockApp = {
      callServerTool: vi.fn().mockResolvedValue({
        content: [],
      }),
    };

    await expect(callGetEmbedTokenTool(mockApp as any)).rejects.toThrow();
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

    await expect(callGetEmbedTokenTool(mockApp as any)).rejects.toThrow();
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

    await expect(callGetEmbedTokenTool(mockApp as any)).rejects.toThrow();
  });

  it('should propagate errors from callServerTool', async () => {
    const mockApp = {
      callServerTool: vi.fn().mockRejectedValue(new Error('Tool call failed')),
    };

    await expect(callGetEmbedTokenTool(mockApp as any)).rejects.toThrow('Tool call failed');
  });

  it('should handle MCP error responses', async () => {
    const mockApp = {
      callServerTool: vi
        .fn()
        .mockRejectedValue(
          new Error('OAuth Bearer token retrieval is only available for Bearer authentication'),
        ),
    };

    await expect(callGetEmbedTokenTool(mockApp as any)).rejects.toThrow(
      'OAuth Bearer token retrieval is only available for Bearer authentication',
    );
  });

  it('should return null when the tool reports no token is available (isError)', async () => {
    const mockApp = {
      callServerTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'No embed token is available for the current authentication configuration.',
          },
        ],
        isError: true,
      }),
    };

    const token = await callGetEmbedTokenTool(mockApp as any);

    expect(token).toBeNull();
  });
});
