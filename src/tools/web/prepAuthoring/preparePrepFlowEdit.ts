import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { prepAuthoringEnabled } from './engineClient.js';
import { prepareParams, preparePrepEdit } from './workflow.js';

export const getPreparePrepFlowEditTool = (server: WebMcpServer): WebTool<typeof prepareParams> => {
  const tool = new WebTool({
    server,
    name: 'prepare-prep-flow-edit',
    minRequiredRole: SiteRole.EXPLORER,
    description:
      'Prepare compact YAML for native Tableau Prep authoring in opt-in self-hosted stdio. Create starter YAML without an existing file, read a local TFL/TFLX within the operator workspace, or download an authorized published flow. Uses the migrated schema-driven compiler: short !id references preserve/generate UUIDs, !include retains large value lists and metadata in project resources, and attachments remain outside the agent context. Returns YAML plus a session-bound source handle. Provider-specific database settings, custom SQL and inline credentials are excluded. No flow or expression is executed and nothing is published. Use generate-prep-flow to preview edited YAML and validate serialized native output before releasing a new file.',
    paramsSchema: prepareParams,
    annotations: {
      title: 'Prepare Prep Flow YAML',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    disabled: new Provider(() => !prepAuthoringEnabled(getConfig())),
    callback: async (args, extra): Promise<CallToolResult> =>
      await tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          try {
            return new Ok(await preparePrepEdit(args, extra));
          } catch (error) {
            if (error instanceof McpToolError) return error.toErr();
            throw error;
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
