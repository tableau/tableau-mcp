import { Zodios } from '@zodios/core';
import { z } from 'zod';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { publishingApis } from '../apis/publishingApi.js';
import { RestApiCredentials } from '../restApi.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * The subset of the published-workbook response we rely on. Tableau returns the full workbook
 * element; we keep this lenient (passthrough) so publishing never fails validation over an
 * attribute we don't read.
 */
export const publishedWorkbookSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    contentUrl: z.string().optional(),
    webpageUrl: z.string().optional(),
    project: z.object({ id: z.string(), name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export type PublishedWorkbook = z.infer<typeof publishedWorkbookSchema>;

// Multipart part names required by the Tableau publish endpoint. Confirmed against the Tableau REST
// API reference and the monolith's own product tests (request_payload = the tsRequest XML,
// tableau_workbook = the file bytes).
const XML_PART_NAME = 'request_payload';
const FILE_PART_NAME = 'tableau_workbook';

/**
 * Escapes a string for safe interpolation into an XML attribute value. The workbook name and
 * project/location ids all flow into the tsRequest payload, so this closes an XML-injection vector
 * on the publish name in particular (which is user/model-supplied).
 */
function escapeXmlAttr(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Numeric char ref, not the named &apos; — &apos; is a valid XML 1.0 entity but is absent from
      // the HTML predefined set and the Tableau publish endpoint's parser rejects it (a name like
      // O'Brien then 400s). &#39; is universally accepted.
      .replace(/'/g, '&#39;')
  );
}

/**
 * Publishing methods of the Tableau Server REST API.
 *
 * Publish is multipart/mixed and does not fit the JSON-oriented Zodios endpoint shape, so it is
 * issued directly against the underlying axios instance with a hand-built body. The companion
 * operations (read personal space, move workbook) are ordinary JSON endpoints defined in
 * publishingApi.ts and go through Zodios.
 *
 * @export
 * @class PublishingMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#publish_workbook
 */
export default class PublishingMethods extends AuthenticatedMethods<typeof publishingApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, publishingApis, { axiosConfig }), creds);
  }

  /**
   * Returns the authenticated user's personal space (used to obtain the LUID that a workbook is
   * moved into when publishing to personal space).
   *
   * Required scopes: `tableau:content:read`
   *
   * @param siteId - The Tableau site ID
   */
  getPersonalSpace = async ({ siteId }: { siteId: string }): Promise<{ luid: string }> => {
    const response = await this._apiClient.getPersonalSpace({
      params: { siteId },
      ...this.authHeader,
    });
    return { luid: response.personalSpace.luid };
  };

  /**
   * Publishes a workbook file (.twbx or .twb) to a project on the site in a single request.
   *
   * Personal Space is not a valid publish target — the REST API only publishes into a project.
   * To land a workbook in personal space, publish to a project (typically the site's default
   * project) and then call {@link moveWorkbookToPersonalSpace}. That move is not currently wired
   * up by the publish tools (an omitted projectId publishes to the default project), but the method
   * is retained here for when personal-space publish is re-enabled. Files above the
   * single-request size limit require the File Upload session flow, which is not implemented here
   * (the initial use case is small workbooks well under the limit).
   *
   * Required scopes (Tableau Cloud): `tableau:workbooks:create`
   *
   * @param siteId - The Tableau site ID
   * @param projectId - The LUID of the project to publish into
   * @param name - The name to give the published workbook
   * @param fileName - The file name (with extension) sent in the multipart part
   * @param workbookType - `twbx` or `twb`
   * @param fileContents - The raw bytes of the workbook file
   * @param showTabs - Whether the workbook shows sheets as tabs
   * @param overwrite - Overwrite an existing workbook of the same name in the project
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#publish_workbook
   */
  publishWorkbook = async ({
    siteId,
    projectId,
    name,
    fileName,
    workbookType,
    fileContents,
    showTabs = true,
    overwrite = false,
  }: {
    siteId: string;
    projectId: string;
    name: string;
    fileName: string;
    workbookType: 'twbx' | 'twb';
    fileContents: Buffer;
    showTabs?: boolean;
    overwrite?: boolean;
  }): Promise<PublishedWorkbook> => {
    const xmlPayload =
      '<tsRequest>' +
      `<workbook name="${escapeXmlAttr(name)}" showTabs="${showTabs ? 'true' : 'false'}">` +
      `<project id="${escapeXmlAttr(projectId)}"/>` +
      '</workbook>' +
      '</tsRequest>';

    const boundary = `----tableau-mcp-boundary-${siteId}`;
    const body = buildMultipartMixedBody({
      boundary,
      xmlPayload,
      fileName,
      fileContents,
    });

    const authHeaders = this.authHeader.headers;
    const response = await this._apiClient.axios.request({
      method: 'post',
      url: `/sites/${siteId}/workbooks`,
      params: { workbookType, overwrite: overwrite ? 'true' : 'false' },
      data: body,
      headers: {
        ...authHeaders,
        'Content-Type': `multipart/mixed; boundary=${boundary}`,
        // Tableau honors Accept and returns JSON, matching the rest of the SDK.
        Accept: 'application/json',
      },
      // The body is a raw Buffer; prevent axios from trying to transform/serialize it.
      transformRequest: [(d) => d],
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return publishedWorkbookSchema.parse(response.data?.workbook);
  };

  /**
   * Moves an already-published workbook into the given personal space.
   *
   * `<location>` and `<project>` are mutually exclusive on the workbook element — we send only the
   * location here. The project-to-project move (send `project` instead) uses the same endpoint.
   *
   * Required scopes (Tableau Cloud): `tableau:workbooks:update`
   *
   * @param siteId - The Tableau site ID
   * @param workbookId - The LUID of the workbook to move
   * @param personalSpaceLuid - The LUID of the destination personal space
   */
  moveWorkbookToPersonalSpace = async ({
    siteId,
    workbookId,
    personalSpaceLuid,
  }: {
    siteId: string;
    workbookId: string;
    personalSpaceLuid: string;
  }): Promise<{ id: string }> => {
    const response = await this._apiClient.updateWorkbook(
      { workbook: { location: { id: personalSpaceLuid, type: 'PersonalSpace' } } },
      {
        params: { siteId, workbookId },
        ...this.authHeader,
      },
    );
    return { id: response.workbook.id };
  };
}

/**
 * Builds a multipart/mixed body containing the tsRequest XML part and the workbook file part, in
 * the two-part layout Tableau's publish endpoint expects. Returns a Buffer so binary file bytes are
 * preserved exactly (a string body would corrupt them under UTF-8 re-encoding).
 */
function buildMultipartMixedBody({
  boundary,
  xmlPayload,
  fileName,
  fileContents,
}: {
  boundary: string;
  xmlPayload: string;
  fileName: string;
  fileContents: Buffer;
}): Buffer {
  const CRLF = '\r\n';
  const preamble =
    `--${boundary}${CRLF}` +
    `Content-Disposition: name="${XML_PART_NAME}"${CRLF}` +
    `Content-Type: text/xml${CRLF}${CRLF}` +
    `${xmlPayload}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: name="${FILE_PART_NAME}"; filename="${fileName}"${CRLF}` +
    `Content-Type: application/octet-stream${CRLF}${CRLF}`;
  const epilogue = `${CRLF}--${boundary}--${CRLF}`;

  return Buffer.concat([
    Buffer.from(preamble, 'utf-8'),
    fileContents,
    Buffer.from(epilogue, 'utf-8'),
  ]);
}
