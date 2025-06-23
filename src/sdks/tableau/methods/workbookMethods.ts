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
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook
   * @param {string} workbookId The ID of the workbook to return information for.
   */
  getWorkbook = async (workbookId: string): Promise<Workbook> => {
    return (
      await this._apiClient.getWorkbook({
        params: { siteId: this.creds.site.id, workbookId },
        ...this.authHeader,
      })
    ).workbook;
  };

  /**
   * Returns an image of the specified view.
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_image
   * @param {string} viewId The ID of the view to return an image for.
   */
  queryViewImage = async (viewId: string): Promise<string> => {
    return await this._apiClient.queryViewImage({
      params: { siteId: this.creds.site.id, viewId },
      ...this.authHeader,
      responseType: 'arraybuffer',
    });
  };

  /**
   * Returns the workbooks on a site.
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site
   */
  queryWorkbooksForSite = async (): Promise<Workbook[]> => {
    return (
      (
        await this._apiClient.queryWorkbooksForSite({
          params: { siteId: this.creds.site.id },
          ...this.authHeader,
        })
      ).workbooks.workbook ?? []
    );
  };

  /**
   * Publishes a workbook on the specified site.
   *
   * @param {string} pathToWorkbookFile The local path to the workbook file.
   * @param {string} siteId - The Tableau site ID
   * @param {string} projectId The id of the project to which to publish the workbook.
   * @param {AdditionalWorkbookOptions} [options={}] Additional optional options.
   * @param options.workbookNameSuffix A suffix string to append to the name of the workbook.
   * @param options.additionalWorkbookFlags Additional workbook flags to add to the request payload.
   */
  publishWorkbook = async (
    pathToWorkbookFile: string,
    siteId: string,
    projectId: string,
    options: Partial<{
      workbookNameSuffix: string;
      additionalWorkbookFlags: Partial<Workbook>;
    }> = {},
  ): Promise<void> => {
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

  /**
   * Deletes a workbook.
   *
   * @param {string} siteId - The Tableau site ID
   * @param {string} workbookId The id of the workbook you want to delete.
   */
  deleteWorkbook = async (siteId: string, workbookId: string): Promise<void> => {
    await this._apiClient.deleteWorkbook(undefined, {
      params: { siteId, workbookId },
      ...this.authHeader,
    });
  };
}
