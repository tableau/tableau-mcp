import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import { OpenApiDocument } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getOpenApiDocumentTool } from './getOpenApiDocument.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('get-openapi-document tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the read contract', () => {
    const tool = getOpenApiDocumentTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-openapi-document');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('returns info and a compact operations list instead of the full document', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const document: OpenApiDocument = {
      openapi: '3.0.1',
      info: { title: 'External Client API', version: '0.2.25' },
      paths: {
        '/v0/app': {
          get: { operationId: 'getApp', summary: 'Get app info', responses: { '200': {} } },
        },
        '/v0/app:toggleDataSourcePage': {
          post: { operationId: 'toggleDataSourcePage', requestBody: { required: true } },
          parameters: [],
        },
      },
      components: { schemas: { Big: {} } },
    };
    const getOpenApi = vi.fn().mockResolvedValue(Ok(document));
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue(makeExecutorMock({ getOpenApi })),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(parseResult(result)).toEqual({
      openapi: '3.0.1',
      info: { title: 'External Client API', version: '0.2.25' },
      operations: [
        { method: 'GET', path: '/v0/app', operationId: 'getApp', summary: 'Get app info' },
        {
          method: 'POST',
          path: '/v0/app:toggleDataSourcePage',
          operationId: 'toggleDataSourcePage',
        },
      ],
    });
    expect(getOpenApi).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(extra.getExecutor).toHaveBeenCalledWith('999');
  });

  it('maps an executor error to a tool error', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(
        makeExecutorMock({
          getOpenApi: vi.fn().mockResolvedValue(
            Err({
              type: 'command-failed' as const,
              error: { code: 'internal-error', message: 'boom', recoverable: false },
            }),
          ),
        }),
      ),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('boom');
  });

  it('rejects a non-string session through the params schema', () => {
    const tool = getOpenApiDocumentTool(new DesktopMcpServer());
    const schema = z.object(tool.paramsSchema as z.ZodRawShape);

    expect(schema.safeParse({ session: 123 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(true);
  });
});

async function invokeTool(
  args: { session: string | undefined },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getOpenApiDocumentTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}

function parseResult(result: CallToolResult): unknown {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
