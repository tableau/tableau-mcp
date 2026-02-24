import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { TableauAuthInfo } from '../../server/oauth/schemas.js';
import { Tool } from '../tool.js';
import { executeCodeMode, codeModeParamsSchema } from './common.js';

export const getCodeModeSearchTool = (
  server: Server,
  authInfo?: TableauAuthInfo,
): Tool<typeof codeModeParamsSchema> => {
  const tool = new Tool({
    server,
    name: 'search',
    description:
      'Search Tableau capabilities by executing JavaScript against a read-only capability spec. The code should be an async function expression like `async () => { ... }`. `spec.operations` is keyed by operationId, `spec.operationList` is the array form, and `spec.paths` is an empty compatibility map. Each operation may include `requestBody`, `aliases`, and `examples.minimalValidArgs` to guide valid execute payloads.',
    paramsSchema: codeModeParamsSchema,
    annotations: {
      title: 'Search Tableau Capabilities',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ code }, extra): Promise<CallToolResult> =>
      await executeCodeMode({
        tool,
        code,
        server,
        authInfo,
        extra,
        allowInvocations: false,
      }),
  });

  return tool;
};
