import { Zodios } from '@zodios/core';

import { viewsApis } from '../apis/viewsApi.js';
import { Credentials } from '../types/credentials.js';
import { View } from '../types/view.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Views methods of the Tableau Server REST API
 *
 * @export
 * @class ViewsMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm
 */
export default class ViewsMethods extends AuthenticatedMethods<typeof viewsApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, viewsApis), creds);
  }

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
   * @param {number} width - (Optional) The width of the rendered image in pixels that, along with the value of vizHeight determine its resolution and aspect ratio.
   * @param {number} height - (Optional) The height of the rendered image in pixels that, along with the value of vizWidth determine its resolution and aspect ratio.
   * @param {string} resolution - (Optional) The resolution of the image. Image width and actual pixel density are determined by the display context of the image. Aspect ratio is always preserved. Set the value to high to ensure maximum pixel density.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_image
   */
  queryViewImage = async ({
    viewId,
    siteId,
    width,
    height,
    resolution,
  }: {
    viewId: string;
    siteId: string;
    width?: number;
    height?: number;
    resolution?: 'high';
  }): Promise<string> => {
    return await this._apiClient.queryViewImage({
      params: { siteId, viewId },
      queries: { vizWidth: width, vizHeight: height, resolution },
      ...this.authHeader,
      responseType: 'arraybuffer',
    });
  };

  /**
   * Returns all the views for the specified workbook, optionally including usage statistics.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param {string} workbookId The ID of the workbook to return views for.
   * @param {string} siteId - The Tableau site ID
   * @param {boolean} includeUsageStatistics - (Optional) true to return usage statistics. The default is false.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_workbook
   */
  queryViewsForWorkbook = async ({
    workbookId,
    siteId,
    includeUsageStatistics,
  }: {
    workbookId: string;
    siteId: string;
    includeUsageStatistics?: boolean;
  }): Promise<View[]> => {
    return (
      await this._apiClient.queryViewsForWorkbook({
        params: { siteId, workbookId },
        queries: { includeUsageStatistics },
        ...this.authHeader,
      })
    ).views.view;
  };
}
