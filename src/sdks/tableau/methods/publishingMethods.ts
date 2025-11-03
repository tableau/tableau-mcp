import { Zodios } from '@zodios/core';
import { Result } from 'ts-results-es';

import { publishingApis } from '../apis/publishingApi.js';
import { useMultipartPluginAsync } from '../plugins/multipartPlugin.js';
import { Credentials } from '../types/credentials.js';
import { FileUpload } from '../types/fileUpload.js';
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
  initiateFileUpload = async ({ siteId }: { siteId: string }): Promise<FileUpload> => {
    return (
      await this._apiClient.initiateFileUpload(undefined, {
        params: { siteId },
        ...this.authHeader,
      })
    ).fileUpload;
  };

  /**
   * Uploads a block of data and appends it to the data that is already uploaded.
   *
   * Required scopes: `tableau:file_uploads:create`
   *
   * @param {string} siteId - The Tableau site ID
   * @param {string} uploadSessionId - The upload session ID
   * @param {string} filename - The filename
   * @param {Buffer} fileBuffer - The XML to upload
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#append_to_file_upload
   */
  appendToFileUpload = async ({
    siteId,
    uploadSessionId,
    filename,
    fileBuffer,
  }: {
    siteId: string;
    uploadSessionId: string;
    filename: string;
    fileBuffer: Buffer;
  }): Promise<Result<FileUpload, unknown>> => {
    return await useMultipartPluginAsync({
      apiClient: this._apiClient,
      actionFnAsync: async () => {
        const boundaryString = crypto.randomUUID();
        return (
          await this._apiClient.appendToFileUpload(
            {
              filename,
              fileBuffer,
              boundaryString,
              contentDispositionName: 'tableau_file',
              contentType: 'application/xml',
            },
            {
              params: { siteId, uploadSessionId },
              headers: {
                'Content-Type': `multipart/mixed; boundary=${boundaryString}`,
                ...this.authHeader.headers,
              },
            },
          )
        ).fileUpload;
      },
    });
  };
}
