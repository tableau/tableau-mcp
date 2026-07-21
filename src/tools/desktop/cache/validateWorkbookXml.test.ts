import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateWorkbookXmlTool } from './validateWorkbookXml.js';

const validationResultSchema = z.object({
  isValid: z.boolean(),
  validationIssues: z.array(z.string()).optional(),
});

describe('validateWorkbookXmlTool', () => {
  it('should create a tool instance with correct properties', () => {
    const tool = getValidateWorkbookXmlTool(new DesktopMcpServer());
    expect(tool.name).toBe('validate-workbook-xml');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      xml: expect.any(Object),
    });
  });

  it('should return success for well-formed workbook content', async () => {
    const result = await getResult('<?xml version="1.0"?><workbook><worksheets/></workbook>');

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('well-formed');
  });

  it('should return error for malformed workbook content', async () => {
    const result = await getResult('<workbook><worksheets></workbook>');

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Workbook structure has');
  });

  it('should include fix suggestion referencing apply-workbook', async () => {
    const result = await getResult('<bad xml');

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('apply-workbook');
  });

  it('should list numbered errors when multiple issues exist', async () => {
    const result = await getResult('<a><b></a></c>');

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/\d+\./);
  });
});

describe('validateWorkbookXmlTool with External Client API transport', () => {
  let server: MockExternalApiServer;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = await startMockExternalApiServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('calls the server-side validation endpoint for well-formed XML', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getResult('<?xml version="1.0"?><workbook><worksheets/></workbook>', {
      session: '999',
      getExecutor: vi.fn().mockResolvedValue(executor),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(validationResultSchema.parse(JSON.parse(result.content[0].text))).toEqual({
      isValid: true,
      validationIssues: [],
    });
    expect(server.requests.map((request) => request.path)).toEqual([
      '/v0/workbook/document:validate',
    ]);
  });

  it('surfaces server validation issues as the authoritative result', async () => {
    server.setOverride('POST /v0/workbook/document:validate', {
      status: 200,
      body: JSON.stringify({
        isValid: false,
        validationIssues: ['Dashboard zone references missing worksheet "Missing Sheet"'],
      }),
    });
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getResult('<?xml version="1.0"?><workbook><worksheets/></workbook>', {
      session: '999',
      getExecutor: vi.fn().mockResolvedValue(executor),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(validationResultSchema.parse(JSON.parse(result.content[0].text))).toEqual({
      isValid: false,
      validationIssues: ['Dashboard zone references missing worksheet "Missing Sheet"'],
    });
  });

  it('keeps the local well-formed check as a preflight before calling the server', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getResult('<workbook><worksheets></workbook>', {
      session: '999',
      getExecutor: vi.fn().mockResolvedValue(executor),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Workbook structure has');
    expect(server.requests).toEqual([]);
  });

  it('reports a clear old-build error when the validation route is missing', async () => {
    server.setOverride('POST /v0/workbook/document:validate', {
      status: 404,
      body: JSON.stringify({
        code: 'not-found',
        status: 404,
        instance: '/v0/mock',
        title: 'No route matches POST /v0/workbook/document:validate',
        detail: 'No route matches POST /v0/workbook/document:validate',
      }),
    });
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getResult('<?xml version="1.0"?><workbook><worksheets/></workbook>', {
      session: '999',
      getExecutor: vi.fn().mockResolvedValue(executor),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('does not serve the workbook validation endpoint');
  });
});

function getResult(
  xml: string,
  options?: { session?: string; getExecutor?: ReturnType<typeof vi.fn> },
): Promise<CallToolResult> {
  const tool = getValidateWorkbookXmlTool(new DesktopMcpServer());
  return Provider.from(tool.callback).then((callback) =>
    callback(
      { session: options?.session, xml },
      {
        ...getMockRequestHandlerExtra(),
        ...(options?.getExecutor
          ? {
              config: { ...getMockRequestHandlerExtra().config, externalApiEnabled: true },
              getExecutor: options.getExecutor,
            }
          : {}),
      },
    ),
  );
}

const instanceFor = (server: MockExternalApiServer): ExternalApiInstance => ({
  baseUrl: server.baseUrl,
  token: 'valid-token',
  pid: 999,
  instanceId: 'inst-tool-validate',
  apiVersion: '1.0',
});
