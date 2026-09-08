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
  redactSemanticStatements,
  semanticStatementsSchema,
} from './semanticStatementSchemas.js';

const paramsSchema = {
  graphId: knowledgeGraphIdSchema,
  statements: semanticStatementsSchema.describe('One or more statements, each 5–1000 characters.'),
  name: z.string().trim().min(1).optional(),
};

export const getCreateSemanticStatementsTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'create-knowledge-semantic-contexts',
    description:
      'Creates one global semantic context of business-rule statements in a Tableau Knowledge graph; it applies to the whole graph. Node-scoped context is Tableau-managed and cannot be created here.',
    paramsSchema,
    annotations: {
      title: 'Create Semantic Statements',
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
          const statements = semanticStatementsSchema.parse(args.statements);
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: (restApi) =>
                restApi.knowledgeMethods.createSemanticStatements({
                  ...args,
                  statements,
                  isGlobal: true,
                }),
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });
  return tool;
};
