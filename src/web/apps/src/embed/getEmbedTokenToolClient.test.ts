/**
 * @file Tests for getEmbedTokenToolClient
 */
import { describe, expect, it, vi } from 'vitest';

import { callGetEmbedTokenTool } from './getEmbedTokenToolClient.js';

describe('callGetEmbedTokenTool', () => {
  it('should successfully retrieve embed token', async () => {
    const mockApp = {
      getHostCapabilities: vi.fn().mockReturnValue({ serverTools: {} }),
      callServerTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              token: 'test-bearer-token-12345',
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
      getHostCapabilities: vi.fn().mockReturnValue({ serverTools: {} }),
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
      getHostCapabilities: vi.fn().mockReturnValue({ serverTools: {} }),
      callServerTool: vi.fn().mockResolvedValue({
        content: [],
      }),
    };

    await expect(callGetEmbedTokenTool(mockApp as any)).rejects.toThrow();
  });

  it('should throw error when JSON parsing fails', async () => {
    const mockApp = {
      getHostCapabilities: vi.fn().mockReturnValue({ serverTools: {} }),
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
      getHostCapabilities: vi.fn().mockReturnValue({ serverTools: {} }),
      callServerTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
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
      getHostCapabilities: vi.fn().mockReturnValue({ serverTools: {} }),
      callServerTool: vi.fn().mockRejectedValue(new Error('Tool call failed')),
    };

    await expect(callGetEmbedTokenTool(mockApp as any)).rejects.toThrow('Tool call failed');
  });

  it('should throw when no token is available (isError)', async () => {
    const mockApp = {
      getHostCapabilities: vi.fn().mockReturnValue({ serverTools: {} }),
      callServerTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Failed to get an embed token for the current authentication configuration.',
          },
        ],
        isError: true,
      }),
    };

    await expect(callGetEmbedTokenTool(mockApp as any)).rejects.toThrow(
      'Failed to get an embed token for the current authentication configuration.',
    );
  });

  it('should throw when host does not support server tools', async () => {
    const mockApp = {
      getHostCapabilities: vi.fn().mockReturnValue({}),
      callServerTool: vi.fn(),
    };

    await expect(callGetEmbedTokenTool(mockApp as any)).rejects.toThrow(
      'the MCP host does not support server tools',
    );
    expect(mockApp.callServerTool).not.toHaveBeenCalled();
  });
});
