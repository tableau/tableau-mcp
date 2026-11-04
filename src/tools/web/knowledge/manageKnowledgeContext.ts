import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, FeatureDisabledError } from '../../../errors/mcpToolError.js';
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
const isGlobalSchema = z
  .boolean()
  .optional()
  .describe(
    'true: a company-wide rule that applies to the whole graph. "create" requires isGlobal: true.',
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

const paramsShape = {
  action: actionSchema,
  graphId: optionalGraphIdSchema,
  contextId: contextIdSchema,
  statements: statementsSchema,
  isGlobal: isGlobalSchema,
  name: nameSchema,
};

// `.strict()` makes an unknown key a parse error. Otherwise the SDK silently drops it and the call
// runs without whatever the caller meant that key to do.
const paramsSchema = z.object(paramsShape).strict();
type ManageArgs = z.infer<typeof paramsSchema>;

const FIELDS_BY_ACTION: Record<ManageArgs['action'], ReadonlyArray<keyof ManageArgs>> = {
  create: ['statements', 'isGlobal', 'name'],
  update: ['contextId', 'statements', 'isGlobal', 'name'],
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
    disabled: new Provider(async () => {
      const gate = getFeatureGate();
      return (
        !(await gate.isFeatureEnabled('knowledge-tools')) ||
        !(await gate.isFeatureEnabled('knowledge-write-tools'))
      );
    }),
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
          if (await Provider.from(tool.disabled)) {
            return new FeatureDisabledError('Knowledge write tools are disabled.').toErr();
          }

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
                      }),
                      args.statements!,
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
                      isGlobal: args.isGlobal,
                      name: args.name,
                    });
                    return { action: args.action, context };
                  }
                  case 'delete': {
                    // The service answers 204 for ids that don't exist or aren't a customer-managed
                    // context; a node lookup covers attached contexts too, which the graph-wide list
                    // does not.
                    const exists = await methods
                      .getKnowledgeNode({ graphId: args.graphId, nodeId: args.contextId! })
                      .then((node) => node.type === 'SEMANTIC_CONTEXT')
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
                          'No customer-managed context with this id exists in the graph, so nothing ' +
                          'was deleted. ' +
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

/**
 * An existing customer-managed context in the same scope (graph-wide) that already
 * holds every new statement. Read-only external contexts can't be updated, so they never count.
 */
function findDuplicate(
  existing: SemanticContextNode[],
  statements: Array<{ statement: string }>,
): SemanticContextNode | undefined {
  const wanted = statements.map(({ statement }) => normalizeStatement(statement));
  return existing.find((context) => {
    if (context.type !== 'SEMANTIC_CONTEXT') return false;
    if (context.target_node_id != null) return false;
    const stored = new Set(
      context.properties.statements.map((s) => normalizeStatement(s.statement)),
    );
    return wanted.every((text) => stored.has(text));
  });
}

/**
 * Pure per-action validation that the flat schema can no longer express structurally: which
 * params are allowed for the chosen action, which are required, and the isGlobal
 * requirement on create and the "at least one changed field" rule. Returns a clear, actionable message
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

  if (args.action === 'create' && args.isGlobal !== true) {
    return 'create requires isGlobal: true.';
  }

  if (args.action === 'update') {
    if (!args.statements && args.isGlobal === undefined && args.name === undefined) {
      return 'update requires at least one changed field.';
    }
  }

  return null;
}
