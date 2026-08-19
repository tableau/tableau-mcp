import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { workbooksApis } from '../apis/workbooksApi.js';
import { buildMultipartMixedBody } from '../multipart.js';
import { RestApiCredentials } from '../restApi.js';
import { DownloadWorkbookResult } from '../types/downloadWorkbookResult.js';
import { Pagination } from '../types/pagination.js';
import { Workbook, WorkbookConnection, workbookSchema } from '../types/workbook.js';
import {
  WorkbookValidationResult,
  workbookValidationResultSchema,
} from '../types/workbookValidation.js';
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
   * Returns the data connections for the specified workbook. Each connection's
   * datasource id is the queryable embedded datasource LUID.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param workbookId - The ID of the workbook to return connections for.
   * @param siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook_connections
   */
  getWorkbookConnections = async ({
    workbookId,
    siteId,
  }: {
    workbookId: string;
    siteId: string;
  }): Promise<WorkbookConnection[]> => {
    const response = await this._apiClient.getWorkbookConnections({
      params: { siteId, workbookId },
      ...this.authHeader,
    });
    return response.connections.connection ?? [];
  };

  /**
   * Downloads the specified workbook in twb or twbx format.
   *
   * Required scopes (Tableau Cloud): `tableau:workbooks:download`
   *
   * @param workbookId - The ID of the workbook to delete.
   * @param siteId - The Tableau site ID
   * @param includeExtract - Whether to include the extract in the workbook.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#download_workbook
   */
  downloadWorkbook = async ({
    workbookId,
    siteId,
    includeExtract,
  }: {
    workbookId: string;
    siteId: string;
    includeExtract?: boolean;
  }): Promise<DownloadWorkbookResult> => {
    const response = await this._apiClient.axios.get<ArrayBuffer>(
      `${this._apiClient.axios.defaults.baseURL}/sites/${siteId}/workbooks/${workbookId}/content`,
      {
        params: { includeExtract },
        ...this.authHeader,
        responseType: 'arraybuffer',
      },
    );

    return {
      content: Buffer.from(response.data),
      contentType: getHeader(response.headers, 'content-type'),
      filename: getFilenameFromContentDisposition(
        getHeader(response.headers, 'content-disposition'),
      ),
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

  /**
   * Publishes a workbook on the specified site, committing a file previously uploaded
   * via `validateWorkbookAndUpload`.
   * Sends a `multipart/mixed` body, which Zodios cannot construct, so this bypasses the
   * Zodios-typed client and calls the underlying axios instance directly.
   *
   * @param siteId - The Tableau site ID
   * @param uploadSessionId - The upload session ID returned by `initiateFileUpload`
   * @param workbookType - `twb` or `twbx`, matching the file uploaded to the session
   * @param name - The name to give the published workbook
   * @param projectId - The ID of the project to publish the workbook into
   * @param overwrite - Whether to overwrite an existing workbook with the same name
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#publish_workbook
   */
  publishWorkbook = async ({
    siteId,
    uploadSessionId,
    workbookType,
    name,
    projectId,
    overwrite,
  }: {
    siteId: string;
    uploadSessionId: string;
    workbookType: 'twb' | 'twbx';
    name: string;
    projectId: string;
    overwrite?: boolean;
  }): Promise<Workbook> => {
    const xml =
      `<tsRequest><workbook name="${escapeXmlAttribute(name)}">` +
      `<project id="${escapeXmlAttribute(projectId)}"/>` +
      '</workbook></tsRequest>';
    const { body, contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: xml },
    ]);

    const response = await this._apiClient.axios.post(
      `${this._apiClient.axios.defaults.baseURL}/sites/${siteId}/workbooks`,
      body,
      {
        params: {
          uploadSessionId,
          workbookType,
          overwrite,
        },
        headers: {
          'Content-Type': contentType,
          ...this.authHeader.headers,
        },
      },
    );

    return workbookSchema.parse(response.data.workbook);
  };

  /**
   * Validates a TWB workbook file and uploads it to a temporary file upload session when validation
   * succeeds. The returned `uploadId` can be used anywhere Tableau expects an upload session ID.
   *
   * Required scopes: `tableau:workbooks:create`
   *
   * @param siteId - The Tableau site ID
   * @param filename - The TWB filename presented to Tableau. Must end with `.twb`.
   * @param workbook - The raw TWB XML bytes to validate and upload.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#validate_workbook_and_upload
   */
  validateWorkbookAndUpload = async ({
    siteId,
    filename,
    workbook,
  }: {
    siteId: string;
    filename: string;
    workbook: Buffer;
  }): Promise<WorkbookValidationResult> => {
    const { body, contentType } = buildMultipartMixedBody([
      {
        name: 'tableau_workbook',
        filename,
        contentType: 'application/octet-stream',
        data: workbook,
        dispositionType: 'form-data',
      },
    ]);

    const response = await this._apiClient.axios.post(
      `${this._apiClient.axios.defaults.baseURL}/sites/${siteId}/workbooks/validateWorkbookAndUpload`,
      body,
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': contentType,
          ...this.authHeader.headers,
        },
      },
    );

    return workbookValidationResultSchema.parse(response.data);
  };
}

function escapeXmlAttribute(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Numeric char ref, not the named &apos; - &apos; is a valid XML 1.0 entity but is absent from
      // the HTML predefined set and the Tableau publish endpoint's parser rejects it (a name like
      // O'Brien then 400s). &#39; is universally accepted.
      .replace(/'/g, '&#39;')
  );
}

function getHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

function getFilenameFromContentDisposition(
  contentDispositionHeader: string | undefined,
): string | undefined {
  if (!contentDispositionHeader) {
    return undefined;
  }

  // Supports both filename="foo.twbx" and filename=foo.twbx.
  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(
    contentDispositionHeader,
  );
  const encodedOrQuotedOrRaw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!encodedOrQuotedOrRaw) {
    return undefined;
  }

  const filename = encodedOrQuotedOrRaw.trim();
  if (!filename) {
    return undefined;
  }

  if (match?.[1]) {
    try {
      return decodeURIComponent(filename);
    } catch {
      return filename;
    }
  }

  return filename;
}
