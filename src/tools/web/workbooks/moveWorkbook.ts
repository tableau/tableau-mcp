import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ArgsValidationError,
  McpToolError,
  UnknownError,
  WorkbookNotAllowedError,
} from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { assertProjectAllowedByBoundedContext } from '../utils/boundedContextUtils.js';
import {
  mapPersonalSpaceSiteDisabledError,
  resolvePersonalSpace,
} from '../utils/personalSpaceUtils.js';

const paramsSchema = {
  workbookId: luidSchema.describe('The LUID of the workbook to move.'),
  projectId: luidSchema
    .optional()
    .describe(
      'The LUID of the destination project. Use list-projects to discover available project IDs. Do not pass a Personal Space LUID; use personalSpace instead.',
    ),
  personalSpace: z
    .boolean()
    .optional()
    .describe('Set true to move the workbook into your Personal Space instead of a project.'),
};

export type MoveWorkbookResult =
  | { id: string; name?: string; projectId: string }
  | { id: string; name?: string; location: { type: 'PersonalSpace'; id: string } };

export const getMoveWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const moveWorkbookTool = new WebTool({
    server,
    name: 'move-workbook',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Moves a workbook into a different project. Use list-projects to discover available project IDs.\n' +
      'Pass personalSpace: true instead of projectId to move it into your Personal Space.',
    paramsSchema,
    annotations: {
      title: 'Move Workbook',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    disabled: new Provider(async () => !(await getFeatureGate().isFeatureEnabled('data-apps'))),
    callback: async ({ workbookId, projectId, personalSpace }, extra): Promise<CallToolResult> => {
      return await moveWorkbookTool.logAndExecute<MoveWorkbookResult>({
        extra,
        args: { workbookId, projectId, personalSpace },
        callback: async () => {
          const usePersonalSpace = personalSpace === true;
          if ((projectId === undefined) === !usePersonalSpace) {
            return new ArgsValidationError(
              'Provide exactly one of projectId or personalSpace: true to move a workbook.',
            ).toErr();
          }

          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            extra,
          });
          if (!isWorkbookAllowedResult.allowed) {
            return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
          }

          // Like publish-workbook, a Personal Space destination is exempt from the bounded-context
          // project allow-list (intentional asymmetry).
          if (projectId !== undefined) {
            const configWithOverrides = await extra.getConfigWithOverrides();
            assertProjectAllowedByBoundedContext(projectId, configWithOverrides.boundedContext);
          }

          return await useRestApi<Result<MoveWorkbookResult, McpToolError>>({
            ...extra,
            jwtScopes: moveWorkbookTool.requiredApiScopes,
            callback: async (restApi) => {
              if (projectId !== undefined) {
                const workbook = await restApi.workbooksMethods.updateWorkbook({
                  siteId: restApi.siteId,
                  workbookId,
                  projectId,
                });
                return new Ok({
                  id: workbook.id ?? workbookId,
                  name: workbook.name,
                  projectId: workbook.project?.id ?? projectId,
                });
              }

              const resolvedPersonalSpace = await resolvePersonalSpace(restApi, 'move');
              if (resolvedPersonalSpace.isErr()) {
                return resolvedPersonalSpace;
              }
              const personalSpaceLuid = resolvedPersonalSpace.value.luid;

              let workbook: Awaited<ReturnType<typeof restApi.workbooksMethods.updateWorkbook>>;
              try {
                workbook = await restApi.workbooksMethods.updateWorkbook({
                  siteId: restApi.siteId,
                  workbookId,
                  location: personalSpaceLuid,
                });
              } catch (error) {
                const mapped = mapPersonalSpaceSiteDisabledError(error, 'move');
                if (mapped) {
                  return mapped.toErr();
                }
                throw error;
              }

              if (workbook.location?.type !== 'PersonalSpace') {
                const landed = workbook.project?.name ?? workbook.location?.name;
                return new UnknownError(
                  'After the move the workbook is in ' +
                    (landed ? `the "${landed}" project` : 'a project') +
                    ' instead of your personal space — this Tableau site does not support moving ' +
                    'workbooks into a personal space. Pass projectId to move it to a project instead.',
                ).toErr();
              }

              return new Ok({
                id: workbook.id ?? workbookId,
                name: workbook.name,
                location: {
                  type: 'PersonalSpace' as const,
                  id: workbook.location.id ?? personalSpaceLuid,
                },
              });
            },
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
