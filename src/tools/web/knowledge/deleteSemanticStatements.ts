import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { knowledgeGraphIdSchema, knowledgePathIdSchema } from './semanticStatementSchemas.js';

const paramsSchema = {
  graphId: knowledgeGraphIdSchema,
  contextId: knowledgePathIdSchema.describe('Semantic context ID returned by create or list.'),
};

export const getDeleteSemanticStatementsTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'delete-knowledge-semantic-statements',
    description:
      'Deletes a Tableau Knowledge-managed semantic context and its statements. Idempotent: an absent, hidden, or non-semantic context ID succeeds without deleting anything. Tableau-managed external contexts cannot be deleted.',
    paramsSchema,
    annotations: {
      title: 'Delete Semantic Statements',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('knowledge-write-tools')),
    ),
    callback: async (args, extra): Promise<CallToolResult> => {
      return tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: (restApi) => restApi.knowledgeMethods.deleteSemanticStatements(args),
          });
          return new Ok({ contextId: args.contextId, deleted: true });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });
  return tool;
};
