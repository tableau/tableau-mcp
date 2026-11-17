import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { prepAuthoringEnabled } from './engineClient.js';
import { generateParams, generatePrepFlow } from './workflow.js';

export const getGeneratePrepFlowTool = (server: WebMcpServer): WebTool<typeof generateParams> => {
  const tool = new WebTool({
    server,
    name: 'generate-prep-flow',
    minRequiredRole: SiteRole.EXPLORER,
    description:
      'Preview edited compact Prep YAML, then generate a new local TFL/TFLX. Use only declarative !id/!include/!path project references. Preview checks schema/types, graph/resources and the 20 native canvas colors with matching RGBA. Missing or unsupported colors block release; use the returned canvasPalette to correct them. Generate requires the successful preview SHA256, identical YAML/format and unchanged source/resources, and writes exactly the reviewed bytes without overwriting originals. Read target-specific compatibility notices after validation. Static validity does not establish native execution or publish readiness. Opt-in stdio only; no publishing or flow, script, expression or database execution.',
    paramsSchema: generateParams,
    annotations: {
      title: 'Generate Prep Flow',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    disabled: new Provider(() => !prepAuthoringEnabled(getConfig())),
    callback: async (args, extra): Promise<CallToolResult> =>
      await tool.logAndExecute({
        extra,
        args: { ...args, yaml: '[omitted from invocation logs]' },
        callback: async () => {
          try {
            return new Ok(await generatePrepFlow(args, extra));
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
