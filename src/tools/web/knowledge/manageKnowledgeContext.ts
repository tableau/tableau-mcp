import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { graphIdSchema } from './knowledgeToolUtils.js';

const statementInputSchema = z.object({
  statement: z.string().trim().min(1).max(10000),
  id: z.string().trim().min(1).max(512).nullable().optional(),
});
const optionalGraphIdSchema = graphIdSchema
  .optional()
  .describe("Knowledge graph ID. Omit to use the site's primary graph.");
const contextIdSchema = z.string().trim().min(1).max(512).describe('Exact semantic context ID.');
const statementsSchema = z
  .array(statementInputSchema)
  .min(1)
  .max(100)
  .describe('One to 100 semantic statements.');
const targetNodeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .optional()
  .describe('Attach the context to this exact Knowledge node ID.');
const isGlobalSchema = z
  .boolean()
  .optional()
  .describe('Set true to make the context graph-wide instead of node-specific.');
const nameSchema = z.string().trim().min(1).max(1000).optional().describe('Context name.');

const actionParamsSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      graphId: optionalGraphIdSchema,
      statements: statementsSchema,
      targetNodeId: targetNodeIdSchema,
      isGlobal: isGlobalSchema,
      name: nameSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      graphId: optionalGraphIdSchema,
      contextId: contextIdSchema,
      statements: statementsSchema.optional(),
      targetNodeId: targetNodeIdSchema,
      isGlobal: isGlobalSchema,
      name: nameSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      graphId: optionalGraphIdSchema,
      contextId: contextIdSchema,
    })
    .strict(),
]);

const paramsSchema = actionParamsSchema.superRefine((args, context) => {
  const message = validateArgs(args);
  if (message) context.addIssue({ code: z.ZodIssueCode.custom, message });
});

export const getManageKnowledgeContextTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'manage-knowledge-context',
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('knowledge-tools')),
    ),
    minRequiredRole: SiteRole.CREATOR,
    registrationConditions: ['RequiresKnowledge'],
    description: `
Creates, updates, and deletes customer-governed Tableau Knowledge context. Use action="create" to
add context, "update" to revise a context by exact contextId, and "delete" to remove a context by
exact contextId. Every action changes shared graph state; present the exact proposed change to the
user before invoking it. Use inspect-knowledge-context when you need to find existing context, check
for possible duplicates, or obtain a contextId. Inspection is not required when the user provides a
complete, confirmed change with exact identifiers.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Manage Knowledge Context',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: async (restApi) => {
                const methods = restApi.knowledgeMethods;
                switch (args.action) {
                  case 'create': {
                    const context = await methods.createSemanticStatements({
                      graphId: args.graphId,
                      statements: args.statements,
                      targetNodeId: args.targetNodeId,
                      isGlobal: args.isGlobal,
                      name: args.name,
                    });
                    return { action: args.action, context };
                  }
                  case 'update': {
                    const context = await methods.updateSemanticStatements({
                      graphId: args.graphId,
                      contextId: args.contextId,
                      statements: args.statements,
                      targetNodeId: args.targetNodeId,
                      isGlobal: args.isGlobal,
                      name: args.name,
                    });
                    return { action: args.action, context };
                  }
                  case 'delete': {
                    await methods.deleteSemanticStatements({
                      graphId: args.graphId,
                      contextId: args.contextId,
                    });
                    return {
                      action: args.action,
                      contextId: args.contextId,
                      requestCompleted: true,
                    };
                  }
                }
              },
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};

function validateArgs(args: z.infer<typeof actionParamsSchema>): string | null {
  if (args.action === 'create') {
    if (!args.targetNodeId && args.isGlobal !== true) {
      return 'create requires targetNodeId or isGlobal: true.';
    }
    if (args.targetNodeId && args.isGlobal === true) {
      return 'create accepts targetNodeId or isGlobal: true, not both.';
    }
  }

  if (args.action === 'update') {
    if (args.targetNodeId && args.isGlobal === true) {
      return 'update accepts targetNodeId or isGlobal: true, not both.';
    }
    if (
      !args.statements &&
      args.targetNodeId === undefined &&
      args.isGlobal === undefined &&
      args.name === undefined
    ) {
      return 'update requires at least one changed field.';
    }
  }

  return null;
}
