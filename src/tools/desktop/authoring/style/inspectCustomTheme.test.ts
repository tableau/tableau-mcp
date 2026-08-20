import { createHash } from 'node:crypto';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getInspectCustomThemeTool } from './inspectCustomTheme.js';

const { fileLogSpy } = vi.hoisted(() => ({ fileLogSpy: vi.fn() }));

vi.mock('../../../../logging/fileLogger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../logging/fileLogger.js')>()),
  getFileLogger: () => ({ log: fileLogSpy }),
}));

describe('inspect-custom-theme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns bounded metadata for a validated theme', async () => {
    const themeJson = JSON.stringify({
      version: '1.0.0',
      'base-theme': 'default',
      styles: {
        mark: { 'mark-color': '#123456' },
        'worksheet-title': { 'font-color': '#654321' },
      },
    });
    const themeSha256 = sha256(themeJson);

    const result = await callTool(themeJson, themeSha256);

    expect(result.isError).toBe(false);
    expect(bodyOf(result)).toEqual({
      themeSha256,
      schemaVersion: '1.0.0',
      byteCount: Buffer.byteLength(themeJson, 'utf8'),
      propertyGroups: ['mark', 'worksheet-title'],
    });
  });

  it('accepts an exact 64 KiB UTF-8 multibyte theme', async () => {
    const themeJson = multibyteThemeJson(64 * 1024);

    const result = await callTool(themeJson, sha256(themeJson));

    expect(result.isError).toBe(false);
    expect(bodyOf(result).byteCount).toBe(64 * 1024);
  });

  it('rejects a 64 KiB plus one UTF-8 multibyte theme without exposing it', async () => {
    const themeJson = multibyteThemeJson(64 * 1024 + 1);

    const result = await callTool(themeJson, sha256(themeJson));

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(themeJson);
    expect(JSON.stringify(result)).not.toContain('Tableau 日本語');
  });

  it.each([
    ['invalid schema', JSON.stringify({ version: '1.0.0', styles: {} }), undefined],
    [
      'hash mismatch',
      JSON.stringify({ version: '1.0.0', 'base-theme': 'default', styles: {} }),
      '0'.repeat(64),
    ],
  ])('rejects %s without exposing theme values', async (_case, themeJson, suppliedSha) => {
    const sentinel = 'PRIVATE_THEME_VALUE_83b4';
    const privateJson = themeJson.replace('{}', `{"worksheet":{"font-family":"${sentinel}"}}`);

    const result = await callTool(privateJson, suppliedSha ?? sha256(privateJson));

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(privateJson);
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it('redacts raw JSON from invocation notifications and file logs', async () => {
    const sentinel = 'PRIVATE_THEME_VALUE_d170';
    const themeJson = JSON.stringify({
      version: '1.0.0',
      'base-theme': 'default',
      styles: { worksheet: { 'font-family': sentinel } },
    });
    const themeSha256 = sha256(themeJson);
    const server = new DesktopMcpServer();
    const notification = vi.fn();
    (
      server as unknown as { mcpServer: { server: { notification: ReturnType<typeof vi.fn> } } }
    ).mcpServer = { server: { notification } };

    const result = await callTool(themeJson, themeSha256, server);
    await vi.waitFor(() => expect(fileLogSpy).toHaveBeenCalled());
    await vi.waitFor(() => expect(notification).toHaveBeenCalled());
    const observable = JSON.stringify({
      result,
      notifications: notification.mock.calls,
      fileLogs: fileLogSpy.mock.calls,
    });

    expect(result.isError).toBe(false);
    expect(observable).toContain('[redacted custom theme JSON]');
    expect(observable).not.toContain(themeJson);
    expect(observable).not.toContain(sentinel);
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function multibyteThemeJson(byteCount: number): string {
  const base = JSON.stringify({
    version: '1.0.0',
    'base-theme': 'default',
    styles: { worksheet: { 'font-family': 'Tableau 日本語' } },
  });
  const themeJson = `${base}${' '.repeat(byteCount - Buffer.byteLength(base, 'utf8'))}`;
  expect(Buffer.byteLength(themeJson, 'utf8')).toBe(byteCount);
  expect(themeJson.length).toBeLessThan(byteCount);
  return themeJson;
}

async function callTool(
  themeJson: string,
  themeSha256: string,
  server = new DesktopMcpServer(),
): Promise<CallToolResult> {
  const callback = await Provider.from(getInspectCustomThemeTool(server).callback);
  return await callback({ themeJson, themeSha256 }, getMockRequestHandlerExtra());
}

function bodyOf(result: CallToolResult): Record<string, unknown> {
  invariant(result.content[0]?.type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}
