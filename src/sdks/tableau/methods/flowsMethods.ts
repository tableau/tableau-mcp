import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { flowsApis } from '../apis/flowsApi.js';
import { RestApiCredentials } from '../restApi.js';
import { Flow, FlowConnection, FlowOutputStep, FlowRun } from '../types/flow.js';
import { Pagination } from '../types/pagination.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Flows methods of the Tableau Server REST API
 *
 * @export
 * @class FlowsMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm
 */
export default class FlowsMethods extends AuthenticatedMethods<typeof flowsApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, flowsApis, { axiosConfig }), creds);
  }

  /**
   * Returns the flows on a site.
   *
   * Required scopes: `tableau:flows:read`
   *
   * @param siteId - The Tableau site ID
   * @param filter - Optional filter string in the format field:operator:value
   * @param sort - Optional sort expression (e.g. createdAt:desc)
   * @param pageSize - Items per page (1-1000, default 100)
   * @param pageNumber - Offset for paging (default 1)
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flows_for_site
   */
  queryFlowsForSite = async ({
    siteId,
    filter,
    sort,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    filter: string;
    sort?: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<{ pagination: Pagination; flows: Flow[] }> => {
    const response = await this._apiClient.queryFlowsForSite({
      params: { siteId },
      queries: { filter, sort, pageSize, pageNumber },
      ...this.authHeader,
    });
    return {
      pagination: response.pagination,
      flows: response.flows.flow ?? [],
    };
  };

  /**
   * Returns information about the specified flow, including the flow's output steps,
   * project, owner, tags, and parameters.
   *
   * Required scopes: `tableau:flows:read`
   *
   * @param siteId - The Tableau site ID
   * @param flowId - The ID of the flow to return information for
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow
   */
  queryFlow = async ({
    siteId,
    flowId,
  }: {
    siteId: string;
    flowId: string;
  }): Promise<{ flow: Flow; outputSteps: FlowOutputStep[] }> => {
    const response = await this._apiClient.queryFlow({
      params: { siteId, flowId },
      ...this.authHeader,
    });
    return {
      flow: response.flow,
      outputSteps: response.flowOutputSteps?.flowOutputStep ?? [],
    };
  };

  /**
   * Returns a list of input data connections for the specified flow.
   *
   * Required scopes: `tableau:flow_connections:read`
   *
   * @param siteId - The Tableau site ID
   * @param flowId - The ID of the flow to return connections for
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow_connections
   */
  queryFlowConnections = async ({
    siteId,
    flowId,
  }: {
    siteId: string;
    flowId: string;
  }): Promise<FlowConnection[]> => {
    const response = await this._apiClient.queryFlowConnections({
      params: { siteId, flowId },
      ...this.authHeader,
    });
    return response.connections.connection ?? [];
  };

  /**
   * Returns flow runs on a site, optionally filtered (e.g. by flowId).
   *
   * Required scopes: `tableau:flow_runs:read`
   *
   * @param siteId - The Tableau site ID
   * @param filter - Optional filter string (e.g. flowId:eq:abc-123)
   * @param sort - Optional sort expression (e.g. startedAt:desc)
   * @param pageSize - Items per page (1-1000, default 100)
   * @param pageNumber - Offset for paging (default 1)
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_runs
   */
  getFlowRuns = async ({
    siteId,
    filter,
    sort,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    filter?: string;
    sort?: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<FlowRun[]> => {
    const response = await this._apiClient.getFlowRuns({
      params: { siteId },
      queries: { filter, sort, pageSize, pageNumber },
      ...this.authHeader,
    });
    return response.flowRuns.flowRuns ?? [];
  };
}
