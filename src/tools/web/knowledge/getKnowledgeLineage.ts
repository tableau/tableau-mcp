import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { knowledgePathIdSchema } from './semanticStatementSchemas.js';
import { getTraversalLimit } from './truncateKnowledgeTraversal.js';

const paramsSchema = {
  graphId: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,128}$/)
    .refine((value) => value !== '.' && value !== '..')
    .optional()
    .describe("Knowledge graph ID. Omit to use the site's active (default) graph."),
  nodeId: knowledgePathIdSchema,
};

export const getGetKnowledgeLineageTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'get-knowledge-lineage',
    description: 'Returns dependency lineage for one node in an explicit Tableau Knowledge graph.',
    paramsSchema,
    annotations: {
      title: 'Get Knowledge Lineage',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const limit = getTraversalLimit(
        (await extra.getConfigWithOverrides()).getMaxResultLimit(tool.name),
      );
      return tool.logAndExecute({
        extra,
        args,
        callback: async () =>
          new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: (restApi) => restApi.knowledgeMethods.getKnowledgeLineage(args),
            }),
          ),
        constrainSuccessResult: (result) => ({
          type: 'success',
          result: truncateLineage(result, args.nodeId, limit),
        }),
      });
    },
  });
  return tool;
};

function truncateLineage<
  T extends {
    nodes: Array<{ id: string }>;
    edges: Array<{ source_id: string; target_id: string }>;
  },
>(
  result: T,
  anchorId: string,
  limit: number,
): T & { mcp: { resultInfo: Record<string, number | boolean> } } {
  const nodesById = new Map(result.nodes.map((node) => [node.id, node]));
  const selectedIds: string[] = [];
  const queued = new Set<string>();
  const queue = nodesById.has(anchorId) ? [anchorId] : result.nodes.slice(0, 1).map(({ id }) => id);
  queue.forEach((id) => queued.add(id));

  while (queue.length > 0 && selectedIds.length < limit) {
    const nodeId = queue.shift();
    if (nodeId === undefined) break;
    selectedIds.push(nodeId);
    for (const { source_id, target_id } of result.edges) {
      if (source_id !== nodeId && target_id !== nodeId) continue;
      const neighborId = source_id === nodeId ? target_id : source_id;
      if (nodesById.has(neighborId) && !queued.has(neighborId)) {
        queued.add(neighborId);
        queue.push(neighborId);
      }
    }
  }

  const nodes = selectedIds.map((id) => nodesById.get(id)!);
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const edges = result.edges
    .filter(({ source_id, target_id }) => nodeIds.has(source_id) && nodeIds.has(target_id))
    .slice(0, limit);
  return {
    ...result,
    nodes,
    edges,
    mcp: {
      resultInfo: {
        truncated: nodes.length < result.nodes.length || edges.length < result.edges.length,
        returnedNodeCount: nodes.length,
        originalNodeCount: result.nodes.length,
        returnedEdgeCount: edges.length,
        originalEdgeCount: result.edges.length,
      },
    },
  };
}
