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
      'Validate compact Prep YAML and generate a new native TFL/TFLX using the migrated typed/schema-driven compiler. Preview resolves only declarative !id/!include/!path project references, verifies schema/types/graph/resources and the 20 native canvas palette colors with matching RGBA, serializes the native archive and checks metadata round-trip plus CRC. Missing or unsupported canvas colors block release; prepare and failed color previews return canvasPalette for correction without rewriting the source. Generate requires the successful preview SHA256 for the same YAML/format and unchanged source/resources, then releases those exact bytes to a new local file without overwriting originals. Read target-specific Python/R, input-union and Cloud file-refresh notices after validation. Static validity does not establish native execution or publish readiness. Opt-in stdio only; no publish, flow run, script, expression or database execution occurs.',
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
