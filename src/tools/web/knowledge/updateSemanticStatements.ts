import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import {
  knowledgeGraphIdSchema,
  knowledgePathIdSchema,
  redactSemanticStatements,
  semanticStatementsSchema,
  validateUpdate,
} from './semanticStatementSchemas.js';

const paramsSchema = {
  graphId: knowledgeGraphIdSchema,
  contextId: knowledgePathIdSchema.describe('Semantic context ID returned by create or list.'),
  statements: semanticStatementsSchema.optional().describe('Replacement statement array.'),
  name: z
    .string()
    .trim()
    .optional()
    .describe('Replacement name; blank resets the generated label.'),
};

export const getUpdateSemanticStatementsTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'update-knowledge-semantic-contexts',
    description:
      'Replaces the statements and/or name of an existing global semantic context in a Tableau Knowledge graph.',
    paramsSchema,
    annotations: {
      title: 'Update Semantic Statements',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('knowledge-write-tools')),
    ),
    callback: async (args, extra): Promise<CallToolResult> => {
      return tool.logAndExecute({
        extra,
        args: redactSemanticStatements(args),
        callback: async () => {
          validateUpdate(args);
          const statements =
            args.statements === undefined
              ? undefined
              : semanticStatementsSchema.parse(args.statements);
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: (restApi) =>
                restApi.knowledgeMethods.updateSemanticStatements({ ...args, statements }),
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });
  return tool;
};
