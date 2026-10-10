import { isErrorFromAlias, Zodios } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { datasourcesApis } from '../apis/datasourcesApi.js';
import { escapeXmlAttribute } from '../escapeXmlAttribute.js';
import { buildMultipartMixedBody } from '../multipart.js';
import { RestApiCredentials } from '../restApi.js';
import { DataSource, PublishedDataSource } from '../types/dataSource.js';
import { Pagination } from '../types/pagination.js';
import { GranteeCapability } from '../types/permissions.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Data Sources methods of the Tableau Server REST API
 *
 * @export
 * @class DatasourcesMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm
 */
export default class DatasourcesMethods extends AuthenticatedMethods<typeof datasourcesApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, datasourcesApis, { axiosConfig }), creds);
  }

  /**
   * Returns a list of published data sources on the specified site.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param siteId - The Tableau site ID
   * @param filter - The filter string to filter datasources by
   * @param pageSize - The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.
   * @param pageNumber - The offset for paging. The default is 1.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources
   */
  listDatasources = async ({
    siteId,
    filter,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    filter: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<{ pagination: Pagination; datasources: PublishedDataSource[] }> => {
    const response = await this._apiClient.listDatasources({
      params: { siteId },
      queries: { filter, pageSize, pageNumber },
      ...this.authHeader,
    });
    return {
      pagination: response.pagination,
      datasources: response.datasources.datasource ?? [],
    };
  };

  /**
   * Returns information about the specified data source.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param siteId - The Tableau site ID
   * @param datasourceId - The ID of the data source
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source
   */
  queryDatasource = async ({
    siteId,
    datasourceId,
  }: {
    siteId: string;
    datasourceId: string;
  }): Promise<DataSource> => {
    return (
      await this._apiClient.queryDatasource({
        params: { siteId, datasourceId },
        ...this.authHeader,
      })
    ).datasource;
  };

  /**
   * Result-returning variant of {@link queryDatasource} for classifying a data source. Resolves to
   * the DataSource on success — callers classify published vs embedded from its shape, since
   * WBDS-enabled servers return embedded (workbook) data sources here too (HTTP 200, with
   * `parentType: "Workbook"` and no `project`). Older servers that don't serve embedded data sources
   * via REST return 404 instead, mapped to `Err('not-found')`; for a LUID VDS can otherwise resolve,
   * that too means embedded. Any other failure (permissions, transient) returns `Err('error')`
   * instead of throwing, so callers using this purely to classify don't break on non-authoritative
   * errors.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param siteId - The Tableau site ID
   * @param datasourceId - The ID of the data source
   */
  tryQueryDatasource = async ({
    siteId,
    datasourceId,
  }: {
    siteId: string;
    datasourceId: string;
  }): Promise<Result<DataSource, 'not-found' | 'error'>> => {
    try {
      return Ok(
        (
          await this._apiClient.queryDatasource({
            params: { siteId, datasourceId },
            ...this.authHeader,
          })
        ).datasource,
      );
    } catch (error) {
      if (
        isErrorFromAlias(this._apiClient.api, 'queryDatasource', error) &&
        error.response.status === 404
      ) {
        return Err('not-found');
      }
      return Err('error');
    }
  };

  /**
   * Deletes the specified published data source from the site.
   *
   * On Tableau Cloud the data source is moved to the recycle bin and can be restored
   * for a limited time before permanent removal.
   *
   * Required scopes (Tableau Cloud): `tableau:datasources:delete`
   *
   * @param datasourceId - The ID of the data source to delete.
   * @param siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#delete_data_source
   */
  deleteDatasource = async ({
    datasourceId,
    siteId,
  }: {
    datasourceId: string;
    siteId: string;
  }): Promise<void> => {
    await this._apiClient.deleteDatasource(undefined, {
      params: { siteId, datasourceId },
      ...this.authHeader,
    });
  };

  /**
   * Adds one or more tags to the specified data source.
   *
   * Required scopes (Tableau Cloud): `tableau:datasource_tags:update`
   *
   * @param datasourceId - The ID of the data source to tag.
   * @param siteId - The Tableau site ID
   * @param tagLabels - The tag labels to add.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#add_tags_to_data_source
   */
  addTagsToDatasource = async ({
    datasourceId,
    siteId,
    tagLabels,
  }: {
    datasourceId: string;
    siteId: string;
    tagLabels: ReadonlyArray<string>;
  }): Promise<void> => {
    await this._apiClient.addTagsToDatasource(
      { tags: { tag: tagLabels.map((label) => ({ label })) } },
      {
        params: { siteId, datasourceId },
        ...this.authHeader,
      },
    );
  };

  /**
   * Returns the permissions (grantee capabilities) configured on the specified data source.
   *
   * Required scopes (Tableau Cloud): `tableau:permissions:read`
   *
   * @param datasourceId - The ID of the data source
   * @param siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_permissions.htm#query_data_source_permissions
   */
  queryDatasourcePermissions = async ({
    datasourceId,
    siteId,
  }: {
    datasourceId: string;
    siteId: string;
  }): Promise<GranteeCapability[]> => {
    const response = await this._apiClient.queryDatasourcePermissions({
      params: { siteId, datasourceId },
      ...this.authHeader,
    });
    return response.permissions.granteeCapabilities ?? [];
  };

  /**
   * Publishes a .tdsx or .hyper staged in an upload session as an asynchronous job
   * (`asJob=true`), returning the job id to poll with `jobsMethods.getJob`. The job result does
   * not include the new data source's LUID; look it up by name and project once the job succeeds.
   *
   * Required scopes (Tableau Cloud): `tableau:datasources:create`
   *
   * @param siteId - The Tableau site ID
   * @param uploadSessionId - The upload session holding the file bytes
   * @param datasourceType - The uploaded file's type
   * @param name - The name to give the published data source
   * @param projectId - The LUID of the destination project
   * @param description - Optional data source description
   * @param overwrite - Whether to replace a data source with the same name in the project
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#publish_data_source
   */
  publishDatasourceAsJob = async ({
    siteId,
    uploadSessionId,
    datasourceType,
    name,
    projectId,
    description,
    overwrite,
  }: {
    siteId: string;
    uploadSessionId: string;
    datasourceType: 'tdsx' | 'hyper';
    name: string;
    projectId: string;
    description?: string;
    overwrite: boolean;
  }): Promise<{ jobId: string }> => {
    const descriptionAttribute =
      description !== undefined ? ` description="${escapeXmlAttribute(description)}"` : '';
    const xml =
      `<tsRequest><datasource name="${escapeXmlAttribute(name)}"${descriptionAttribute}>` +
      `<project id="${escapeXmlAttribute(projectId)}"/>` +
      '</datasource></tsRequest>';
    const { body, contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: xml },
    ]);

    const response = await this._apiClient.axios.post(
      `${this._apiClient.axios.defaults.baseURL}/sites/${siteId}/datasources`,
      body,
      {
        params: { uploadSessionId, datasourceType, overwrite, asJob: true },
        headers: {
          Accept: 'application/json',
          'Content-Type': contentType,
          ...this.authHeader.headers,
        },
      },
    );

    return { jobId: publishJobResponseSchema.parse(response.data).job.id };
  };
}

const publishJobResponseSchema = z.object({ job: z.object({ id: z.string() }) });
