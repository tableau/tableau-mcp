import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { workbooksApis } from '../apis/workbooksApi.js';
import { RestApiCredentials } from '../restApi.js';
import { Pagination } from '../types/pagination.js';
import { Workbook } from '../types/workbook.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Workbooks methods of the Tableau Server REST API
 *
 * @export
 * @class WorkbooksMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm
 */
export default class WorkbooksMethods extends AuthenticatedMethods<typeof workbooksApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, workbooksApis, { axiosConfig }), creds);
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

  /**
   * Deletes the specified workbook from the site.
   *
   * On Tableau Cloud the workbook is moved to the recycle bin and can be restored
   * for a limited time before permanent removal.
   *
   * Required scopes (Tableau Cloud): `tableau:workbooks:delete`
   *
   * @param workbookId - The ID of the workbook to delete.
   * @param siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#delete_workbook
   */
  deleteWorkbook = async ({
    workbookId,
    siteId,
  }: {
    workbookId: string;
    siteId: string;
  }): Promise<void> => {
    await this._apiClient.deleteWorkbook(undefined, {
      params: { siteId, workbookId },
      ...this.authHeader,
    });
  };

  /**
   * Adds one or more tags to the specified workbook.
   *
   * Required scopes (Tableau Cloud): `tableau:workbook_tags:update`
   *
   * @param workbookId - The ID of the workbook to tag.
   * @param siteId - The Tableau site ID
   * @param tagLabels - The tag labels to add.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#add_tags_to_workbook
   */
  addTagsToWorkbook = async ({
    workbookId,
    siteId,
    tagLabels,
  }: {
    workbookId: string;
    siteId: string;
    tagLabels: ReadonlyArray<string>;
  }): Promise<void> => {
    await this._apiClient.addTagsToWorkbook(
      { tags: { tag: tagLabels.map((label) => ({ label })) } },
      {
        params: { siteId, workbookId },
        ...this.authHeader,
      },
    );
  };
}
