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
    // The destination the server actually recorded: `type` is 'Project' or 'PersonalSpace'. Used to
    // confirm a personal-space publish truly landed there — servers without REST personal-space
    // support silently ignore the `<location>` and return a Project landing with a 201.
    location: z
      .object({
        id: z.string().optional(),
        type: z.string().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    // The views the server materialized for the freshly published workbook. A successful
    // single-request publish returns them inline (see the REST publish_workbook reference's
    // `<views>` block). The first view's `contentUrl` is
    // what toPublishResult turns into the canonical `url` (the workbook's opening sheet).
    views: z
      .object({
        // `.optional()` on the inner array too — not just the outer object — so a present-but-empty
        // `<views/>` element (view key absent) still parses. Honors this schema's leniency contract
        // ("publishing never fails validation over a view attribute we don't read"); the consumer
        // reads it as `published.views?.view?.find(...)` and falls back to the workbook URL.
        view: z
          .array(
            z
              .object({
                id: z.string().optional(),
                name: z.string().optional(),
                contentUrl: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
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
 * @export
 * @class PublishingMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#publish_workbook
 */
export default class PublishingMethods extends AuthenticatedMethods<typeof publishingApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, publishingApis, { axiosConfig }), creds);
  }

  /**
   * Returns the authenticated user's personal space (used to obtain the LUID that a personal-space
   * publish targets via `publishWorkbook`'s `location`).
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
   * Publishes a workbook file (.twbx or .twb) to the site in a single request.
   *
   * The destination is exactly one of:
   * - `projectId` — publish into that project (emits `<project id=.../>`).
   * - `location` — publish directly into the caller's personal space, i.e.
   *   `{ id: <personal-space-luid>, type: 'PersonalSpace' }` (emits `<location id=... type=.../>`).
   *
   * Required scopes (Tableau Cloud): `tableau:workbooks:create`
   *
   * @param siteId - The Tableau site ID
   * @param projectId - The LUID of the project to publish into (mutually exclusive with `location`)
   * @param location - Personal-space destination `{ id, type: 'PersonalSpace' }` (mutually exclusive with `projectId`)
   * @param name - The name to give the published workbook
   * @param fileName - The file name (with extension) sent in the multipart part
   * @param workbookType - `twbx` or `twb`
   * @param fileContents - The raw bytes of the workbook file
   * @param showTabs - Whether the workbook shows sheets as tabs
   * @param overwrite - Overwrite an existing workbook of the same name in the destination
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#publish_workbook
   */
  publishWorkbook = async ({
    siteId,
    projectId,
    location,
    name,
    fileName,
    workbookType,
    fileContents,
    showTabs = true,
    overwrite = false,
  }: {
    siteId: string;
    projectId?: string;
    location?: { id: string; type: 'PersonalSpace' };
    name: string;
    fileName: string;
    workbookType: 'twbx' | 'twb';
    fileContents: Buffer;
    showTabs?: boolean;
    overwrite?: boolean;
  }): Promise<PublishedWorkbook> => {
    if ((projectId === undefined) === (location === undefined)) {
      throw new Error('publishWorkbook requires exactly one of `projectId` or `location`.');
    }
    const destination =
      projectId !== undefined
        ? `<project id="${escapeXmlAttr(projectId)}"/>`
        : `<location id="${escapeXmlAttr(location!.id)}" type="${escapeXmlAttr(location!.type)}"/>`;
    const xmlPayload =
      '<tsRequest>' +
      `<workbook name="${escapeXmlAttr(name)}" showTabs="${showTabs ? 'true' : 'false'}">` +
      destination +
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
