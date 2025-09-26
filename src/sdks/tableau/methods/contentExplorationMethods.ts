import { Zodios } from '@zodios/core';

import { contentExplorationApis } from '../apis/contentExplorationApi.js';
import { SearchContentResponse } from '../types/contentExploration.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Content Exploration methods of the Tableau Server REST API
 *
 * @export
 * @class ContentExplorationMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_content_exploration.htm
 */
export default class ContentExplorationMethods extends AuthenticatedMethods<
  typeof contentExplorationApis
> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, contentExplorationApis), creds);
  }

  /**
   * Searches across all supported content types for objects relevant to the search expression specified in the querystring of the request URI.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param terms - The search terms
   * @param page - The number of the page in the list reponse pages to return. Maximum number of items is 2000.
   * @param limit - The number of items to return on each page. The default is 10.
   * @param orderBy - The sorting method for items returned.
   * @param filter - An expression to filter the response
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_content_exploration.htm#ContentExplorationService_getSearch
   */
  searchContent = async (queries: {
    terms?: string;
    page?: number;
    limit?: number;
    orderBy?: string;
    filter?: string;
  }): Promise<SearchContentResponse> => {
    Object.entries(queries).forEach(([key, value]) => {
      if (value === undefined) {
        delete queries[key as keyof typeof queries];
      }
    });
    const response = await this._apiClient.searchContent({ queries, ...this.authHeader });
    return response.hits;
  };
}
