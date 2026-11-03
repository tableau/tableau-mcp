import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DATASOURCE_CALC_VALIDATION_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
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
  caption: z
    .string()
    .min(1)
    .optional()
    .describe('Caption the field would have; duplicates are errors.'),
  fieldName: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Existing calculated field being edited, as [datasource].[field]. Omit for a new field.',
    ),
};

export const getValidateCalculatedFieldTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'validate-calculated-field',
    minApiVersion: DATASOURCE_CALC_VALIDATION_MIN_API_VERSION,
    title,
    description:
      'Check a new or edited calculated field against a datasource without changing the workbook. Returns isValid, errors (position, length, message), and if valid dataType and isAggregate.',
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
          const resolved = await resolveDatasourceRef({ session, datasourceName, extra });
          if (resolved.isErr()) {
            return resolved;
          }
          const datasourceId = resolved.value.id;

          return await runExternalApiReadTool({
            session: resolved.value.resolvedSession,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'calculated field validation',
                async (executor, signal) =>
                  await executor.validateDatasourceCalculatedField(
                    datasourceId,
                    {
                      formula,
                      ...(caption !== undefined ? { caption } : {}),
                      ...(fieldName !== undefined ? { fieldName } : {}),
                    },
                    signal,
                  ),
              ),
          });
        },
      });
    },
  });

  return tool;
};
