import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import type { SemanticContextNode } from '../../../sdks/tableau/types/knowledge.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';
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
  .describe(
    'Exact id of the existing context to revise or remove, as returned by ' +
      'inspect-knowledge-context (contextId). Required for "update" and "delete"; not used by "create".',
  );
const statementsSchema = z
  .array(statementInputSchema)
  .min(1)
  .max(100)
  .optional()
  .describe(
    'The statement text to store, one to 100 entries. Required for "create". For "update" it ' +
      "replaces the context's current statements; omit it to change only name or scope.",
  );
const targetNodeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .optional()
  .describe(
    'Attach the context to this exact node id (a field, data source, workbook, ...) so it is ' +
      'returned whenever that node is grounded. Mutually exclusive with isGlobal.',
  );
const isGlobalSchema = z
  .boolean()
  .optional()
  .describe(
    'true: a company-wide rule that applies to the whole graph rather than one node. Mutually ' +
      'exclusive with targetNodeId; "create" needs exactly one of the two.',
  );
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .optional()
  .describe('Short label for the context. Defaults to the start of the statement text.');

// A flat raw shape, not a z.discriminatedUnion. The MCP SDK's normalizeObjectSchema needs a
// top-level `.shape` to advertise a real inputSchema; a discriminated union (and any
// `.superRefine` wrapper around one) has none, so the SDK falls back to advertising
// `{"type":"object","properties":{}}` and agents guess at arguments. See validateArgs below for
// the per-action rules this flat shape can no longer express structurally.
const actionSchema = z
  .enum(['create', 'update', 'delete'])
  .describe(
    'What to do. "create": store a new context. "update": revise an existing context by ' +
      'contextId. "delete": remove an existing context by contextId.',
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
Record, revise, or retire the organization's governed business definitions, rules, and notes in
Tableau Knowledge ("add a rule", "update the definition of ...", "remove that note"). Changes are
shared with everyone and every agent that uses the graph, so make sure the exact wording is what the
user wants before writing; when the user has already given the exact change, create or update can be
applied without asking again. Never delete without the user's approval: first show the user the
statement and contextId you would remove, and call delete only after they confirm that target in
their reply. Find the id of an existing rule with inspect-knowledge-context first, and revise a rule
that already exists instead of adding a duplicate. Tell the user exactly what the response says
happened.
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
                    const duplicate = findDuplicate(
                      await methods.listSemanticStatements({
                        graphId: args.graphId,
                        nodeId: args.targetNodeId,
                      }),
                      args.statements!,
                      args.targetNodeId,
                    );
                    if (duplicate) {
                      return {
                        action: args.action,
                        created: false,
                        reason: 'DUPLICATE',
                        existingContextId: duplicate.id,
                        message:
                          'An identical statement already exists in this scope, so nothing was ' +
                          'created. Update the existing context instead if the wording should change.',
                      };
                    }
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
                    // The service answers 204 for ids that don't exist; a node lookup covers attached
                    // contexts too, which the graph-wide list does not.
                    const exists = await methods
                      .getKnowledgeNode({ graphId: args.graphId, nodeId: args.contextId! })
                      .then(() => true)
                      .catch((error) => {
                        if (getHttpStatus(error as Error) === '404') return false;
                        throw error;
                      });
                    if (!exists) {
                      return {
                        action: args.action,
                        contextId: args.contextId,
                        deleted: false,
                        reason: 'NOT_FOUND',
                        message:
                          'No context with this id exists in the graph, so nothing was deleted. ' +
                          'Use inspect-knowledge-context action="list" to find the right contextId.',
                      };
                    }
                    await methods.deleteSemanticStatements({
                      graphId: args.graphId,
                      contextId: args.contextId!,
                    });
                    return { action: args.action, contextId: args.contextId, deleted: true };
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

function normalizeStatement(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** An existing context in the same scope (same node, or graph-wide) that already holds every new statement. */
function findDuplicate(
  existing: SemanticContextNode[],
  statements: Array<{ statement: string }>,
  targetNodeId: string | undefined,
): SemanticContextNode | undefined {
  const wanted = statements.map(({ statement }) => normalizeStatement(statement));
  return existing.find((context) => {
    if ((context.target_node_id ?? undefined) !== targetNodeId) return false;
    const stored = new Set(
      context.properties.statements.map((s) => normalizeStatement(s.statement)),
    );
    return wanted.every((text) => stored.has(text));
  });
}

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
