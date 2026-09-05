import { Err, Ok, Result } from 'ts-results-es';

import {
  AdminInsightsUnavailableError,
  AdminOnlyError,
  FeatureDisabledError,
  McpToolError,
  ZodiosValidationError,
} from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  Datasource,
  Query,
  type QueryOutput,
  QueryRequest,
} from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';

export type { QueryOutput };
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { TableauApiScope } from '../../../server/oauth/scopes.js';
import { assertAdmin } from '../adminGate.js';
import { getVizqlDataServiceDisabledError } from '../getVizqlDataServiceDisabledError.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import {
  AdminInsightsDataset,
  AdminInsightsDatasetNotFoundError,
  adminInsightsResolver,
  AdminInsightsResolverWarning,
  ResolverCandidate,
} from './resolver.js';

// Feature flag name for the robust (detect-then-disambiguate) resolver + health-check fallback
// (W-24106279). Default-on in features.json; when off, the resolver reverts to the legacy
// single-filter behavior and no health fallback runs.
export const ADMIN_INSIGHTS_ROBUST_RESOLVER_FLAG = 'admin-insights-robust-resolver';

// Result of a raw Admin Insights VDS query, extended with resolver diagnostics. Warnings are
// attached only when resolution was ambiguous or a dead-extract fallback occurred.
export type AdminInsightsQueryResult = QueryOutput & {
  mcp?: { warnings: AdminInsightsResolverWarning[] };
};

/**
 * Detects the specific Hyper connection failure that a dead Admin Insights extract produces, so the
 * fallback retries the next-ranked candidate. Deliberately narrow: only connection/extract failures
 * trigger fallback — auth, feature-disabled, and validation errors are surfaced as-is.
 */
export function isHyperConnectionError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('sqlstate:08001') ||
    m.includes('sqlstate: 08001') ||
    m.includes('could not connect to the hyper server') ||
    m.includes('0x9ee5c2f0')
  );
}

function buildUnhealthyWarning(
  datasetName: string,
  deadLuid: string,
  nextLuid: string,
): AdminInsightsResolverWarning {
  return {
    type: 'ADMIN_INSIGHTS_DATASOURCE_UNHEALTHY',
    severity: 'WARNING',
    message:
      `Admin Insights datasource ${deadLuid} for "${datasetName}" has a dead extract (Hyper ` +
      `connection error); falling back to the next candidate ${nextLuid}. Delete or refresh the ` +
      'broken duplicate to remove this fallback.',
    datasetName,
    chosenLuid: nextLuid,
    chosenReason: 'health-fallback',
    candidates: [{ luid: deadLuid, chosen: false }],
  };
}

function unavailableError(
  datasetName: string,
  triedLuids: string[],
  lastMessage: string,
): AdminInsightsUnavailableError {
  return new AdminInsightsUnavailableError(
    `VDS query against Admin Insights "${datasetName}" failed: no candidate datasource had a ` +
      `working extract (tried ${triedLuids.join(', ') || 'none'}). Last error: ${lastMessage}`,
  );
}

/**
 * Executes a single VDS query against an Admin Insights dataset using an already-authenticated
 * RestApi instance. Used by tools that issue multiple queries within one auth session.
 *
 * Resolves the dataset name → LUID via {@link adminInsightsResolver} (cached per site) and, when
 * the robust resolver is enabled, retries the next-ranked candidate if the chosen datasource has a
 * dead Hyper extract (W-24106279). Does NOT run the admin-gate — caller is responsible.
 */
