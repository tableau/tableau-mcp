import { ZodiosEndpointDefinitions } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { buildRestPath } from '../../routeSafety/core.js';
import { createGuardedZodios } from '../../routeSafety/zodios.js';
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
    super(createGuardedZodios(baseUrl, publishingApis, { axiosConfig }), creds);
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
      buildRestPath('sites', siteId, 'fileUploads'),
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
      buildRestPath('sites', siteId, 'fileUploads', uploadSessionId),
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
   * Streams a file's contents to a new Tableau file upload session, regrouping the incoming
   * pieces into chunks of at most `chunkBytes` and appending them in order. Holds at most about
   * one chunk plus the current piece in memory. Returns the upload session id for use with
   * `publishWorkbook`; no session is created if the content is empty or fails before the first
   * chunk is full.
   *
   * @param siteId - The Tableau site ID
   * @param filename - The filename presented to Tableau for each chunk
   * @param content - The file contents as a stream of byte pieces
   * @param maxBytes - Maximum total size; throws as soon as the stream exceeds it
   * @param chunkBytes - Chunk size; defaults to (and must not exceed) Tableau's 64 MB limit
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_publish.htm
   */
  uploadFileInChunks = async ({
    siteId,
    filename,
    content,
    maxBytes,
    chunkBytes = MAX_FILE_UPLOAD_CHUNK_BYTES,
  }: {
    siteId: string;
    filename: string;
    content: AsyncIterable<Uint8Array>;
    maxBytes: number;
    chunkBytes?: number;
  }): Promise<string> => {
    let uploadSessionId: string | undefined;
    const appendChunk = async (chunk: Buffer): Promise<void> => {
      uploadSessionId ??= (await this.initiateFileUpload({ siteId })).uploadSessionId;
      await this.appendToFileUpload({ siteId, uploadSessionId, filename, chunk });
    };

    // Pieces are buffered by reference and copied once, into the chunk that sends them.
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let totalBytes = 0;
    for await (const piece of content) {
      totalBytes += piece.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`File content exceeds the maximum allowed size of ${maxBytes} bytes.`);
      }

      let rest = piece;
      while (pendingBytes + rest.byteLength >= chunkBytes) {
        const take = chunkBytes - pendingBytes;
        pending.push(rest.subarray(0, take));
        rest = rest.subarray(take);
        const chunk = Buffer.concat(pending, chunkBytes);
        pending = [];
        pendingBytes = 0;
        await appendChunk(chunk);
      }
      if (rest.byteLength > 0) {
        pending.push(rest);
        pendingBytes += rest.byteLength;
      }
    }

    if (totalBytes === 0) {
      throw new Error('File content must not be empty.');
    }
    if (pendingBytes > 0) {
      await appendChunk(Buffer.concat(pending, pendingBytes));
    }

    return uploadSessionId!;
  };
}
