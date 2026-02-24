import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { TableauAuthInfo } from '../../server/oauth/schemas.js';
import { Tool } from '../tool.js';
import { codeModeParamsSchema, executeCodeMode } from './common.js';

export const getCodeModeExecuteTool = (
  server: Server,
  authInfo?: TableauAuthInfo,
): Tool<typeof codeModeParamsSchema> => {
  const tool = new Tool({
    server,
    name: 'execute',
    description:
      'Execute JavaScript code in a sandbox with access to Tableau operations through `tableau.operations.<operationId>(args)` and capability metadata through `spec`. Use `tableau.unwrap(result)` to extract normalized `data` from operation responses.',
    paramsSchema: codeModeParamsSchema,
    annotations: {
      title: 'Execute Tableau Code',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async ({ code }, extra): Promise<CallToolResult> =>
      await executeCodeMode({
        tool,
        code,
        server,
        authInfo,
        extra,
        allowInvocations: true,
      }),
  });

  return tool;
};
