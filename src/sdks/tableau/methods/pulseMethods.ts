import { Zodios } from '@zodios/core';
import z from 'zod';

import { pulseApis } from '../apis/pulseApi.js';
import { Credentials } from '../types/credentials.js';
import {
  pulseBundleRequestSchema,
  pulseBundleResponseSchema,
  pulseBriefRequestSchema,
  pulseBriefResponseSchema,
  PulseBriefRequest,
  PulseBriefResponse,
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
  ): Promise<PulseMetricDefinition[]> => {
    const response = await this._apiClient.listAllPulseMetricDefinitions({
      queries: { view },
      ...this.authHeader,
    });
    return response.definitions ?? [];
  };

  /**
   * Returns a list of published Pulse Metric Definitions from a list of metric definition IDs.
   *
   * Required scopes: `tableau:insight_definitions_metrics:read`
   *
   * @param metricDefinitionIds - The list of metric definition IDs to list metrics for.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_BatchGetDefinitions
   */
  listPulseMetricDefinitionsFromMetricDefinitionIds = async (
    metricDefinitionIds: string[],
    view?: PulseMetricDefinitionView,
  ): Promise<PulseMetricDefinition[]> => {
    const response = await this._apiClient.listPulseMetricDefinitionsFromMetricDefinitionIds(
      { definition_ids: metricDefinitionIds },
      { queries: { view }, ...this.authHeader },
    );
    return response.definitions ?? [];
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
  ): Promise<PulseMetric[]> => {
    const response = await this._apiClient.listPulseMetricsFromMetricDefinitionId({
      params: { pulseMetricDefinitionID },
      ...this.authHeader,
    });
    return response.metrics ?? [];
  };

  /**
   * Returns a list of Pulse Metrics for a list of metric IDs.
   *
   * Required scopes: `tableau:insight_metrics:read`
   *
   * @param metricIds - The list of metric IDs to list metrics for.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_BatchGetMetrics
   */
  listPulseMetricsFromMetricIds = async (metricIds: string[]): Promise<PulseMetric[]> => {
    const response = await this._apiClient.listPulseMetricsFromMetricIds(
      { metric_ids: metricIds },
      { ...this.authHeader },
    );
    return response.metrics ?? [];
  };

  /**
   * Returns a list of Pulse Metric Subscriptions for the current user.
   *
   * Required scopes: `tableau:metric_subscriptions:read`
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseSubscriptionService_ListSubscriptions
   */
  listPulseMetricSubscriptionsForCurrentUser = async (): Promise<PulseMetricSubscription[]> => {
    const response = await this._apiClient.listPulseMetricSubscriptionsForCurrentUser({
      queries: { user_id: this.userId },
      ...this.authHeader,
    });
    return response.subscriptions ?? [];
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
  ): Promise<z.infer<typeof pulseBundleResponseSchema>> => {
    const response = await this._apiClient.generatePulseMetricValueInsightBundle(
      { bundle_request: bundleRequest.bundle_request },
      { params: { bundle_type: bundleType }, ...this.authHeader },
    );
    return response ?? {};
  };

  /**
   * Generates a conversational insight brief for Pulse metrics using natural language questions.
   *
   * Required scopes: TBD (will be determined based on auth requirements)
   *
   * @param briefRequest - The request containing messages and metric context.
   */
  generatePulseInsightBrief = async (
    briefRequest: PulseBriefRequest,
  ): Promise<PulseBriefResponse> => {
    const response = await this._apiClient.generatePulseInsightBrief(
      briefRequest,
      {
        ...this.authHeader,
        headers: {
          ...this.authHeader.headers,
          'Content-Type': 'application/vnd.tableau.pulse.embeddingsservice.v1.GenerateInsightBriefRequest+json',
        },
      },
    );
    return response;
  };
}
