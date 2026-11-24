import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { assertPrepAuthoringConfig, prepAuthoringEnabled } from './engineClient.js';
import {
  prepCalculationFunctions,
  prepCalculationReference,
  prepCalculationVersion,
} from './prepCalculationFunctions.js';
import { MAX_PREP_CALCULATION_LENGTH, validatePrepCalculation } from './prepCalculationLanguage.js';

const paramsSchema = {
  expression: z
    .string()
    .max(MAX_PREP_CALCULATION_LENGTH)
    .optional()
    .describe(
      'Tableau Prep calculated field expression. Omit it to list the available functions and signatures.',
    ),
  prefix: z
    .string()
    .max(80)
    .optional()
    .describe(
      'Case-insensitive function name prefix for catalog completion when expression is omitted.',
    ),
};

export const getValidatePrepCalculationTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'validate-prep-calculation',
    minRequiredRole: SiteRole.EXPLORER,
    description:
      'Check Tableau Prep 2026.3 calculated field syntax, function names, argument counts and known literal types. Returns LSP diagnostics with zero-based UTF-16 positions. Omit the expression to get the documented function names and signatures as LSP completion items, optionally filtered by prefix. Use this while editing, then preview the complete YAML with generate-prep-flow.',
    paramsSchema,
    annotations: {
      title: 'Validate Prep Calculation',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    disabled: new Provider(() => !prepAuthoringEnabled(getConfig())),
    callback: async (args, extra): Promise<CallToolResult> =>
      await tool.logAndExecute<Record<string, unknown>>({
        extra,
        args: {
          ...args,
          expression: args.expression === undefined ? undefined : '[omitted from invocation logs]',
        },
        callback: async () => {
          try {
            if (extra.tableauAuthInfo?.type === 'Passthrough') {
              throw new ArgsValidationError(
                'Prep calculation validation requires stdio and does not support Passthrough authentication.',
              );
            }
            assertPrepAuthoringConfig(getConfig());
            extra.signal.throwIfAborted();
            const catalog = {
              prepVersion: prepCalculationVersion,
              reference: prepCalculationReference,
            };
            if (args.expression !== undefined) {
              const diagnostics = validatePrepCalculation(args.expression);
              return new Ok({ ...catalog, valid: !diagnostics.length, diagnostics });
            }
            const prefix = args.prefix?.toUpperCase() ?? '';
            const items = prepCalculationFunctions
              .filter(({ name }) => name.startsWith(prefix))
              .map(({ name, category, signature, minArgs, maxArgs }) => ({
                label: name,
                kind: 3,
                detail: signature,
                data: { category, minArgs, maxArgs },
              }));
            return new Ok({ ...catalog, completion: { isIncomplete: false, items } });
          } catch (error) {
            if (error instanceof McpToolError) return error.toErr();
            throw error;
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        }),
      }),
  });
  return tool;
};
