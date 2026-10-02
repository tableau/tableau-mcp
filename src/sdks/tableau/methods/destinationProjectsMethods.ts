import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { destinationProjectsApis } from '../apis/destinationProjectsApi.js';
import { RestApiCredentials } from '../restApi.js';
import { Pagination } from '../types/pagination.js';
import { DestinationProject, DestinationProjectContentType } from '../types/project.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Experimental Query Destination Projects method of the Tableau Server REST API.
 *
 * Unlike {@link ProjectsMethods} (which targets the versioned `/api/3.x` path), this class is
 * constructed with the `${host}/api/exp` base URL so it can reach the experimental endpoint.
 *
 * @export
 * @class DestinationProjectsMethods
 */
export default class DestinationProjectsMethods extends AuthenticatedMethods<
  typeof destinationProjectsApis
> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, destinationProjectsApis, { axiosConfig }), creds);
  }

  /**
   * Returns the projects the user can see as candidate destinations for publishing or moving
   * content of `contentType`, each with a `status` of `VALID`, `INSUFFICIENT_PERMISSIONS`, or
   * `STRUCTURALLY_INVALID`.
   *
   * Experimental: `GET {host}/api/exp/sites/:siteId/projects/destinations`.
   *
   * Required scopes: `tableau:projects:read`
   *
   * @param siteId - The Tableau site ID
   * @param contentType - The kind of content being published or moved
   * @param sourceIds - Optional LUIDs (max 100) of the content being moved, so destinations that would be structurally invalid for it (e.g. a project's own descendant) are flagged
   * @param filter - The filter string to filter projects by (same fields as Query Projects)
   * @param pageSize - The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.
   * @param pageNumber - The offset for paging. The default is 1.
   */
  queryDestinationProjects = async ({
    siteId,
    contentType,
    sourceIds,
    filter,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    contentType: DestinationProjectContentType;
    sourceIds?: ReadonlyArray<string>;
    filter?: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<{ pagination: Pagination; projects: DestinationProject[] }> => {
    const response = await this._apiClient.queryDestinationProjects({
      params: { siteId },
      queries: {
        contentType,
        sourceIds: sourceIds?.length ? sourceIds.join(',') : undefined,
        filter: filter || undefined,
        pageSize,
        pageNumber,
      },
      ...this.authHeader,
    });
    return {
      pagination: response.pagination,
      projects: response.destinationProjects.destinationProject ?? [],
    };
  };
}
