import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import { FlowNotAllowedError, McpToolError } from '../../../errors/mcpToolError.js';
import { isFlowWriteToolsEnabled } from '../../../features/flowTools.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { Flow } from '../../../sdks/tableau/types/flow.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { assertProjectAllowedByBoundedContext } from '../utils/boundedContextUtils.js';

const paramsSchema = {
  flowId: luidSchema.describe('The LUID of the Prep flow to move.'),
  projectId: luidSchema.describe('The destination project LUID from list-projects.'),
};
export type MoveFlowResult = { status: 'moved' | 'unchanged'; flow: Flow };

/** Moves only the requested project reference; no owner, content or output changes are sent. */
export const getMoveFlowTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'move-flow',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Moves a published Prep flow to an explicit project without changing its owner or content. Use list-projects to find destination IDs. Moving can change inherited permissions. Requires ownership/project leadership or administrator rights and Write permission for the destination. A flow already in the destination is left unchanged.',
    paramsSchema,
    disabled: new Provider(async () => !(await isFlowWriteToolsEnabled(getConfig()))),
    annotations: {
      title: 'Move Flow',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    callback: async ({ flowId, projectId }, extra): Promise<CallToolResult> =>
      await tool.logAndExecute<MoveFlowResult>({
        extra,
        args: { flowId, projectId },
        callback: async () => {
          const allowed = await resourceAccessChecker.isFlowAllowed({ flowId, extra });
          if (!allowed.allowed) return new FlowNotAllowedError(allowed.message).toErr();
          const config = await extra.getConfigWithOverrides();
          assertProjectAllowedByBoundedContext(projectId, config.boundedContext);
          return await useRestApi<Result<MoveFlowResult, McpToolError>>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const current = await restApi.flowsMethods.queryFlow({
                siteId: restApi.siteId,
                flowId,
              });
              if (current.flow.id.toLowerCase() !== flowId.toLowerCase())
                return new McpToolError({
                  type: 'flow-move-target-mismatch',
                  statusCode: 502,
                  message:
                    'Tableau returned a different flow during preflight; no move was attempted.',
                }).toErr();
              if (current.flow.project?.id.toLowerCase() === projectId.toLowerCase())
                return new Ok({ status: 'unchanged', flow: current.flow });
              const flow = await restApi.flowsMethods.updateFlow({
                siteId: restApi.siteId,
                flowId,
                projectId,
              });
              if (
                flow.id.toLowerCase() !== flowId.toLowerCase() ||
                flow.project?.id.toLowerCase() !== projectId.toLowerCase()
              )
                return new McpToolError({
                  type: 'flow-move-unverified',
                  statusCode: 502,
                  message:
                    'Tableau did not confirm the requested destination after the move. The write may have succeeded; inspect the flow before retrying.',
                }).toErr();
              return new Ok({ status: 'moved', flow });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
