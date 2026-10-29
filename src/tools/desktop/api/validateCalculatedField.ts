import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { resolveDatasourceRef } from './resolveDatasourceRef.js';

const title = 'Validate Calculated Field';

const paramsSchema = {
  session: sessionParam(),
  datasourceName: artifactNameParam('datasource', { min: 1 }),
  formula: z.string().min(1).describe('Calculated field formula to check.'),
  caption: z.string().min(1).optional().describe('Caption to check; must be unique.'),
  fieldName: z
    .string()
    .min(1)
    .optional()
    .describe('Edited calc as [datasource].[field] internal names. Omit for a new calc.'),
};

export const getValidateCalculatedFieldTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'validate-calculated-field',
    minApiVersion: '0.2.27',
    title,
    description:
      'Check a new or edited calc formula on a datasource without changing the workbook. Returns isValid, errors, and isAggregate and dataType when valid.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, datasourceName, formula, caption, fieldName },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, datasourceName, formula, caption, fieldName },
        callback: async () => {
          const datasource = await resolveDatasourceRef({ session, datasourceName, extra });
          if (datasource.isErr()) {
            return datasource;
          }
          const resolved = datasource.value;

          return await runExternalApiReadTool({
            session: resolved.resolvedSession,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'calculated field validation',
                async (activeExecutor, activeSignal) =>
                  await activeExecutor.validateDatasourceCalculatedField(
                    resolved.id,
                    { formula, caption, fieldName },
                    activeSignal,
                  ),
              ),
          });
        },
      });
    },
  });

  return tool;
};
