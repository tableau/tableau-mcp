import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OpenApiDocument } from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Get Tableau Desktop OpenAPI Summary';

type OperationSummary = {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
};

type OpenApiSummary = {
  openapi: string;
  info: Record<string, unknown>;
  operations: OperationSummary[];
};

const httpMethods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const summarize = (document: OpenApiDocument): OpenApiSummary => ({
  openapi: document.openapi,
  info: document.info,
  operations: Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).flatMap(([method, operation]) => {
      if (!httpMethods.has(method) || typeof operation !== 'object' || operation === null) {
        return [];
      }
      const { operationId, summary } = operation as Record<string, unknown>;
      return [
        {
          method: method.toUpperCase(),
          path,
          ...(typeof operationId === 'string' ? { operationId } : {}),
          ...(typeof summary === 'string' ? { summary } : {}),
        },
      ];
    }),
  ),
});

export const getOpenApiDocumentTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-openapi-document',
    title,
    description:
      "Fetch the running Tableau Desktop instance's OpenAPI document and return its info (title and version) plus a compact list of operations, each with HTTP method, path, operationId, and summary. The full document is not returned.",
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<OpenApiSummary>({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              (
                await call(
                  'OpenAPI document',
                  async (executor, signal) => await executor.getOpenApi(signal),
                )
              ).map(summarize),
          }),
      });
    },
  });

  return tool;
};
