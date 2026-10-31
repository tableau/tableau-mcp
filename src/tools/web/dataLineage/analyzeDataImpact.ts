import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { dataLineageParams } from '../../../sdks/tableau/types/dataLineage.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { analyzeLineageImpact } from './dataImpact.js';
import { executeDataLineage } from './executeDataLineage.js';

const { source, includePrepDetails, maxDepth, maxNodes, maxEdges, maxRequests, pageSize } =
  dataLineageParams;
const paramsSchema = {
  source,
  includePrepDetails,
  maxDepth,
  maxNodes,
  maxEdges,
  maxRequests,
  pageSize,
  change: z
    .enum(['delete', 'rename', 'type-change', 'calculation-change', 'step-change'])
    .describe(
      'The proposed change. This tool predicts dependency exposure and never applies the change.',
    ),
};

export const getAnalyzeDataImpactTool = (
  server: WebMcpServer,
  productVersion: ProductVersion,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'analyze-data-impact',
    minRequiredRole: SiteRole.EXPLORER,
    description:
      'Analyze downstream dependency exposure for a proposed column, calculation, Prep field, step or flow change. Returns the lineage graph and one strongest known evidence path per affected target, classified direct, indirect, possible or unknown. A single transitive rollup remains possible, never direct. Unknown Prep column mappings remain unknown across subsequent steps/outputs. Change labels record intent; this does not execute changes, simulate data values or determine whether a formula will fail. Read resolution, coverage, warnings and limitations before answering. An empty result never establishes that deleting or changing the source is safe.',
    paramsSchema,
    annotations: {
      title: 'Analyze Data Impact',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> =>
      await tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const graph = await executeDataLineage(
            { ...args, direction: 'downstream' },
            extra,
            productVersion,
          );
          return new Ok({ ...graph, change: args.change, impacts: analyzeLineageImpact(graph) });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
