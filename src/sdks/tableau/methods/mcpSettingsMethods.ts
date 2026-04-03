import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { mcpSettingsApis } from '../apis/mcpSettingsApi.js';
import { RestApiCredentials } from '../restApi.js';
import { McpSiteSettingsResult } from '../types/mcpSiteSettings.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * MCP Settings methods of the Tableau Server REST API
 *
 * @export
 * @class McpSettingsMethods
 * @link TODO: add link to documentation
 */
export default class McpSettingsMethods extends AuthenticatedMethods<typeof mcpSettingsApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, mcpSettingsApis, { axiosConfig }), creds);
  }

  /**
   * Returns Tableau MCP settings overrides for a site.
   *
   * Required scopes: `tableau:mcp_site_settings:read`
   *
   * @param {string} siteId - The Tableau site ID
   * @link TODO: add link to documentation
   */
  getMcpSiteSettings = async ({ siteId }: { siteId: string }): Promise<McpSiteSettingsResult> => {
    return (
      await this._apiClient.getMcpSiteSettings({
        params: { siteId },
        ...this.authHeader,
      })
    ).mcpSiteSettings;
  };
}
