import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordEvent } from './recordEventClient.js';

describe('recordEvent', () => {
  let mockApp: App;
  let callServerTool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    callServerTool = vi.fn().mockResolvedValue({});
    mockApp = {
      getHostCapabilities: vi.fn().mockReturnValue({ serverTools: {} }),
      callServerTool,
    } as unknown as App;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the record-event tool with event_type and Error message', () => {
    recordEvent(mockApp, 'PARSE_ERROR', new Error('bad json'));

    expect(callServerTool).toHaveBeenCalledWith({
      name: 'record-event',
      arguments: { event_type: 'PARSE_ERROR', message: 'bad json' },
    });
  });

  it('omits message when there is no detail', () => {
    recordEvent(mockApp, 'TOOL_ERROR');

    expect(callServerTool).toHaveBeenCalledWith({
      name: 'record-event',
      arguments: { event_type: 'TOOL_ERROR' },
    });
  });

  it('does not call the tool when the host lacks serverTools capability', () => {
    (mockApp.getHostCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({});

    recordEvent(mockApp, 'AUTH_ERROR');

    expect(callServerTool).not.toHaveBeenCalled();
  });

  it('does not throw when callServerTool rejects (fire-and-forget)', async () => {
    callServerTool.mockRejectedValue(new Error('transport failed'));

    expect(() => recordEvent(mockApp, 'EMBED_LOAD_ERROR')).not.toThrow();
    // Let the rejected promise settle so the internal .catch runs.
    await new Promise((r) => setTimeout(r, 0));
  });

  it('does not throw when getHostCapabilities throws', () => {
    (mockApp.getHostCapabilities as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('not connected');
    });

    expect(() => recordEvent(mockApp, 'TOOL_ERROR')).not.toThrow();
    expect(callServerTool).not.toHaveBeenCalled();
  });
});
