import { Err, Ok, Result } from 'ts-results-es';

import {
  AdminInsightsUnavailableError,
  AdminOnlyError,
  FeatureDisabledError,
  McpToolError,
  ZodiosValidationError,
} from '../../../errors/mcpToolError.js';
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
} from './resolver.js';

/**
 * Executes a single VDS query against an Admin Insights dataset using an already-authenticated
 * RestApi instance. Used by tools that issue multiple queries within one auth session.
 *
 * Resolves the dataset name → LUID via {@link adminInsightsResolver} (cached per site).
 * Does NOT run the admin-gate — caller is responsible.
 */
export async function executeAdminInsightsQuery({
  restApi,
  datasetName,
  query,
  rowLimit,
}: {
  restApi: RestApi;
  datasetName: AdminInsightsDataset;
  query: Query;
  rowLimit?: number;
}): Promise<Result<QueryOutput, McpToolError>> {
  let datasourceLuid: string;
  try {
    datasourceLuid = await adminInsightsResolver.resolveDatasetLuid({
      restApi,
      datasetName,
    });
  } catch (error) {
    if (error instanceof AdminInsightsDatasetNotFoundError) {
      return new AdminInsightsUnavailableError(error.message).toErr();
    }
    throw error;
  }

  const datasource: Datasource = { datasourceLuid };
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
    return Err(
      new AdminInsightsUnavailableError(
        `VDS query against Admin Insights "${datasetName}" failed: ${vdsError.message}`,
      ),
    );
  }

  if (rowLimit && result.value.data && result.value.data.length > rowLimit) {
    result.value.data.length = rowLimit;
  }

  return new Ok(result.value);
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
}: {
  extra: TableauWebRequestHandlerExtra;
  jwtScopes: ReadonlyArray<TableauApiScope>;
  datasetName: AdminInsightsDataset;
  query: Query;
  rowLimit?: number;
}): Promise<Result<QueryOutput, McpToolError>> {
  return await useRestApi({
    ...extra,
    jwtScopes,
    callback: async (restApi) => {
      const adminResult = await assertAdmin(restApi, extra);
      if (adminResult.isErr()) {
        return new AdminOnlyError(adminResult.error).toErr();
      }

      return await executeAdminInsightsQuery({ restApi, datasetName, query, rowLimit });
    },
  });
}
