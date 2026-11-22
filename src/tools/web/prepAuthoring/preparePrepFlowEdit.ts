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
      'Create starter YAML, prepare a local TFL/TFLX from the configured workspace, or download an authorized published Prep flow. Compact YAML uses !id for identities, !include for unchanged values/metadata and !path for allowed resources; attachments stay outside the edit context. Returns YAML and a session-bound source handle. Edit the YAML, then use generate-prep-flow to preview and release a validated new file. Provider-specific database settings, custom SQL and inline credentials are excluded. Opt-in self-hosted stdio only; no publishing or flow/expression execution.',
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
