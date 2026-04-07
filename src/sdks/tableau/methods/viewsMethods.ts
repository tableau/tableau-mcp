import { Zodios } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';

import { AxiosRequestConfig, isAxiosError } from '../../../utils/axios.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { viewsApis } from '../apis/viewsApi.js';
import { RestApiCredentials } from '../restApi.js';
import type { CustomView } from '../types/customView.js';
import { Pagination } from '../types/pagination.js';
import { View } from '../types/view.js';
import AuthenticatedMethods from './authenticatedMethods.js';

type QueryImageError = { type: 'feature-disabled' } | { type: 'unknown'; message: string };

/**
 * Views methods of the Tableau Server REST API
 *
 * @export
 * @class ViewsMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm
 */
export default class ViewsMethods extends AuthenticatedMethods<typeof viewsApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, viewsApis, { axiosConfig }), creds);
  }

  /**
   * Gets the details of a specific view.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param {string} viewId The ID of the view to get.
   * @param {string} siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view
   */
  getView = async ({ viewId, siteId }: { viewId: string; siteId: string }): Promise<View> => {
    return (await this._apiClient.getView({ params: { siteId, viewId }, ...this.authHeader })).view;
  };

  /**
   * Gets the details of a specified custom view.
   *
   * Required scopes: `tableau:content:read`
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view
   */
  getCustomView = async ({
    customViewId,
    siteId,
  }: {
    customViewId: string;
    siteId: string;
  }): Promise<CustomView> => {
    return (
      await this._apiClient.getCustomView({
        params: { siteId, customViewId },
        ...this.authHeader,
      })
    ).customView;
  };

  /**
   * Returns a specified custom view as CSV (same semantics as Query View Data for the underlying sheet).
   *
   * Required scopes: `tableau:views:download`
   *
   * @param {string} customViewId The ID of the custom view to return data for.
   * @param {string} siteId - The Tableau site ID
   * @param {Record<string, string>} viewFilters - Map of field name to filter value; keys are prefixed with `vf_` unless already present.
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view_data
   */
  getCustomViewData = async ({
    customViewId,
    siteId,
    viewFilters,
  }: {
    customViewId: string;
    siteId: string;
    viewFilters?: Record<string, string>;
  }): Promise<string> => {
    const queries: Record<string, string> = {};
    if (viewFilters) {
      for (const [key, value] of Object.entries(viewFilters)) {
        const paramName = key.startsWith('vf_') ? key : `vf_${key}`;
        queries[paramName] = value;
      }
    }

    return await this._apiClient.getCustomViewData({
      params: { siteId, customViewId },
      queries,
      ...this.authHeader,
    });
  };

  /**
   * Returns an image of the specified custom view (saved view state / filters).
   *
   * Required scopes: `tableau:views:download`
   *
   * @param {string} customViewId The ID of the custom view to return an image for.
   * @param {string} siteId - The Tableau site ID
   * @param {number} width - (Optional) The width of the rendered image in pixels that, along with the value of vizHeight determine its resolution and aspect ratio.
   * @param {number} height - (Optional) The height of the rendered image in pixels that, along with the value of vizWidth determine its resolution and aspect ratio.
   * @param {string} resolution - (Optional) The resolution of the image. Image width and actual pixel density are determined by the display context of the image. Aspect ratio is always preserved. Set the value to high to ensure maximum pixel density.
   * @param {string} format - (Optional) The format of the image. PNG (default) or SVG.
   * @param {Record<string, string>} viewFilters - Map of field name to filter value; keys are prefixed with `vf_` unless already present.
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view_image
   */
  getCustomViewImage = async ({
    customViewId,
    siteId,
    width,
    height,
    resolution = 'high',
    format,
    viewFilters,
  }: {
    customViewId: string;
    siteId: string;
    resolution?: 'high';
    width?: number;
    height?: number;
    format?: 'PNG' | 'SVG';
    viewFilters?: Record<string, string>;
  }): Promise<Result<string, QueryImageError>> => {
    const queries: Record<string, string | number> = {
      ...(width !== undefined ? { vizWidth: width } : {}),
      ...(height !== undefined ? { vizHeight: height } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
      ...(format !== undefined ? { format } : {}),
    };

    if (viewFilters) {
      for (const [key, value] of Object.entries(viewFilters)) {
        const paramName = key.startsWith('vf_') ? key : `vf_${key}`;
        queries[paramName] = value;
      }
    }

    try {
      const response = await this._apiClient.getCustomViewImage({
        params: { siteId, customViewId },
        queries,
        ...this.authHeader,
        responseType: 'arraybuffer',
      });
      return Ok(response);
    } catch (error) {
      return handleQueryImageError(error);
    }
  };

  /**
   * Returns a specified view rendered as data in comma separated value (CSV) format.
   *
   * Required scopes: `tableau:views:download`
   *
   * @param {string} viewId The ID of the view to return an image for.
   * @param {string} siteId - The Tableau site ID
   * @param {Record<string, string>} viewFilters - Map of field name to filter value; keys are prefixed with `vf_` unless already present.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_data
   */
  queryViewData = async ({
    viewId,
    siteId,
    viewFilters,
  }: {
    viewId: string;
    siteId: string;
    viewFilters?: Record<string, string>;
  }): Promise<string> => {
    const queries: Record<string, string> = {};
    if (viewFilters) {
      for (const [key, value] of Object.entries(viewFilters)) {
        const paramName = key.startsWith('vf_') ? key : `vf_${key}`;
        queries[paramName] = value;
      }
    }

    return await this._apiClient.queryViewData({
      params: { siteId, viewId },
      queries,
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
   * @param {string} format - (Optional) The format of the image. PNG (default) or SVG.
   * @param {Record<string, string>} viewFilters - Map of field name to filter value; keys are prefixed with `vf_` unless already present.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_image
   */
  queryViewImage = async ({
    viewId,
    siteId,
    width,
    height,
    resolution,
    format,
    viewFilters,
  }: {
    viewId: string;
    siteId: string;
    width?: number;
    height?: number;
    resolution?: 'high';
    format?: 'PNG' | 'SVG';
    viewFilters?: Record<string, string>;
  }): Promise<Result<string, QueryImageError>> => {
    const queries: Record<string, string | number> = {
      ...(width !== undefined ? { vizWidth: width } : {}),
      ...(height !== undefined ? { vizHeight: height } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
      ...(format !== undefined ? { format } : {}),
    };

    if (viewFilters) {
      for (const [key, value] of Object.entries(viewFilters)) {
        const paramName = key.startsWith('vf_') ? key : `vf_${key}`;
        queries[paramName] = value;
      }
    }

    try {
      const response = await this._apiClient.queryViewImage({
        params: { siteId, viewId },
        queries,
        ...this.authHeader,
        responseType: 'arraybuffer',
      });
      return Ok(response);
    } catch (error) {
      return handleQueryImageError(error);
    }
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

  /**
   * Returns all the views for the specified site, optionally including usage statistics.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param {string} siteId - The Tableau site ID
   * @param {boolean} includeUsageStatistics - (Optional) true to return usage statistics. The default is false.
   * @param {string} filter - (Optional) Fields and operators that you can use to filter results
   * @param {number} pageSize - (Optional) The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.
   * @param {number} pageNumber - (Optional) The offset for paging. The default is 1.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_site
   */
  queryViewsForSite = async ({
    siteId,
    includeUsageStatistics,
    filter,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    includeUsageStatistics?: boolean;
    filter: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<{ pagination: Pagination; views: View[] }> => {
    const response = await this._apiClient.queryViewsForSite({
      params: { siteId },
      queries: { includeUsageStatistics, filter, pageSize, pageNumber },
      ...this.authHeader,
    });
    return {
      pagination: response.pagination,
      views: response.views.view ?? [],
    };
  };
}

function handleQueryImageError(error: unknown): Result<string, QueryImageError> {
  // Handle Axios errors with response data
  if (isAxiosError(error) && error.response?.data) {
    let errorData = error.response.data;

    // When responseType is 'arraybuffer', parse the response body
    if (!errorData.error) {
      try {
        const text = new TextDecoder().decode(errorData);
        errorData = JSON.parse(text);
      } catch {
        return Err({ type: 'unknown', message: getExceptionMessage(error) });
      }
    }

    if (errorData.error?.code === '403157') {
      return Err({ type: 'feature-disabled' });
    }

    // Extract the actual error details from Tableau Server response
    if (errorData.error) {
      const { summary, detail } = errorData.error;
      const message = detail ? `${summary}: ${detail}` : summary;
      return Err({ type: 'unknown', message });
    }
  }

  return Err({ type: 'unknown', message: getExceptionMessage(error) });
}
