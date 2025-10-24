import { Zodios } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';
import z from 'zod';

import { isAxiosError } from '../../../utils/isAxiosError.js';
import { pulseApis } from '../apis/pulseApi.js';
import { Credentials } from '../types/credentials.js';
import {
  pulseBundleRequestSchema,
  PulseBundleResponse,
  PulseInsightBundleType,
  PulseMetric,
  PulseMetricDefinition,
  PulseMetricDefinitionView,
  PulseMetricSubscription,
} from '../types/pulse.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Pulse methods of the Tableau Server REST API
 *
 * @export
 * @class PulseMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm
 */
export default class PulseMethods extends AuthenticatedMethods<typeof pulseApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, pulseApis), creds);
  }

  /**
   * Returns a list of all published Pulse Metric Definitions.
   *
   * Required scopes: `tableau:insight_definitions_metrics:read`
   *
   * @param view - The view of the definition to return. If not specified, the default view is returned.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_ListDefinitions
   */
  listAllPulseMetricDefinitions = async (
    view?: PulseMetricDefinitionView,
  ): Promise<PulseResult<PulseMetricDefinition[]>> => {
    return await guardAgainstPulseDisabled(async () => {
      const response = await this._apiClient.listAllPulseMetricDefinitions({
        queries: { view },
        ...this.authHeader,
      });
      return response.definitions ?? [];
    });
  };

  /**
   * Returns a list of published Pulse Metric Definitions from a list of metric definition IDs.
   *
   * Required scopes: `tableau:insight_definitions_metrics:read`
   *
   * @param metricDefinitionIds - The list of metric definition IDs to list metrics for.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_BatchGetDefinitionsByPost
   */
  listPulseMetricDefinitionsFromMetricDefinitionIds = async (
    metricDefinitionIds: string[],
    view?: PulseMetricDefinitionView,
  ): Promise<PulseResult<PulseMetricDefinition[]>> => {
    return await guardAgainstPulseDisabled(async () => {
      const response = await this._apiClient.listPulseMetricDefinitionsFromMetricDefinitionIds(
        { definition_ids: metricDefinitionIds },
        { queries: { view }, ...this.authHeader },
      );
      return response.definitions ?? [];
    });
  };

  /**
   * Returns a list of published Pulse Metrics.
   *
   * Required scopes: `tableau:insight_definitions_metrics:read`
   *
   * @param pulseMetricDefinitionID - The ID of the Pulse Metric Definition to list metrics for.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_ListMetrics
   */
  listPulseMetricsFromMetricDefinitionId = async (
    pulseMetricDefinitionID: string,
  ): Promise<PulseResult<PulseMetric[]>> => {
    return await guardAgainstPulseDisabled(async () => {
      const response = await this._apiClient.listPulseMetricsFromMetricDefinitionId({
        params: { pulseMetricDefinitionID },
        ...this.authHeader,
      });
      return response.metrics ?? [];
    });
  };

  /**
   * Returns a list of Pulse Metrics for a list of metric IDs.
   *
   * Required scopes: `tableau:insight_metrics:read`
   *
   * @param metricIds - The list of metric IDs to list metrics for.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_BatchGetMetrics
   */
  listPulseMetricsFromMetricIds = async (
    metricIds: string[],
  ): Promise<PulseResult<PulseMetric[]>> => {
    return await guardAgainstPulseDisabled(async () => {
      const response = await this._apiClient.listPulseMetricsFromMetricIds(
        { metric_ids: metricIds },
        { ...this.authHeader },
      );
      return response.metrics ?? [];
    });
  };

  /**
   * Returns a list of Pulse Metric Subscriptions for the current user.
   *
   * Required scopes: `tableau:metric_subscriptions:read`
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseSubscriptionService_ListSubscriptions
   */
  listPulseMetricSubscriptionsForCurrentUser = async (): Promise<
    PulseResult<PulseMetricSubscription[]>
  > => {
    return await guardAgainstPulseDisabled(async () => {
      const response = await this._apiClient.listPulseMetricSubscriptionsForCurrentUser({
        queries: { user_id: this.userId },
        ...this.authHeader,
      });
      return response.subscriptions ?? [];
    });
  };

  /**
   * Returns the generated bundle of the current aggregate value for the Pulse metric.
   *
   * Required scopes: `tableau:insights:read`
   *
   * @param bundleRequest - The request to generate a bundle for.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleBasic
   */
  generatePulseMetricValueInsightBundle = async (
    bundleRequest: z.infer<typeof pulseBundleRequestSchema>,
    bundleType: PulseInsightBundleType,
  ): Promise<PulseResult<PulseBundleResponse>> => {
    return await guardAgainstPulseDisabled(async () => {
      const response = await this._apiClient.generatePulseMetricValueInsightBundle(
        { bundle_request: bundleRequest.bundle_request },
        { params: { bundle_type: bundleType }, ...this.authHeader },
      );
      return response ?? {};
    });
  };
}

export type PulseDisabledError = 'tableau-server' | 'pulse-disabled';
type PulseResult<T> = Result<T, PulseDisabledError>;
async function guardAgainstPulseDisabled<T>(callback: () => Promise<T>): Promise<PulseResult<T>> {
  try {
    return new Ok(await callback());
  } catch (error) {
    if (isAxiosError(error)) {
      if (error.response?.status === 404) {
        return new Err('tableau-server');
      }

      if (
        error.response?.status === 400 &&
        error.response.headers.tableau_error_code === '0xd3408984' &&
        error.response.headers.validation_code === '400999'
      ) {
        // ntbue-service-chassis/-/blob/main/server/interceptors/site_settings.go
        return new Err('pulse-disabled');
      }
    }

    throw error;
  }
}
