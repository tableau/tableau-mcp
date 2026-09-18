import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { flowDocumentApis } from '../apis/flowDocumentApi.js';
import { RestApiCredentials } from '../restApi.js';
import { FlowDocument } from '../types/flowDocument.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Experimental flow-document method of the Tableau Server REST API.
 *
 * Unlike {@link FlowsMethods} (which targets the versioned `/api/3.x` path), this
 * class is constructed with the `${host}/api/exp` base URL so it can reach the
 * experimental document endpoint.
 *
 * @export
 * @class FlowDocumentMethods
 */
export default class FlowDocumentMethods extends AuthenticatedMethods<typeof flowDocumentApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, flowDocumentApis, { axiosConfig }), creds);
  }

  /**
   * Returns the specified flow's document as sanitized JSON.
   *
   * Experimental: `GET {host}/api/exp/sites/:siteId/flows/:flowId/document`.
   * The response has credential/secret connection attributes and Tableau
   * identity attributes removed and email-shaped PII redacted server-side.
   *
   * Required scopes: `tableau:flows:download`
   *
   * @param siteId - The Tableau site ID
   * @param flowId - The LUID of the flow to return the document for
   */
  getFlowDocument = async ({
    siteId,
    flowId,
  }: {
    siteId: string;
    flowId: string;
  }): Promise<FlowDocument> => {
    return await this._apiClient.getFlowDocument({
      params: { siteId, flowId },
      ...this.authHeader,
    });
  };
}
