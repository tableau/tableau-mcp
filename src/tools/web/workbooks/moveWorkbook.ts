import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { assertProjectAllowedByBoundedContext } from '../utils/boundedContextUtils.js';

const paramsSchema = {
  workbookId: z.string().min(1).describe('The LUID of the workbook to move.'),
  projectId: z
    .string()
    .min(1)
    .describe(
      'The LUID of the destination project. Use list-projects to discover available project IDs.',
    ),
};

export type MoveWorkbookResult = {
  id: string;
  name?: string;
  projectId: string;
};

export const getMoveWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const moveWorkbookTool = new WebTool({
    server,
    name: 'move-workbook',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    activityLogObject: ({ workbookId }) => ({ type: 'workbook', luid: workbookId }),
    description:
      'Moves a workbook into a different project. Use list-projects to discover available project IDs.',
    paramsSchema,
    annotations: {
      title: 'Move Workbook',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    disabled: new Provider(async () => !(await getFeatureGate().isFeatureEnabled('data-apps'))),
    callback: async ({ workbookId, projectId }, extra): Promise<CallToolResult> => {
      return await moveWorkbookTool.logAndExecute<MoveWorkbookResult>({
        extra,
        args: { workbookId, projectId },
        callback: async () => {
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            extra,
          });
          if (!isWorkbookAllowedResult.allowed) {
            return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
          }

          const configWithOverrides = await extra.getConfigWithOverrides();
          assertProjectAllowedByBoundedContext(projectId, configWithOverrides.boundedContext);

          const workbook = await useRestApi({
            ...extra,
            jwtScopes: moveWorkbookTool.requiredApiScopes,
            callback: async (restApi) =>
              await restApi.workbooksMethods.updateWorkbook({
                siteId: restApi.siteId,
                workbookId,
                projectId,
              }),
          });

          return new Ok({
            id: workbook.id ?? workbookId,
            name: workbook.name,
            projectId: workbook.project?.id ?? projectId,
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return moveWorkbookTool;
};
