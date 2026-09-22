import { Ok, Result } from 'ts-results-es';

import { FeatureDisabledError, McpToolError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { GraphQLResponse } from '../../../sdks/tableau/apis/metadataApi.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { TableauApiScope } from '../../../server/oauth/scopes.js';
import { getResultForTableauVersion } from '../../../utils/isTableauVersionAtLeast.js';
import { getVizqlDataServiceDisabledError } from '../getVizqlDataServiceDisabledError.js';
import { ToolRules } from '../tool.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import {
  combineFields,
  FieldsResult,
  simplifyReadMetadataResult,
} from './datasourceMetadataUtils.js';
import { getGraphqlQuery } from './getDatasourceMetadata.js';

function getFetchFieldsResultRules(productVersion: ProductVersion): ToolRules {
  return getResultForTableauVersion({
    productVersion,
    mappings: {
      '2025.3.0': {},
      default: {
        datasourceModelIsUnavailable: true,
      },
    },
  });
}

/**
 * Orchestrates the same VizQL Data Service + Metadata API field-fetch used by the
 * `get-datasource-metadata` tool: reads basic metadata (and, where available for the connected
 * Tableau version, the datasource model) from VizQL Data Service, enriches it with the Tableau
 * Metadata API's GraphQL response when available, and combines the two into a single
 * `FieldsResult`.
 */
export async function fetchFieldsResult({
  datasourceLuid,
  extra,
  productVersion,
  jwtScopes,
}: {
  datasourceLuid: string;
  extra: TableauWebRequestHandlerExtra;
  productVersion: ProductVersion;
  jwtScopes: ReadonlyArray<TableauApiScope>;
}): Promise<Result<FieldsResult, McpToolError>> {
  const rules = getFetchFieldsResultRules(productVersion);
  const query = getGraphqlQuery(datasourceLuid);
  const configWithOverrides = await extra.getConfigWithOverrides();

  return await useRestApi({
    ...extra,
    jwtScopes,
    callback: async (restApi) => {
      // Fetching metadata from VizQL Data Service API.
      const readMetadataResult = await restApi.vizqlDataServiceMethods.readMetadata({
        datasource: {
          datasourceLuid,
        },
      });

      if (readMetadataResult.isErr()) {
        return new FeatureDisabledError(getVizqlDataServiceDisabledError()).toErr();
      }

      // Fetching datasource model from VizQL Data Service API.
      const datasourceModelResult = !rules.datasourceModelIsUnavailable
        ? await restApi.vizqlDataServiceMethods.getDatasourceModel({
            datasource: {
              datasourceLuid,
            },
          })
        : undefined;

      if (datasourceModelResult && datasourceModelResult.isErr()) {
        return new FeatureDisabledError(getVizqlDataServiceDisabledError()).toErr();
      }

      if (configWithOverrides.disableMetadataApiRequests) {
        // Exit early since requests to the Tableau Metadata API are disabled.
        return Ok(
          simplifyReadMetadataResult(readMetadataResult.value, datasourceModelResult?.value),
        );
      }

      let listFieldsResult: GraphQLResponse;

      try {
        // Fetching metadata from Tableau Metadata API.
        // Using try-catch here since requests could fail if the service is not enabled.
        listFieldsResult = await restApi.metadataMethods.graphql(query);
      } catch {
        return Ok(
          simplifyReadMetadataResult(readMetadataResult.value, datasourceModelResult?.value),
        );
      }

      // Combine the results from the VizQL Data Service API and the Tableau Metadata API.
      return Ok(
        combineFields(readMetadataResult.value, listFieldsResult, datasourceModelResult?.value),
      );
    },
  });
}