export async function executeAdminInsightsQuery({
  restApi,
  datasetName,
  query,
  rowLimit,
  robustResolverEnabled = true,
  datasetLuidOverride,
}: {
  restApi: RestApi;
  datasetName: AdminInsightsDataset;
  query: Query;
  rowLimit?: number;
  robustResolverEnabled?: boolean;
  datasetLuidOverride?: string;
}): Promise<Result<AdminInsightsQueryResult, McpToolError>> {
  const warnings: AdminInsightsResolverWarning[] = [];
  const triedLuids: string[] = [];
  let lastErrorMessage = '';
  let ambiguityWarningCaptured = false;

  // Bounded loop: each iteration marks the dead LUID and re-resolves, so it converges on a healthy
  // candidate or exhausts them. The triedLuids guard prevents an infinite loop if resolve keeps
  // returning the same LUID.
  const MAX_FALLBACK_ATTEMPTS = 6;
  for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
    let luid: string;
    let candidates: ResolverCandidate[];
    try {
      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName,
        overrideLuid: datasetLuidOverride,
        robustResolverEnabled,
      });
      luid = resolution.luid;
      candidates = resolution.candidates;
      if (!ambiguityWarningCaptured && resolution.warnings.length > 0) {
        warnings.push(...resolution.warnings);
        ambiguityWarningCaptured = true;
      }
    } catch (error) {
      if (error instanceof AdminInsightsDatasetNotFoundError) {
        return new AdminInsightsUnavailableError(error.message).toErr();
      }
      throw error;
    }

    if (triedLuids.includes(luid)) {
      // No further progress possible — every resolvable candidate is dead.
      return unavailableError(datasetName, triedLuids, lastErrorMessage).toErr();
    }
    triedLuids.push(luid);

    const datasource: Datasource = { datasourceLuid: luid };
    const queryRequest: QueryRequest = {
      datasource,
      query,
      options: {
        returnFormat: 'OBJECTS',
        debug: false,
        disaggregate: false,
        ...(rowLimit ? { rowLimit } : {}),
      },
    };

    const result = await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
    if (result.isErr()) {
      const vdsError = result.error;
      if (vdsError.type === 'feature-disabled') {
        return new FeatureDisabledError(getVizqlDataServiceDisabledError()).toErr();
      }
      if (vdsError.type === 'zodios-error') {
        return new ZodiosValidationError(vdsError.error).toErr();
      }

      lastErrorMessage = vdsError.message;

      // Only a Hyper connection/extract failure triggers fallback, and only when the robust
      // resolver is enabled. Any other api-error is surfaced as-is (never retried).
      const nextCandidate = candidates.find((c) => c.luid !== luid);
      if (
        robustResolverEnabled &&
        !datasetLuidOverride &&
        isHyperConnectionError(vdsError.message)
      ) {
        adminInsightsResolver.markDatasetLuidDead({ siteId: restApi.siteId, datasetName, luid });
        if (nextCandidate) {
          warnings.push(buildUnhealthyWarning(datasetName, luid, nextCandidate.luid));
        }
        continue;
      }

      return Err(
        new AdminInsightsUnavailableError(
          `VDS query against Admin Insights "${datasetName}" failed: ${vdsError.message}`,
        ),
      );
    }

    if (rowLimit && result.value.data && result.value.data.length > rowLimit) {
      result.value.data.length = rowLimit;
    }

    const output: AdminInsightsQueryResult = { ...result.value };
    if (warnings.length > 0) {
      output.mcp = { warnings };
    }
    return new Ok(output);
  }

  return unavailableError(datasetName, triedLuids, lastErrorMessage).toErr();
}

/**
 * Runs a VDS query against an Admin Insights dataset.
 *
 * Admin Insights datasources have known internal LUIDs and are admin-only — so this path
 * intentionally bypasses {@link import('../resourceAccessChecker.js').resourceAccessChecker}.
 * The caller is gated by {@link adminGate.assertAdmin} which verifies site role at request time.
 */
export async function runAdminInsightsQuery({
  extra,
  jwtScopes,
  datasetName,
  query,
  rowLimit,
  datasetLuidOverride,
}: {
  extra: TableauWebRequestHandlerExtra;
  jwtScopes: ReadonlyArray<TableauApiScope>;
  datasetName: AdminInsightsDataset;
  query: Query;
  rowLimit?: number;
  datasetLuidOverride?: string;
}): Promise<Result<AdminInsightsQueryResult, McpToolError>> {
  const robustResolverEnabled = await getFeatureGate().isFeatureEnabled(
    ADMIN_INSIGHTS_ROBUST_RESOLVER_FLAG,
  );
  return await useRestApi({
    ...extra,
    jwtScopes,
    callback: async (restApi) => {
      const adminResult = await assertAdmin(restApi, extra);
      if (adminResult.isErr()) {
        return new AdminOnlyError(adminResult.error).toErr();
      }

      return await executeAdminInsightsQuery({
        restApi,
        datasetName,
        query,
        rowLimit,
        robustResolverEnabled,
        datasetLuidOverride,
      });
    },
  });
}
