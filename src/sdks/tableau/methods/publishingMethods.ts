import { Zodios } from '@zodios/core';

import { publishingApis } from '../apis/publishingApi.js';
import { useMultipartPluginAsync } from '../plugins/multipartPlugin.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Publishing methods of the Tableau Server REST API
 *
 * @export
 * @class PublishingMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm
 */
export default class PublishingMethods extends AuthenticatedMethods<typeof publishingApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, publishingApis), creds);
  }

  /**
   * Initiates the upload process for a file.
   *
   * Required scopes: `tableau:file_uploads:create`
   *
   * @param {string} siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#initiate_file_upload
   */
  initiateFileUpload = async ({
    siteId,
  }: {
    siteId: string;
  }): Promise<{ uploadSessionId: string }> => {
    const { uploadSessionId } = (
      await this._apiClient.initiateFileUpload(undefined, {
        params: { siteId },
        ...this.authHeader,
      })
    ).fileUpload;

    return { uploadSessionId };
  };

  /**
   * Uploads a block of data and appends it to the data that is already uploaded.
   *
   * Required scopes: `tableau:file_uploads:create`
   *
   * @param {string} siteId - The Tableau site ID
   * @param {string} uploadSessionId - The upload session ID
   * @param {string} filename - The filename
   * @param {string} xml - The XML to upload
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#append_to_file_upload
   */
  appendToFileUpload = async ({
    siteId,
    uploadSessionId,
    filename,
    xml,
  }: {
    siteId: string;
    uploadSessionId: string;
    filename: string;
    xml: string;
  }): Promise<void> => {
    await useMultipartPluginAsync({
      apiClient: this._apiClient,
      actionFnAsync: async () => {
        await this._apiClient.appendToFileUpload(
          {
            filename,
            contents: xml,
            contentDispositionName: 'request_payload',
            contentType: 'application/xml',
          },
          {
            params: { siteId, uploadSessionId },
          },
        );
      },
      catchFn: (e) => {
        throw e;
      },
    });
  };
}
