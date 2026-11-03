import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DATASOURCE_CALC_VALIDATION_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
import { qualifyDatasourceColumn } from '../../../desktop/wrappers/qualifyDatasourceColumn.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { isDatasourceQualified } from './qualifyColumnField.js';
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
      'Internal name of the existing calculated field being edited (e.g. Calculation_123), or [datasource].[field] using internal names for both. Omit for a new field.',
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
          const {
            id: datasourceId,
            name: internalName,
            caption: datasourceCaption,
          } = resolved.value;

          return await runExternalApiReadTool({
            session: resolved.value.resolvedSession,
            extra,
            callback: async (activeExecutor, _signal, read) => {
              const field = fieldName?.trim();
              const qualifiedFieldName =
                field === undefined || isDatasourceQualified(field)
                  ? field
                  : qualifyDatasourceColumn(
                      activeExecutor.desktopApiVersion,
                      { internalName, caption: datasourceCaption },
                      field,
                    );
              return await read(
                'calculated field validation',
                async (executor, signal) =>
                  await executor.validateDatasourceCalculatedField(
                    datasourceId,
                    {
                      formula,
                      ...(caption !== undefined ? { caption } : {}),
                      ...(qualifiedFieldName !== undefined
                        ? { fieldName: qualifiedFieldName }
                        : {}),
                    },
                    signal,
                  ),
              );
            },
          });
        },
      });
    },
  });

  return tool;
};
