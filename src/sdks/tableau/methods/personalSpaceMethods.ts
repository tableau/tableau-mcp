import { AxiosRequestConfig } from '../../../utils/axios.js';
import { createGuardedZodios } from '../../routeSafety/zodios.js';
import { personalSpaceApis } from '../apis/personalSpaceApi.js';
import { RestApiCredentials } from '../restApi.js';
import { PersonalSpace } from '../types/personalSpace.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Personal Space methods of the Tableau Server REST API
 *
 * @export
 * @class PersonalSpaceMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm
 */
export default class PersonalSpaceMethods extends AuthenticatedMethods<typeof personalSpaceApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(createGuardedZodios(baseUrl, personalSpaceApis, { axiosConfig }), creds);
  }

  /**
   * Returns the calling user's Personal Space on the specified site.
   *
   * Required scopes: `tableau:projects:read`
   *
   * @param siteId - The Tableau site ID
   */
  getPersonalSpace = async ({ siteId }: { siteId: string }): Promise<PersonalSpace> => {
    return (
      await this._apiClient.getPersonalSpace({
        params: { siteId },
        ...this.authHeader,
      })
    ).personalSpace;
  };
}
