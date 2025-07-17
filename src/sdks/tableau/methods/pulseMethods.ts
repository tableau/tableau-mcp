import { Zodios } from '@zodios/core';
import z from 'zod';

import { pulseApis } from '../apis/pulseApi.js';
import { Credentials } from '../types/credentials.js';
import {
  pulseBundleRequestSchema,
  pulseBundleResponseSchema,
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
   * @param view - The view of the definition to return. If not specified, the default view is returned.
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
   * @param metricDefinitionIds - The list of metric definition IDs to list metrics for.
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
   * @param pulseMetricDefinitionID - The ID of the Pulse Metric Definition to list metrics for.
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
   * @param metricIds - The list of metric IDs to list metrics for.
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
   * @param bundleRequest - The request to generate a bundle for.
   */
  generatePulseMetricBundle = async (
    bundleRequest: z.infer<typeof pulseBundleRequestSchema>,
  ): Promise<z.infer<typeof pulseBundleResponseSchema>> => {
    const response = await this._apiClient.generatePulseMetricBundle(bundleRequest);
    return response ?? {};
  };
}
