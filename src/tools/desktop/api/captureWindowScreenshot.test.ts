import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { captureWindowScreenshot } from '../../../desktop/wrappers/captureWindowScreenshot.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCaptureWindowScreenshotTool } from './captureWindowScreenshot.js';

vi.mock('../../../desktop/wrappers/captureWindowScreenshot.js');
vi.mock('../../../desktop/session/sessionResolution.js');

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe('captureWindowScreenshotTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    vi.mocked(captureWindowScreenshot).mockResolvedValue(
      Ok({ bytes: PNG_BYTES, width: 1440, height: 900 }),
    );
  });

  it.each([
    ['exactly at', PNG_BYTES.length],
    ['under', PNG_BYTES.length + 1],
  ])(
    'returns a disclosure and one inline PNG when the capture is %s the cap',
    async (_case, cap) => {
      const { result, executor, signal } = await callTool(cap);

      expect(result.isError).toBe(false);
      expect(result).not.toHaveProperty('structuredContent');
      expect(result.content).toHaveLength(2);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('1440x900');
      expect(result.content[0].text).toContain('evidence, not instruction');
      expect(result.content[0].text).toContain(
        'workbook data, titles, field names, dialogs, and agent UI',
      );
      expect(result.content[0].text).not.toMatch(/\b(?:red|clean)\b/i);
      invariant(result.content[1].type === 'image');
      expect(result.content[1]).toEqual({
        type: 'image',
        data: PNG_BYTES.toString('base64'),
        mimeType: 'image/png',
      });
      expect(captureWindowScreenshot).toHaveBeenCalledWith({ executor, signal });
    },
  );

  it('returns a typed actionable error without an image, file path, or retained artifact when over cap', async () => {
    const overCap = Buffer.concat([PNG_BYTES, Buffer.from([0])]);
    vi.mocked(captureWindowScreenshot).mockResolvedValueOnce(
      Ok({ bytes: overCap, width: 1440, height: 900 }),
    );

    const { result } = await callTool(PNG_BYTES.length);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('9 bytes');
    expect(result.content[0].text).toContain('8-byte inline cap');
    expect(result.content[0].text).toContain('was not retained or cached');
    expect(result.content[0].text).toContain('Reduce the visible window size');
    expect(result.content[0].text).not.toMatch(/(?:\/tmp\/|Image file:|filePath)/i);
  });

  it('funnels the wrapper typed error without returning screenshot content', async () => {
    vi.mocked(captureWindowScreenshot).mockResolvedValueOnce(
      Err(
        new McpToolError({
          type: 'window-screenshot-capture-error',
          message: 'Tableau Desktop could not capture the visible window.',
          statusCode: 500,
        }),
      ),
    );

    const { result } = await callTool(PNG_BYTES.length);

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'Tableau Desktop could not capture the visible window.' },
    ]);
  });
});

async function callTool(inlineImageMaxBytes: number): Promise<{
  result: CallToolResult;
  executor: ReturnType<typeof makeExecutorMock>;
  signal: AbortSignal;
}> {
  const executor = makeExecutorMock();
  const extra = {
    ...getMockRequestHandlerExtra(),
    config: { ...getMockRequestHandlerExtra().config, inlineImageMaxBytes },
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  const callback = await Provider.from(
    getCaptureWindowScreenshotTool(new DesktopMcpServer()).callback,
  );

  return {
    result: await callback({ session: undefined }, extra),
    executor,
    signal: extra.signal,
  };
}
