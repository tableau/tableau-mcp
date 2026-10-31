import { getConfig } from '../../../config.js';
import { isFlowReadToolsEnabled } from '../../../features/flowTools.js';
import { useRestApi } from '../../../restApiInstance.js';
import { DataLineageTraversal } from '../../../sdks/tableau/methods/dataLineage.js';
import { DataLineageResult, LineageOptions } from '../../../sdks/tableau/types/dataLineage.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { DATA_LINEAGE_API_SCOPES, DESCRIBE_FLOW_API_SCOPES } from '../../../server/oauth/scopes.js';
import { isAxiosError } from '../../../utils/axios.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';
import { getResultForTableauVersion } from '../../../utils/isTableauVersionAtLeast.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { lineageAccess } from './lineageAccess.js';
import { addPrepTopology } from './prepLineage.js';

/** Share one Metadata session, but mint download scopes only for an explicitly
 * requested optional document. Metadata-only calls need no download grant. */
export async function executeDataLineage(
  options: LineageOptions,
  extra: TableauWebRequestHandlerExtra,
  productVersion: ProductVersion,
): Promise<DataLineageResult> {
  const overrides = await extra.getConfigWithOverrides();
  const prepEnabled = await isFlowReadToolsEnabled(getConfig());
  const internalSource =
    options.source.type === 'prep-step' || options.source.type === 'prep-field'
      ? options.source
      : undefined;
  const source = internalSource
    ? { type: 'flow' as const, luid: internalSource.flowLuid }
    : options.source;
  const effective = { ...options, source };
  const isAllowed = lineageAccess(extra, overrides.boundedContext);
  // Build the empty response even for disabled/unavailable services, so it can
  // never be mistaken for a successful zero-impact result.
  const unavailable = new DataLineageTraversal(effective, {
    graphql: async () => undefined,
    isAllowed,
    prepEnabled,
  });
  if (overrides.disableMetadataApiRequests) {
    unavailable.result.resolution = 'unavailable';
    unavailable.result.coverage.metadata = 'unavailable';
    unavailable.warn(
      'METADATA_DISABLED',
      'Metadata API requests are disabled by configuration. Dependency analysis is unavailable.',
    );
    return unavailable.result;
  }
  if (!prepEnabled && source.type.startsWith('flow')) {
    unavailable.result.resolution = 'not-allowed';
    unavailable.warn(
      'PREP_DISABLED',
      'Prep read tools are disabled. No Prep metadata or documents were requested.',
    );
    return unavailable.result;
  }
  return await useRestApi({
    ...extra,
    jwtScopes: DATA_LINEAGE_API_SCOPES.filter(
      (scope) => prepEnabled || scope !== 'tableau:flows:read',
    ),
    callback: async (restApi) => {
      const traversal = new DataLineageTraversal(effective, {
        graphql: (query) => restApi.metadataMethods.graphql(query),
        isAllowed,
        prepEnabled,
        signal: extra.signal,
      });
      if (!prepEnabled)
        traversal.warn(
          'PREP_DISABLED',
          'Prep read tools are disabled; the graph excludes Prep assets.',
        );
      extra.signal.throwIfAborted();
      await traversal.resolve();
      await traversal.expand();
      const graph = traversal.result;
      if (graph.resolution !== 'resolved') return graph;
      if (options.includePrepDetails || internalSource) {
        graph.coverage.prep = 'unavailable';
        const supported = getResultForTableauVersion({
          productVersion,
          mappings: { '2026.3.0': true, default: false },
        });
        if (!supported || !prepEnabled) {
          traversal.warn(
            'PREP_DOCUMENT_UNAVAILABLE',
            'Prep internals require enabled Prep reads, a supported 2026.3+ deployment and availability of the experimental Flow Document API.',
          );
          if (internalSource) {
            graph.resolution = 'unavailable';
            graph.sourceId = undefined;
          }
          return graph;
        }
        const flows = graph.nodes.filter((n) => n.kind === 'flow' && n.luid);
        for (const flow of flows) {
          extra.signal.throwIfAborted();
          if (!flow.luid) continue;
          // Recheck immediately before downloading a native flow package. This also
          // prevents a terminal/rollup target from bypassing flow boundaries.
          if (!(await resourceAccessChecker.isFlowAllowed({ flowId: flow.luid, extra })).allowed) {
            traversal.warn(
              'PREP_DOCUMENT_FILTERED',
              'A flow document was excluded by the current resource boundary.',
            );
            continue;
          }
          if (!traversal.reserveRequest()) break;
          try {
            const document = await useRestApi({
              ...extra,
              jwtScopes: DESCRIBE_FLOW_API_SCOPES,
              callback: (api) =>
                api.flowDocumentMethods.getFlowDocument({ siteId: api.siteId, flowId: flow.luid! }),
            });
            addPrepTopology(traversal, flow, document, options.source);
          } catch (error) {
            extra.signal.throwIfAborted();
            // Never expose raw responses or document fragments. Generic403
            // does not establish that the deployment flag is disabled.
            const status = error instanceof Error ? getHttpStatus(error) : '';
            const disabled =
              status === '403' &&
              isAxiosError(error) &&
              (String(error.response?.data?.error?.code ?? '') === '403201' ||
                String(error.response?.headers?.tableau_error_code ?? '') === '403201');
            traversal.warn(
              disabled ? 'PREP_DOCUMENT_DISABLED' : 'PREP_DOCUMENT_UNAVAILABLE',
              disabled
                ? 'The experimental Flow Document API is disabled (403201). It requires features.getFlowDocumentRestApi. On self-managed Server an administrator must enable the flag and apply pending changes. Catalog lineage is retained.'
                : `The optional Flow Document API was unavailable${status ? ` (HTTP ${status})` : ''}. Verify download permission, scope and endpoint availability. Missing internals are unknown.`,
              flow.id,
            );
          }
        }
        if (internalSource && !graph.sourceId?.startsWith('prep')) {
          graph.resolution = 'unavailable';
          graph.sourceId = undefined;
        }
      }
      return graph;
    },
  });
}
