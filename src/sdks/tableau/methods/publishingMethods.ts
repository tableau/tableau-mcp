import { Zodios, ZodiosEndpointDefinitions } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { buildMultipartMixedBody } from '../multipart.js';
import { RestApiCredentials } from '../restApi.js';
import { FileUpload, fileUploadResponseSchema } from '../types/fileUpload.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/** Tableau's fileUploads endpoint rejects any single chunk larger than 64 MB. */
export const MAX_FILE_UPLOAD_CHUNK_BYTES = 64 * 1024 * 1024;

const publishingApis: ZodiosEndpointDefinitions = [];

/**
 * Publishing methods of the Tableau Server REST API.
 *
 * These wrap the generic chunked file upload session endpoints used to stage content
 * for publishing. They aren't specific to any one content type - workbooks, published
 * data sources, and flows all publish through the same upload session flow - so they
 * live here rather than in a content-type-specific methods class.
 *
 * @export
 * @class PublishingMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_publish.htm
 */
export default class PublishingMethods extends AuthenticatedMethods<typeof publishingApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, publishingApis, { axiosConfig }), creds);
  }

  /**
   * Prepares the server to receive a file, returning an upload session id that
   * `appendToFileUpload` and `publishWorkbook` accept.
   *
   * Required scopes: `tableau:file_uploads:create`
   *
   * @param siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_publish.htm
   */
  initiateFileUpload = async ({ siteId }: { siteId: string }): Promise<FileUpload> => {
    const response = await this._apiClient.axios.post(
      `${this._apiClient.axios.defaults.baseURL}/sites/${siteId}/fileUploads`,
      undefined,
      {
        headers: {
          Accept: 'application/json',
          ...this.authHeader.headers,
        },
      },
    );

    return fileUploadResponseSchema.parse(response.data).fileUpload;
  };

  /**
   * Appends a chunk (up to 64 MB) of file content to an upload session previously
   * created by `initiateFileUpload`. Call repeatedly, in order, to upload files larger
   * than a single request can carry.
   *
   * Required scopes: `tableau:file_uploads:create`
   *
   * @param siteId - The Tableau site ID
   * @param uploadSessionId - The upload session id returned by `initiateFileUpload`
   * @param filename - The filename presented to Tableau for this chunk
   * @param chunk - Up to 64 MB of raw file content
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_publish.htm
   */
  appendToFileUpload = async ({
    siteId,
    uploadSessionId,
    filename,
    chunk,
  }: {
    siteId: string;
    uploadSessionId: string;
    filename: string;
    chunk: Buffer;
  }): Promise<FileUpload> => {
    const { body, contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: '' },
      {
        name: 'tableau_file',
        filename,
        contentType: 'application/octet-stream',
        data: chunk,
        dispositionType: 'form-data',
      },
    ]);

    const response = await this._apiClient.axios.put(
      `${this._apiClient.axios.defaults.baseURL}/sites/${siteId}/fileUploads/${uploadSessionId}`,
      body,
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': contentType,
          ...this.authHeader.headers,
        },
      },
    );

    return fileUploadResponseSchema.parse(response.data).fileUpload;
  };

  /**
   * Uploads a file's full contents to a new Tableau file upload session, chunking as
   * needed, and returns the resulting upload session id for use with `publishWorkbook`.
   *
   * @param siteId - The Tableau site ID
   * @param filename - The filename presented to Tableau for each chunk
   * @param content - The full file contents to upload
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_publish.htm
   */
  uploadFileInChunks = async ({
    siteId,
    filename,
    content,
  }: {
    siteId: string;
    filename: string;
    content: Buffer;
  }): Promise<string> => {
    const { uploadSessionId } = await this.initiateFileUpload({ siteId });

    for (let offset = 0; offset < content.byteLength; offset += MAX_FILE_UPLOAD_CHUNK_BYTES) {
      await this.appendToFileUpload({
        siteId,
        uploadSessionId,
        filename,
        chunk: content.subarray(offset, offset + MAX_FILE_UPLOAD_CHUNK_BYTES),
      });
    }

    return uploadSessionId;
  };
}
