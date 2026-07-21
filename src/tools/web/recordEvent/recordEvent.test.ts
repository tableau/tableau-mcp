import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRecordEventTool } from './recordEvent.js';

// Mock getProductTelemetry so we can assert on the forwarder's send(). Note that
// WebTool.logAndExecute also emits an automatic 'tool_call' event through the same
// forwarder, so the spy is called for both 'tool_call' and 'tableau_mcp_event'.
vi.mock('../../../telemetry/productTelemetry/telemetryForwarder.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../telemetry/productTelemetry/telemetryForwarder.js')
    >();
  return { ...actual, getProductTelemetry: vi.fn() };
});

import { getProductTelemetry } from '../../../telemetry/productTelemetry/telemetryForwarder.js';

type Extra = ReturnType<typeof getMockRequestHandlerExtra>;

describe('getRecordEventTool', () => {
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
    vi.mocked(getProductTelemetry).mockReturnValue({ send: sendSpy } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getRecordEventTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    expect(tool.name).toBe('record-event');
    expect(annotations?.readOnlyHint).toBe(true);
    expect(annotations?.openWorldHint).toBe(false);
  });

  it('should set visibility to app-only', () => {
    const tool = getRecordEventTool(new WebMcpServer());
    expect(tool.meta?.ui?.visibility).toEqual(['app']);
  });

  it('sends an tableau_mcp_event event with the event_type, message and server context', async () => {
    const extra = getMockRequestHandlerExtra();
    const result = await getToolResult(extra, { event_type: 'PARSE_ERROR', message: 'bad json' });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      'tableau_mcp_event',
      expect.objectContaining({
        event_type: 'PARSE_ERROR',
        message: 'bad json',
        podname: extra.config.server,
        is_hyperforce: extra.config.isHyperforce,
      }),
    );
  });

  it('defaults message to empty string when omitted', async () => {
    const extra = getMockRequestHandlerExtra();
    await getToolResult(extra, { event_type: 'EMBED_LOAD_ERROR', message: undefined });

    expect(sendSpy).toHaveBeenCalledWith(
      'tableau_mcp_event',
      expect.objectContaining({ event_type: 'EMBED_LOAD_ERROR', message: '' }),
    );
  });

  it('accepts SCREAMING_SNAKE_CASE event_type values', async () => {
    const schema = z.object(
      await Provider.from(getRecordEventTool(new WebMcpServer()).paramsSchema),
    );
    for (const event_type of [
      'TOOL_ERROR',
      'PARSE_ERROR',
      'AUTH_ERROR',
      'EMBED_LOAD_ERROR',
      'MCP_APP_CLICKED',
    ]) {
      expect(schema.safeParse({ event_type }).success).toBe(true);
    }
  });

  it('truncates message longer than 1024 characters in the forwarded event', async () => {
    const extra = getMockRequestHandlerExtra();
    const longMessage = 'x'.repeat(2000);
    await getToolResult(extra, { event_type: 'TOOL_ERROR', message: longMessage });

    const sentMessage = sendSpy.mock.calls.find((c) => c[0] === 'tableau_mcp_event')?.[1]?.message;
    expect(sentMessage).toBe('x'.repeat(1024));
    expect(sentMessage.length).toBe(1024);
  });
});

async function getToolResult(
  extra: Extra,
  args: { event_type: string; message?: string | undefined },
): Promise<CallToolResult> {
  const tool = getRecordEventTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  // Mirror the MCP framework: params are validated/transformed against paramsSchema before the
  // callback runs, so route args through the schema here (this is where message truncation happens).
  const parsedArgs = z.object(await Provider.from(tool.paramsSchema)).parse(args);
  return await callback({ event_type: parsedArgs.event_type, message: parsedArgs.message }, extra);
}
