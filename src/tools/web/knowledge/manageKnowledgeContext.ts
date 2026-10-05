import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
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
const contextIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .optional()
  .describe('Exact semantic context ID. (action=update|delete only — required for both.)');
const statementsSchema = z
  .array(statementInputSchema)
  .min(1)
  .max(100)
  .optional()
  .describe(
    'One to 100 semantic statements. (action=create|update only — required for create, optional ' +
      'for update.)',
  );
const targetNodeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .optional()
  .describe(
    'Attach the context to this exact Knowledge node ID. (action=create|update only — provide ' +
      'this or isGlobal: true, not both.)',
  );
const isGlobalSchema = z
  .boolean()
  .optional()
  .describe(
    'Set true to make the context graph-wide instead of node-specific. (action=create|update ' +
      'only — provide this or targetNodeId, not both.)',
  );
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .optional()
  .describe('Context name. (action=create|update only.)');

// A flat raw shape, not a z.discriminatedUnion. The MCP SDK's normalizeObjectSchema needs a
// top-level `.shape` to advertise a real inputSchema; a discriminated union (and any
// `.superRefine` wrapper around one) has none, so the SDK falls back to advertising
// `{"type":"object","properties":{}}` and agents guess at arguments. See validateArgs below for
// the per-action rules this flat shape can no longer express structurally.
const actionSchema = z
  .enum(['create', 'update', 'delete'])
  .describe(
    'Which mutation to run. "create": statements (required), graphId, targetNodeId, isGlobal, ' +
      'name. "update": contextId (required), graphId, statements, targetNodeId, isGlobal, name. ' +
      '"delete": contextId (required), graphId.',
  );

const paramsSchema = {
  action: actionSchema,
  graphId: optionalGraphIdSchema,
  contextId: contextIdSchema,
  statements: statementsSchema,
  targetNodeId: targetNodeIdSchema,
  isGlobal: isGlobalSchema,
  name: nameSchema,
};

// Type-only helper: gives validateArgs a precise parameter type. This object schema is never
// registered with the MCP server or used to parse anything — `paramsSchema` above (the flat raw
// shape) is what the SDK advertises and parses against.
type ManageArgs = z.infer<z.ZodObject<typeof paramsSchema>>;

const FIELDS_BY_ACTION: Record<ManageArgs['action'], ReadonlyArray<keyof ManageArgs>> = {
  create: ['statements', 'targetNodeId', 'isGlobal', 'name'],
  update: ['contextId', 'statements', 'targetNodeId', 'isGlobal', 'name'],
  delete: ['contextId'],
};
const REQUIRED_BY_ACTION: Record<ManageArgs['action'], ReadonlyArray<keyof ManageArgs>> = {
  create: ['statements'],
  update: ['contextId'],
  delete: ['contextId'],
};

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
          // Surfaced from inside logAndExecute (not a pre-callback early return) so the invocation
          // is still logged and telemetry-emitted even when the args are rejected.
          const validationError = validateArgs(args);
          if (validationError) {
            return new ArgsValidationError(validationError).toErr();
          }

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
                      statements: args.statements!,
                      targetNodeId: args.targetNodeId,
                      isGlobal: args.isGlobal,
                      name: args.name,
                    });
                    return { action: args.action, context };
                  }
                  case 'update': {
                    const context = await methods.updateSemanticStatements({
                      graphId: args.graphId,
                      contextId: args.contextId!,
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
                      contextId: args.contextId!,
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

/**
 * Pure per-action validation that the flat schema can no longer express structurally: which
 * params are allowed for the chosen action, which are required, and the targetNodeId/isGlobal
 * exclusivity + "at least one changed field" business rules. Returns a clear, actionable message
 * on failure, or null when args are valid.
 */
export function validateArgs(args: ManageArgs): string | null {
  const allowed = new Set<keyof ManageArgs>([
    'action',
    'graphId',
    ...FIELDS_BY_ACTION[args.action],
  ]);
  const disallowed = (Object.keys(args) as Array<keyof ManageArgs>).filter(
    (key) => args[key] !== undefined && !allowed.has(key),
  );
  if (disallowed.length > 0) {
    return `${disallowed.join(', ')} ${disallowed.length === 1 ? 'is' : 'are'} not used when action is "${args.action}".`;
  }

  const missing = REQUIRED_BY_ACTION[args.action].filter((key) => args[key] === undefined);
  if (missing.length > 0) {
    return `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required when action is "${args.action}".`;
  }

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
