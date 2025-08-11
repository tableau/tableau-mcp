import { Zodios } from '@zodios/core';

import { workbookApis } from '../apis/workbookApi.js';
import { Credentials } from '../types/credentials.js';
import { Pagination } from '../types/pagination.js';
import { Workbook } from '../types/workbook.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Workbook methods of the Tableau Server REST API
 *
 * @export
 * @class WorkbookMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm
 */
export default class WorkbookMethods extends AuthenticatedMethods<typeof workbookApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, workbookApis), creds);
  }

  /**
   * Returns information about the specified workbook, including information about views and tags.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param {string} workbookId The ID of the workbook to return information for.
   * @param {string} siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook
   */
  getWorkbook = async ({
    workbookId,
    siteId,
  }: {
    workbookId: string;
    siteId: string;
  }): Promise<Workbook> => {
    return (
      await this._apiClient.getWorkbook({
        params: { siteId, workbookId },
        ...this.authHeader,
      })
    ).workbook;
  };

  /**
   * Returns a specified view rendered as data in comma separated value (CSV) format.
   *
   * Required scopes: `tableau:views:download`
   *
   * @param {string} viewId The ID of the view to return an image for.
   * @param {string} siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_data
   */
  queryViewData = async ({
    viewId,
    siteId,
  }: {
    viewId: string;
    siteId: string;
  }): Promise<string> => {
    return await this._apiClient.queryViewData({
      params: { siteId, viewId },
      ...this.authHeader,
    });
  };

  /**
   * Returns an image of the specified view.
   *
   * Required scopes: `tableau:views:download`
   *
   * @param {string} viewId The ID of the view to return an image for.
   * @param {string} siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_image
   */
  queryViewImage = async ({
    viewId,
    siteId,
  }: {
    viewId: string;
    siteId: string;
  }): Promise<string> => {
    return await this._apiClient.queryViewImage({
      params: { siteId, viewId },
      ...this.authHeader,
      responseType: 'arraybuffer',
    });
  };

  /**
   * Returns the workbooks on a site.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param siteId - The Tableau site ID
   * @param filter - The filter string to filter workbooks by
   * @param pageSize - The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.
   * @param pageNumber - The offset for paging. The default is 1.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site
   */
  queryWorkbooksForSite = async ({
    siteId,
    filter,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    filter: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<{ pagination: Pagination; workbooks: Workbook[] }> => {
    const response = await this._apiClient.queryWorkbooksForSite({
      params: { siteId },
      queries: { filter, pageSize, pageNumber },
      ...this.authHeader,
    });
    return {
      pagination: response.pagination,
      workbooks: response.workbooks.workbook ?? [],
    };
  };
}
