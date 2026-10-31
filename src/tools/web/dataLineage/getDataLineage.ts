import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { dataLineageParams } from '../../../sdks/tableau/types/dataLineage.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { executeDataLineage } from './executeDataLineage.js';

export const getGetDataLineageTool = (
  server: WebMcpServer,
  productVersion: ProductVersion,
): WebTool<typeof dataLineageParams> => {
  const tool = new WebTool({
    server,
    name: 'get-data-lineage',
    minRequiredRole: SiteRole.EXPLORER,
    description:
      'Trace upstream or downstream data dependencies across database columns, Tableau fields, Prep inputs/outputs, data sources, calculations, worksheets and dashboards. Supply an opaque Metadata API ID, a flow/data-source REST LUID, or an exact column name plus table (and database/schema when needed). Self-hosted stdio can also analyze local TFL/TFLX files inside operator-configured LOCAL_FLOW_ROOTS, optionally from an exact step/output field; local files make no Tableau calls and do not identify published downstream content. Returns nodes, evidence-labelled edges, provenance, coverage and warnings. Direct references are distinguished from transitive catalog rollups (possible). Container membership does not propagate to unrelated assets. Optional sanitized Prep documents statically trace supported saved field operations and namespaces, including nested containers, calculations, filters, joins, aggregates, renames, unions and pivots. Dynamic schemas, unknown versions and catalog-column identity bindings remain gaps; equal names across API namespaces are never joined. Unsupported API JSON formats are rejected without guessing a package wrapper. Optional documents require a supported 2026.3+ deployment, Flow Document API availability and download permission (Server: features.getFlowDocumentRestApi); catalog lineage remains available without that endpoint. Prep step/field origins read their document automatically. Never interpret an empty, partial or bounded graph as proof that a change is safe. External columns are excluded when a resource bounded context is configured because they cannot be safely scoped to projects/tags/content.',
    paramsSchema: dataLineageParams,
    annotations: {
      title: 'Get Data Lineage',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> =>
      await tool.logAndExecute({
        extra,
        args,
        callback: async () => new Ok(await executeDataLineage(args, extra, productVersion)),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
