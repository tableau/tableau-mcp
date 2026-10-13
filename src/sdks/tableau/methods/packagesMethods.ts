import { AxiosRequestConfig } from '../../../utils/axios.js';
import { createGuardedZodios } from '../../routeSafety/zodios.js';
import { packagesApis } from '../apis/packagesApi.js';
import { RestApiCredentials } from '../restApi.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Experimental packages methods of the Tableau Server REST API.
 *
 * Like {@link FlowDocumentMethods}, this class is constructed with the
 * `${host}/api/exp` base URL so it can reach the experimental packages endpoints.
 *
 * @export
 * @class PackagesMethods
 */
export default class PackagesMethods extends AuthenticatedMethods<typeof packagesApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(createGuardedZodios(baseUrl, packagesApis, { axiosConfig }), creds);
  }

  /**
   * Returns the site's external allowed-origins allow-list for extension packages.
   *
   * Experimental: `GET {host}/api/exp/sites/:siteId/packages/allowed-origins`.
   *
   * Required scopes: `tableau:packages:read`
   *
   * @param siteId - The Tableau site ID
   */
  getAllowedOrigins = async ({ siteId }: { siteId: string }): Promise<string[]> => {
    const result = await this._apiClient.getAllowedOrigins({
      params: { siteId },
      ...this.authHeader,
    });
    return result.extensionPackageAllowedOrigins?.origin ?? [];
  };
}
