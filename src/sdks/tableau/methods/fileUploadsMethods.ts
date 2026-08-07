import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { fileUploadsApis } from '../apis/fileUploadsApi.js';
import { buildMultipartMixedBody } from '../multipart.js';
import { RestApiCredentials } from '../restApi.js';
import { FileUpload, fileUploadSchema } from '../types/fileUpload.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * File Upload methods of the Tableau Server REST API
 *
 * @export
 * @class FileUploadsMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm
 */
export default class FileUploadsMethods extends AuthenticatedMethods<typeof fileUploadsApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, fileUploadsApis, { axiosConfig }), creds);
  }

  /**
   * Initiates the upload process for a file to be published as a workbook (or data source).
   * Returns an upload session ID used by subsequent Append to File Upload and Publish
   * Workbook calls.
   *
   * @param siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#initiate_file_upload
   */
  initiateFileUpload = async ({ siteId }: { siteId: string }): Promise<FileUpload> => {
    return (
      await this._apiClient.initiateFileUpload({
        params: { siteId },
        ...this.authHeader,
      })
    ).fileUpload;
  };

  /**
   * Appends a chunk of data to an upload session, to be committed by a later Publish
   * Workbook (or Publish Data Source) call. Sends a `multipart/mixed` body, which
   * Zodios cannot construct, so this bypasses the Zodios-typed client and calls the
   * underlying axios instance directly.
   *
   * @param siteId - The Tableau site ID
   * @param uploadSessionId - The upload session ID returned by `initiateFileUpload`
   * @param chunk - The chunk of file bytes to append
   * @param sequenceId - Optional sequence ID for concurrent chunk uploads to the same session
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#append_to_file_upload
   */
  appendToFileUpload = async ({
    siteId,
    uploadSessionId,
    chunk,
    sequenceId,
  }: {
    siteId: string;
    uploadSessionId: string;
    chunk: Buffer;
    sequenceId?: string;
  }): Promise<FileUpload> => {
    const { body, contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: '' },
      {
        name: 'tableau_file',
        filename: 'file',
        contentType: 'application/octet-stream',
        data: chunk,
      },
    ]);

    const response = await this._apiClient.axios.put(
      `${this._apiClient.axios.defaults.baseURL}/sites/${siteId}/fileUploads/${uploadSessionId}`,
      body,
      {
        params: { sequenceID: sequenceId },
        headers: {
          'Content-Type': contentType,
          ...this.authHeader.headers,
        },
      },
    );

    return fileUploadSchema.parse(response.data.fileUpload);
  };
}
