import { Zodios } from '@zodios/core';
import path from 'path';

import { throwIfPublishFailed, workbookApis } from '../apis/workbookApi.js';
import { usePostMultipartPluginAsync } from '../plugins/postMultipartPlugin.js';
import { Credentials } from '../types/credentials.js';
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
   * @param {string} siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site
   */
  queryWorkbooksForSite = async (siteId: string): Promise<Workbook[]> => {
    return (
      (
        await this._apiClient.queryWorkbooksForSite({
          params: { siteId },
          ...this.authHeader,
        })
      ).workbooks.workbook ?? []
    );
  };

  /**
   * Publishes a workbook on the specified site.
   *
   * Required scopes: `tableau:workbooks:create`
   *
   * @param {string} pathToWorkbookFile The local path to the workbook file.
   * @param {string} siteId - The Tableau site ID
   * @param {string} projectId The id of the project to which to publish the workbook.
   * @param {AdditionalWorkbookOptions} [options={}] Additional optional options.
   * @param options.workbookNameSuffix A suffix string to append to the name of the workbook.
   * @param options.additionalWorkbookFlags Additional workbook flags to add to the request payload.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#publish_workbook
   */
  publishWorkbook = async ({
    pathToWorkbookFile,
    siteId,
    projectId,
    options,
  }: {
    pathToWorkbookFile: string;
    siteId: string;
    projectId: string;
    options: Partial<{
      workbookNameSuffix: string;
      additionalWorkbookFlags: Partial<Workbook>;
    }>;
  }): Promise<void> => {
    const workbookNameWithoutExtension = `${path.parse(pathToWorkbookFile).name}${options.workbookNameSuffix ?? ''}`;
    const workbook = {
      name: workbookNameWithoutExtension,
      project: { id: projectId },
      ...options.additionalWorkbookFlags,
    };

    await usePostMultipartPluginAsync({
      apiClient: this._apiClient,
      actionFnAsync: async () => {
        await this._apiClient.publishWorkbook(
          {
            contentDispositionName: 'tableau_workbook',
            asset: { workbook },
            pathToFile: pathToWorkbookFile,
          },
          {
            params: { siteId },
            ...this.authAndMultipartRequestHeaders,
          },
        );
      },
      catchFn: (e) => {
        throwIfPublishFailed(e, workbookNameWithoutExtension);
      },
    });
  };
}
