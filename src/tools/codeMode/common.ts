import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { createCapabilityCatalog } from '../../codemode/capabilityCatalog.js';
import { runInSandbox } from '../../codemode/sandbox/runInSandbox.js';
import { TableauCodeModeApi } from '../../codemode/tableauCodeModeApi.js';
import { log } from '../../logging/log.js';
import { Server } from '../../server.js';
import { TableauAuthInfo } from '../../server/oauth/schemas.js';
import { Tool } from '../tool.js';
import { TableauRequestHandlerExtra } from '../toolContext.js';

export const codeModeParamsSchema = {
  code: z.string().min(1),
};

export function buildCodeModeSpec(catalog: Awaited<ReturnType<typeof createCapabilityCatalog>>) {
  const operationsById = Object.fromEntries(
    catalog.operations.map((operation) => [operation.operationId, operation]),
  );

  return {
    // Backward compatibility: `operations` now exposes operationId keyed entries.
    operations: operationsById,
    // Compatibility alias for older prompts that expect list semantics.
    operationList: catalog.operations,
    operationIds: Object.keys(catalog.operationMap),
    // Compatibility alias for OpenAPI-style probes (this server exposes capabilities, not OpenAPI paths).
    paths: {},
  };
}

export async function executeCodeMode({
  tool,
  code,
  server,
  authInfo,
  extra,
  allowInvocations,
}: {
  tool: Tool<typeof codeModeParamsSchema>;
  code: string;
  server: Server;
  authInfo: TableauAuthInfo | undefined;
  extra: TableauRequestHandlerExtra;
  allowInvocations: boolean;
}): Promise<CallToolResult> {
  const catalog = await createCapabilityCatalog({ server, authInfo });
  const codeModeApi = new TableauCodeModeApi({ server, authInfo, catalog });
  const spec = buildCodeModeSpec(catalog);
  const operationMap = allowInvocations ? catalog.operationMap : {};

  return await tool.logAndExecute({
    extra,
    args: { code },
    callback: async () => {
      const start = Date.now();
      const runResult = await runInSandbox({
        config: extra.config,
        code,
        spec,
        operationMap,
        invoke: async (operationId, args) =>
          await codeModeApi.invoke({
            operationId,
            args,
            extra,
          }),
      });

      await log.info(
        server,
        {
          type: 'code-mode-run',
          toolName: tool.name,
          requestId: extra.requestId,
          durationMs: Date.now() - start,
          apiCalls: runResult.apiCalls,
          outputBytes: runResult.outputBytes,
        },
        { logger: 'code-mode', requestId: extra.requestId },
      );

      return new Ok({
        result: runResult.result,
        logs: runResult.logs,
        apiCalls: runResult.apiCalls,
        outputBytes: runResult.outputBytes,
        availableOperations: spec.operationIds,
      });
    },
    constrainSuccessResult: (result) => ({ type: 'success', result }),
  });
}
