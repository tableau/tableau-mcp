import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getFieldDependencies } from '../../../../desktop/metadata/index.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  DesktopCommandExecutionError,
  FieldNotFoundError,
} from '../../../../errors/mcpToolError.desktop.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { jsonToolResult, prefillNextAction, withNextAction } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  field: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Field, calculation or parameter caption or name from the live workbook; exact match.',
    ),
  direction: z
    .enum(['dependents', 'dependencies'])
    .optional()
    .describe('dependents: what uses it. dependencies: what it uses. Omitted means dependents.'),
  datasource: z
    .string()
    .optional()
    .describe('Datasource name or caption. Omitted searches every datasource.'),
};

const title = 'Tracing field dependencies';

export const getGetFieldDependenciesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getFieldDependenciesTool = new DesktopTool({
    server,
    name: 'get-field-dependencies',
    title,
    description:
      'What breaks if a field, calc or parameter changes, or what it is built from, in the live open workbook. Follows formulas, worksheet fields and filters, and dashboard sheets. Traces at most 5 matching fields; pass datasource to narrow.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, field, direction, datasource }, extra): Promise<CallToolResult> => {
      return await getFieldDependenciesTool.logAndExecute({
        extra,
        args: { session, field, direction, datasource },
        getSuccessResult: (result) =>
          jsonToolResult(
            withNextAction(result, prefillNextAction('Use this trace before changing the field')),
            { isError: false },
          ),
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();

          const executor = await extra.getExecutor(sessionResult.value);
          const workbookResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (workbookResult.isErr()) {
            return new DesktopCommandExecutionError(workbookResult.error).toErr();
          }

          const result = getFieldDependencies(workbookResult.value, field, {
            direction,
            datasource,
          });
          if (result.roots.length === 0) {
            return new FieldNotFoundError(field, datasource).toErr();
          }
          return Ok(result);
        },
      });
    },
  });

  return getFieldDependenciesTool;
};
