import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { resolveLocalWorkbook } from './localWorkbookFile.js';
import { stageWorkbookForWebAuthoring } from './stageWorkbookForWebAuthoring.js';
import {
  getStartWebAuthoringSessionTool,
  toStartWebAuthoringSessionResult,
  ValidationFinding,
} from './startWebAuthoringSession.js';

const mocks = vi.hoisted(() => ({
  restApi: { siteId: 'site-id' },
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) => callback(mocks.restApi)),
}));

vi.mock('./localWorkbookFile.js', () => ({
  resolveLocalWorkbook: vi.fn(),
}));

vi.mock('./stageWorkbookForWebAuthoring.js', () => ({
  stageWorkbookForWebAuthoring: vi.fn(),
}));

const workbookFilePath = '/Users/test/generated-workbook.twb';

describe('getStartWebAuthoringSessionTool', () => {
  it('declares the documented tool contract with one local path parameter', async () => {
    const tool = getStartWebAuthoringSessionTool(new WebMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema)).strict();

    expect(tool.name).toBe('start-web-authoring-session');
    expect(tool.annotations).toEqual({
      title: 'Start Web Authoring Session',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(tool.requiredApiScopes).toEqual([
      'tableau:file_uploads:create',
      'tableau:workbooks:create',
    ]);
    expect(schema.safeParse({ workbookFilePath }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ workbookFilePath, extra: true }).success).toBe(false);
  });

  it('stages a local workbook and returns a ready URL without exposing the upload ID separately', async () => {
    vi.mocked(resolveLocalWorkbook).mockResolvedValue({
      fileName: 'generated-workbook.twb',
      bytes: Buffer.from('<workbook />'),
    });
    vi.mocked(stageWorkbookForWebAuthoring).mockResolvedValue({
      validation: {
        uploadId: 'secret-upload-id',
        timestamp: '2026-08-09T12:00:00Z',
        errors: [],
        warnings: [],
      },
      authoringUrl:
        'https://tableau.example.com/vizql/show/authoring/newWorkbook/id/fromFileUpload/token',
    });

    const { result, extra } = await getToolResult('Bearer');

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      status: 'ready',
      url: 'https://tableau.example.com/vizql/show/authoring/newWorkbook/id/fromFileUpload/token',
      warnings: [],
    });
    expect(result.structuredContent).not.toHaveProperty('uploadId');
    expect(resolveLocalWorkbook).toHaveBeenCalledWith(workbookFilePath);
    expect(useRestApi).toHaveBeenCalledWith(
      expect.objectContaining({
        jwtScopes: ['tableau:file_uploads:create', 'tableau:workbooks:create'],
      }),
    );
    expect(stageWorkbookForWebAuthoring).toHaveBeenCalledWith({
      restApi: mocks.restApi,
      server: extra.config.server,
      siteName: 'tc25',
      workbookBytes: Buffer.from('<workbook />'),
      workbookFileName: 'generated-workbook.twb',
    });
  });

  it.each(['X-Tableau-Auth', 'Passthrough'] as const)(
    'accepts the %s authentication context',
    async (authType) => {
      vi.mocked(resolveLocalWorkbook).mockResolvedValue({
        fileName: 'generated-workbook.twb',
        bytes: Buffer.from('<workbook />'),
      });
      vi.mocked(stageWorkbookForWebAuthoring).mockResolvedValue({
        validation: { timestamp: '2026-08-09T12:00:00Z', errors: [], warnings: [] },
        authoringUrl: 'https://tableau.example.com/authoring-url',
      });

      const { result } = await getToolResult(authType);

      expect(result.isError).toBe(false);
    },
  );

  it('rejects PAT-style context before reading or initiating an upload', async () => {
    const { result } = await getToolResult(undefined);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'start-web-authoring-session requires OAuth, embedded OAuth, or passthrough authentication.',
    });
    expect(resolveLocalWorkbook).not.toHaveBeenCalled();
    expect(useRestApi).not.toHaveBeenCalled();
    expect(stageWorkbookForWebAuthoring).not.toHaveBeenCalled();
  });

  it('redacts the local path passed to shared logging', async () => {
    const tool = getStartWebAuthoringSessionTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback({ workbookFilePath }, getMockRequestHandlerExtra());

    const loggedArgs = logAndExecute.mock.calls[0][0].args;
    expect(loggedArgs).toEqual({ workbookFilePath: '<redacted>' });
    expect(JSON.stringify(loggedArgs)).not.toContain(workbookFilePath);
  });
});

describe('toStartWebAuthoringSessionResult', () => {
  it('returns validation errors and warnings without an authoring URL', () => {
    const result = toStartWebAuthoringSessionResult({
      validation: {
        uploadId: 'secret-upload-id',
        timestamp: '2026-08-09T12:00:00Z',
        errors: [finding('error', 'Invalid workbook')],
        warnings: [finding('warning', 'Deprecated element')],
      },
      authoringUrl: 'https://tableau.example.com/should-not-be-returned',
    });

    expect(result).toEqual({
      status: 'invalid',
      errors: [finding('error', 'Invalid workbook')],
      warnings: [finding('warning', 'Deprecated element')],
    });
    expect(result).not.toHaveProperty('url');
    expect(result).not.toHaveProperty('uploadId');
  });

  it('removes control characters and bounds finding text', () => {
    const result = toStartWebAuthoringSessionResult({
      validation: {
        timestamp: '2026-08-09T12:00:00Z',
        errors: [],
        warnings: [finding('warning\n', `message\u0000${'x'.repeat(2_100)}`)],
      },
      authoringUrl: 'https://tableau.example.com/authoring-url',
    });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.warnings[0].severity).toBe('warning ');
      expect(result.warnings[0].message).not.toContain('\u0000');
      expect(result.warnings[0].message).toHaveLength(2_000);
    }
  });
});

async function getToolResult(
  authType: 'Bearer' | 'X-Tableau-Auth' | 'Passthrough' | undefined,
): Promise<{ result: CallToolResult; extra: ReturnType<typeof getMockRequestHandlerExtra> }> {
  vi.clearAllMocks();
  const tool = getStartWebAuthoringSessionTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = getMockRequestHandlerExtra();
  extra.tableauAuthInfo = getAuthInfo(authType);
  return {
    result: await callback({ workbookFilePath }, extra),
    extra,
  };
}

function getAuthInfo(authType: 'Bearer' | 'X-Tableau-Auth' | 'Passthrough' | undefined): any {
  if (!authType) return undefined;
  if (authType === 'Bearer') {
    return {
      type: authType,
      username: 'test-user',
      server: 'https://tableau.example.com',
      siteId: 'site-id',
      siteName: 'tc25',
      raw: 'secret-token',
    };
  }
  if (authType === 'X-Tableau-Auth') {
    return {
      type: authType,
      username: 'test-user',
      server: 'https://tableau.example.com',
      siteName: 'tc25',
      accessToken: 'secret-token',
      userId: 'user-id',
    };
  }
  return {
    type: authType,
    username: 'test-user',
    userId: 'user-id',
    server: 'https://tableau.example.com',
    siteId: 'site-id',
    siteName: 'tc25',
    raw: 'secret-token',
  };
}

function finding(severity: string, message: string): ValidationFinding {
  return { severity, message, line: 1, column: 2, elementName: 'workbook' };
}
