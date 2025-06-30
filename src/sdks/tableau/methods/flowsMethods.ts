import { Zodios } from '@zodios/core';

import { Flow, flowsApis } from '../apis/flowsApi.js';
import { Credentials } from '../types/credentials.js';
import { Pagination } from '../types/pagination.js';
import AuthenticatedMethods from './authenticatedMethods.js';

export default class FlowsMethods extends AuthenticatedMethods<typeof flowsApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, flowsApis), creds);
  }

  /**
   * Returns a list of flows on the specified site.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref.htm#query_flows_for_site
   * @param siteId - The Tableau site ID
   * @param filter - The filter expression (e.g., name:eq:SalesFlow)
   * @param sort - The sort expression (e.g., createdAt:desc)
   * @param pageSize - The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.
   * @param pageNumber - The offset for paging. The default is 1.
   */
  listFlows = async ({
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
  }): Promise<{ pagination: Pagination; flows: Flow[] }> => {
    const response = await this._apiClient.listFlows({
      params: { siteId },
      queries: { filter, sort, 'page-size': pageSize, 'page-number': pageNumber },
      ...this.authHeader,
    });
    return {
      pagination: response.pagination,
      flows: response.flows.flow ?? [],
    };
  };
}
