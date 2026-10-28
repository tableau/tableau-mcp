import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const title = 'Validate Calculated Field';

const paramsSchema = {
  session: sessionParam(),
  worksheetName: artifactNameParam('worksheet', { min: 1 }),
  formula: z.string().min(1).describe('Calculated field formula to check.'),
};

export const getValidateCalculatedFieldTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'validate-calculated-field',
    minApiVersion: '0.2.16',
    title,
    description:
      'Check a calculated field formula against a worksheet without changing the workbook. Returns isValid and errors (position, length, message).',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, worksheetName, formula }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, worksheetName, formula },
        callback: async () =>
          await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const worksheets = await read(
                'worksheet list',
                async (activeExecutor, activeSignal) =>
                  await activeExecutor.listWorksheets(activeSignal),
              );
              if (worksheets.isErr()) return worksheets;
              const target = resolveItemByNameOrId(
                'Worksheet',
                worksheetName,
                worksheets.value.worksheets ?? [],
              );
              if (target.isErr()) return target.error.toErr();

              return await read(
                'calculated field validation',
                async (activeExecutor, activeSignal) =>
                  await activeExecutor.validateWorksheetCalculatedField(
                    target.value.id,
                    formula,
                    activeSignal,
                  ),
              );
            },
          }),
      });
    },
  });

  return tool;
};
