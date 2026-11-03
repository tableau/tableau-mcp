import { getConfig } from '../../../config.js';
import { isFlowReadToolsEnabled } from '../../../features/flowTools.js';
import { useRestApi } from '../../../restApiInstance.js';
import { DataLineageTraversal } from '../../../sdks/tableau/methods/dataLineage.js';
import { parseFlowPackage } from '../../../sdks/tableau/methods/flowPackage.js';
import {
  matchPrepScriptContext,
  packagedScriptReferences,
} from '../../../sdks/tableau/methods/prepScriptBindings.js';
import { DataLineageResult, LineageOptions } from '../../../sdks/tableau/types/dataLineage.js';
import { PrepScriptContext } from '../../../sdks/tableau/types/prepScript.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import {
  DATA_LINEAGE_API_SCOPES,
  DESCRIBE_FLOW_API_SCOPES,
  PULSE_LINEAGE_API_SCOPES,
} from '../../../server/oauth/scopes.js';
import { isAxiosError } from '../../../utils/axios.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';
import { getResultForTableauVersion } from '../../../utils/isTableauVersionAtLeast.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { lineageAccess } from './lineageAccess.js';
import { executeLocalDataLineage } from './localDataLineage.js';
import { addPrepTopology } from './prepLineage.js';
import { PulseLineageCollector } from './pulseLineage.js';

/** Share one Metadata session, but mint download scopes only for an explicitly
 * requested optional document. Metadata-only calls need no download grant. */
export async function executeDataLineage(
  options: LineageOptions,
  extra: TableauWebRequestHandlerExtra,
  productVersion: ProductVersion,
): Promise<DataLineageResult> {
  if (options.source.type === 'local-flow') {
    const result = await executeLocalDataLineage(options, getConfig(), extra.signal);
    if (options.includePulseDetails) {
      result.coverage.pulse = 'not-requested';
      result.warnings.push({
        code: 'PULSE_LOCAL_UNBOUND',
        message:
          'Local files do not establish a published datasource/Pulse identity. Select a verified published origin for Pulse usage.',
      });
    }
    return result;
  }
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
  const pulseSource = source.type === 'pulse-definition' || source.type === 'pulse-metric';
  const wantPulse = !!options.includePulseDetails || pulseSource;
  const wantPrep =
    options.includePrepDetails || internalSource || !!options.observedPrepSchemas?.length;
  const isAllowed = lineageAccess(extra, overrides.boundedContext);
  // Build the empty response even for disabled/unavailable services, so it can
  // never be mistaken for a successful zero-impact result.
  const unavailable = new DataLineageTraversal(effective, {
    graphql: async () => undefined,
    isAllowed,
    prepEnabled,
  });
  if (overrides.disableMetadataApiRequests && !pulseSource) {
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
    jwtScopes: (overrides.disableMetadataApiRequests
      ? PULSE_LINEAGE_API_SCOPES
      : DATA_LINEAGE_API_SCOPES
    ).filter((scope) => prepEnabled || scope !== 'tableau:flows:read'),
    callback: async (restApi) => {
      const traversal = new DataLineageTraversal(effective, {
        graphql: (query) => restApi.metadataMethods.graphql(query),
        isAllowed,
        prepEnabled,
        signal: extra.signal,
      });
      const withPulse = async (
        callback: (collector: PulseLineageCollector) => Promise<void>,
      ): Promise<void> => {
        try {
          await useRestApi({
            ...extra,
            jwtScopes: PULSE_LINEAGE_API_SCOPES,
            callback: async (api) => {
              const collector = new PulseLineageCollector(traversal, {
                read: async (request) => {
                  const result = await api.pulseMethods.readPulseLineage(request, extra.signal);
                  if (result.isErr()) throw new Error('Pulse metadata unavailable.');
                  return result.value;
                },
                metadataEnabled: !overrides.disableMetadataApiRequests,
                isDatasourceAllowed: async (datasourceLuid) =>
                  (await resourceAccessChecker.isDatasourceAllowed({ datasourceLuid, extra }))
                    .allowed,
                signal: extra.signal,
              });
              await callback(collector);
            },
          });
        } catch {
          extra.signal.throwIfAborted();
          traversal.result.coverage.pulse = 'unavailable';
          traversal.warn(
            'PULSE_UNAVAILABLE',
            'Pulse metadata could not be read with the current service/permission/scope; existing catalog lineage is retained.',
          );
          if (pulseSource) {
            traversal.result.resolution = 'unavailable';
            traversal.result.sourceId = undefined;
          }
        }
      };
      if (!prepEnabled)
        traversal.warn(
          'PREP_DISABLED',
          'Prep read tools are disabled; the graph excludes Prep assets.',
        );
      extra.signal.throwIfAborted();
      const supported = getResultForTableauVersion({
        productVersion,
        mappings: { '2026.3.0': true, default: false },
      });
      if (pulseSource) {
        if (overrides.disableMetadataApiRequests)
          traversal.warn(
            'METADATA_DISABLED',
            'Catalog field bindings are unavailable; Pulse configuration alone does not prove upstream field dependencies.',
          );
        await withPulse((collector) => collector.resolveSource());
      } else await traversal.resolve();
      const reserveDocument = wantPrep && supported && prepEnabled;
      await traversal.expand(reserveDocument ? 1 : 0);
      const graph = traversal.result;
      if (graph.resolution !== 'resolved') return graph;
      if (wantPrep) {
        graph.coverage.prep = 'unavailable';
        if (!supported || !prepEnabled) {
          traversal.warn(
            'PREP_DOCUMENT_UNAVAILABLE',
            'Prep internals require enabled Prep reads, a supported 2026.3+ deployment and availability of the experimental Flow Document API.',
          );
          if (internalSource) {
            graph.resolution = 'unavailable';
            graph.sourceId = undefined;
          }
          if (wantPulse && !pulseSource) await withPulse((collector) => collector.enrich());
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
            let scriptContext: PrepScriptContext | undefined;
            if (packagedScriptReferences(document).length) {
              // Download only a permitted owning Flow, within the same explicit
              // detail scope and request budget. Native paths never become URLs.
              if (traversal.reserveRequest()) {
                try {
                  if (
                    !(await resourceAccessChecker.isFlowAllowed({ flowId: flow.luid, extra }))
                      .allowed
                  )
                    throw new Error('Flow package excluded.');
                  const content = await useRestApi({
                    ...extra,
                    jwtScopes: DESCRIBE_FLOW_API_SCOPES,
                    callback: (api) =>
                      api.flowsMethods.downloadFlowContent({
                        siteId: api.siteId,
                        flowId: flow.luid!,
                        signal: extra.signal,
                      }),
                  });
                  extra.signal.throwIfAborted();
                  const native = parseFlowPackage(content);
                  scriptContext = matchPrepScriptContext(
                    document,
                    native.document,
                    native.scriptContext ?? { scripts: {} },
                  );
                } catch {
                  extra.signal.throwIfAborted();
                  traversal.warn(
                    'PREP_SCRIPT_PACKAGE_UNAVAILABLE',
                    'Attached script metadata was unavailable within the Flow download permission, package format or byte limits. External paths and script/model services are never opened.',
                    flow.id,
                  );
                }
              }
            }
            addPrepTopology(
              traversal,
              flow,
              document,
              options.source,
              options.observedPrepSchemas,
              scriptContext,
            );
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
      if (wantPulse && !pulseSource) await withPulse((collector) => collector.enrich());
      return graph;
    },
  });
}
