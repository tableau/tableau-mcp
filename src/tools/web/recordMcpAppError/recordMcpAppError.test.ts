import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRecordMcpAppErrorTool } from './recordMcpAppError.js';

// Mock getProductTelemetry so we can assert on the forwarder's send(). Note that
// WebTool.logAndExecute also emits an automatic 'tool_call' event through the same
// forwarder, so the spy is called for both 'tool_call' and 'tableau_mcp_event.completed'.
vi.mock('../../../telemetry/productTelemetry/telemetryForwarder.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../telemetry/productTelemetry/telemetryForwarder.js')
    >();
  return { ...actual, getProductTelemetry: vi.fn() };
});

import { getProductTelemetry } from '../../../telemetry/productTelemetry/telemetryForwarder.js';

type Extra = ReturnType<typeof getMockRequestHandlerExtra>;

describe('getRecordMcpAppErrorTool', () => {
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
    vi.mocked(getProductTelemetry).mockReturnValue({ send: sendSpy } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getRecordMcpAppErrorTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    expect(tool.name).toBe('record-mcp-app-error');
    expect(annotations?.readOnlyHint).toBe(true);
    expect(annotations?.openWorldHint).toBe(false);
  });

  it('should set visibility to app-only', () => {
    const tool = getRecordMcpAppErrorTool(new WebMcpServer());
    expect(tool.meta?.ui?.visibility).toEqual(['app']);
  });

  it('sends an tableau_mcp_event.completed event with the scenario, message and server context', async () => {
    const extra = getMockRequestHandlerExtra();
    const result = await getToolResult(extra, { scenario: 'PARSE_ERROR', message: 'bad json' });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      'tableau_mcp_event.completed',
      expect.objectContaining({
        scenario: 'PARSE_ERROR',
        message: 'bad json',
        podname: extra.config.server,
        is_hyperforce: extra.config.isHyperforce,
      }),
    );
  });

  it('defaults message to empty string when omitted', async () => {
    const extra = getMockRequestHandlerExtra();
    await getToolResult(extra, { scenario: 'EMBED_LOAD_ERROR' });

    expect(sendSpy).toHaveBeenCalledWith(
      'tableau_mcp_event.completed',
      expect.objectContaining({ scenario: 'EMBED_LOAD_ERROR', message: '' }),
    );
  });
});

async function getToolResult(
  extra: Extra,
  args: { scenario: string; message?: string },
): Promise<CallToolResult> {
  const tool = getRecordMcpAppErrorTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}
