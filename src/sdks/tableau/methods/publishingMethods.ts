import { Zodios } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';

import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { publishingApis } from '../apis/publishingApi.js';
import { useMultipartPluginAsync } from '../plugins/multipartPlugin.js';
import { Credentials } from '../types/credentials.js';
import { FileUpload } from '../types/fileUpload.js';
import AuthenticatedMethods from './authenticatedMethods.js';

export type PublishingError = {
  type: 'initiate-file-upload-error' | 'append-to-file-upload-error';
  message: string;
};

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
  }): Promise<Result<FileUpload, { type: 'initiate-file-upload-error'; message: string }>> => {
    try {
      return Ok(
        (
          await this._apiClient.initiateFileUpload(undefined, {
            params: { siteId },
            ...this.authHeader,
          })
        ).fileUpload,
      );
    } catch (error: unknown) {
      return Err({
        type: 'initiate-file-upload-error',
        message: getExceptionMessage(error),
      });
    }
  };

  /**
   * Uploads a block of data and appends it to the data that is already uploaded.
   *
   * Required scopes: `tableau:file_uploads:create`
   *
   * @param {string} siteId - The Tableau site ID
   * @param {string} uploadSessionId - The upload session ID
   * @param {string} filename - The filename
   * @param {Buffer} contents - The contents of the file to upload
   * @param {string} contentDispositionName - The content disposition name. Defaults to 'tableau_file'.
   * @param {string} contentType - The content type. Defaults to 'application/xml'.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#append_to_file_upload
   */
  appendToFileUpload = async ({
    siteId,
    uploadSessionId,
    filename,
    contents,
    contentDispositionName = 'tableau_file',
    contentType = 'application/xml',
  }: {
    siteId: string;
    uploadSessionId: string;
    filename: string;
    contents: Buffer;
    contentDispositionName?: 'tableau_file';
    contentType?: 'application/xml';
  }): Promise<Result<FileUpload, { type: 'append-to-file-upload-error'; message: string }>> => {
    try {
      const fileUpload = await useMultipartPluginAsync({
        apiClient: this._apiClient,
        actionFnAsync: async () => {
          const boundaryString = crypto.randomUUID();
          return (
            await this._apiClient.appendToFileUpload(
              {
                filename,
                contents,
                boundaryString,
                contentDispositionName,
                contentType,
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

      return fileUpload.isOk()
        ? fileUpload
        : Err({
            type: 'append-to-file-upload-error',
            message: getExceptionMessage(fileUpload.error),
          });
    } catch (error: unknown) {
      return Err({
        type: 'append-to-file-upload-error',
        message: getExceptionMessage(error),
      });
    }
  };
}
