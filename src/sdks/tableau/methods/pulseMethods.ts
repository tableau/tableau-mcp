import { Zodios } from '@zodios/core';

import { pulseApis } from '../apis/pulseApi.js';
import { Credentials } from '../types/credentials.js';
import { Definition, Metric } from '../types/pulse.js';
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

  listDefinitions = async (): Promise<Array<Definition>> => {
    return (
      await this._apiClient.listDefinitions({
        ...this.authHeader,
      })
    ).definitions;
  };

  listMetricsInDefinition = async (definitionId: string): Promise<Array<Metric>> => {
    return (
      await this._apiClient.listMetricsInDefinition({
        params: { definitionId },
        ...this.authHeader,
      })
    ).metrics;
  };
}
