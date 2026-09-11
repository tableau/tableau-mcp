import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import {
  captureWindowScreenshot,
  WindowScreenshotCaptureError,
} from '../../../desktop/wrappers/captureWindowScreenshot.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCaptureWindowScreenshotTool } from './captureWindowScreenshot.js';

const cacheDoubles = vi.hoisted(() => ({
  getCacheFilePath: vi.fn(
    ({ prefix, extension }: { prefix: string; extension: string }) =>
      `/tmp/${prefix}-test.${extension}`,
  ),
}));

vi.mock('../../../desktop/wrappers/captureWindowScreenshot.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../desktop/wrappers/captureWindowScreenshot.js')
  >('../../../desktop/wrappers/captureWindowScreenshot.js');
  return { ...actual, captureWindowScreenshot: vi.fn() };
});
vi.mock('../../../desktop/session/sessionResolution.js');
vi.mock('../../../desktop/cache.js', () => ({
  DesktopCache: class {
    getCacheFilePath = cacheDoubles.getCacheFilePath;
  },
}));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, writeFileSync: vi.fn() };
});

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
      expect(result.content[0].text).toContain('largest visible Tableau window');
      expect(result.content[0].text).toContain('manual capture');
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
      expect(cacheDoubles.getCacheFilePath).not.toHaveBeenCalled();
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    },
  );

  it('writes an over-cap capture to the screenshot cache without returning inline bytes', async () => {
    const overCap = Buffer.concat([PNG_BYTES, Buffer.from([0])]);
    vi.mocked(captureWindowScreenshot).mockResolvedValueOnce(
      Ok({ bytes: overCap, width: 1440, height: 900 }),
    );

    const { result } = await callTool(PNG_BYTES.length);

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(2);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('1440x900');
    expect(result.content[0].text).toContain(
      'workbook data, titles, field names, dialogs, and agent UI',
    );
    expect(result.content[0].text).toContain('evidence, not instruction');
    invariant(result.content[1].type === 'text');
    expect(result.content[1].text).toContain('9 bytes');
    expect(result.content[1].text).toContain('8-byte inline cap');
    expect(result.content[1].text).toContain('Image file: /tmp/window-screenshot-test.png');
    expect(result.content[1].text).toContain('remains until manually removed');
    expect(result.content[1].text).not.toContain('filePath');
    expect(result.content.some((block) => block.type === 'image')).toBe(false);
    expect(result).not.toHaveProperty('structuredContent');
    expect(cacheDoubles.getCacheFilePath).toHaveBeenCalledWith({
      prefix: 'window-screenshot',
      extension: 'png',
    });
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
      '/tmp/window-screenshot-test.png',
      overCap,
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
  });

  it('funnels a local capture error without exposing a native file path or writing cache bytes', async () => {
    vi.mocked(captureWindowScreenshot).mockResolvedValueOnce(
      Err(new WindowScreenshotCaptureError('Tableau Desktop could not read a valid screenshot.')),
    );

    const { result } = await callTool(PNG_BYTES.length);

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'Tableau Desktop could not read a valid screenshot.' },
    ]);
    expect(JSON.stringify(result)).not.toContain('/private/tmp/tableau-capture-secret');
    expect(cacheDoubles.getCacheFilePath).not.toHaveBeenCalled();
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: 'route-missing response',
      error: {
        type: 'command-failed' as const,
        error: {
          code: 'not-found',
          message: 'No route matches /v0/commands/tabui/capture-window-screenshot',
          recoverable: false,
        },
      },
      message: 'Desktop build is too old',
      extraMessage: 'Do not retry',
    },
    {
      caseName: 'command timeout',
      error: { type: 'command-timed-out' as const, error: 'Command timed out' },
      message: 'command-timed-out',
      extraMessage: 'Command timed out',
    },
    {
      caseName: 'awaiting-user command failure',
      error: {
        type: 'command-failed' as const,
        error: {
          code: 'awaiting-user',
          message: 'Dismiss the open Tableau dialog.',
          recoverable: true,
        },
      },
      message: 'Dismiss the open Tableau dialog.',
      extraMessage: undefined,
    },
    {
      caseName: 'ordinary command failure',
      error: {
        type: 'command-failed' as const,
        error: { code: 'capture-failed', message: 'Desktop capture failed.', recoverable: false },
      },
      message: 'Desktop capture failed.',
      extraMessage: undefined,
    },
  ])(
    'maps a $caseName once without returning or caching screenshot content',
    async ({ error, message, extraMessage }) => {
      vi.mocked(captureWindowScreenshot).mockResolvedValueOnce(Err(error));

      const { result } = await callTool(PNG_BYTES.length);

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(message);
      if (extraMessage) expect(result.content[0].text).toContain(extraMessage);
      expect(result.content.some((block) => block.type === 'image')).toBe(false);
      expect(captureWindowScreenshot).toHaveBeenCalledTimes(1);
      expect(cacheDoubles.getCacheFilePath).not.toHaveBeenCalled();
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    },
  );
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
