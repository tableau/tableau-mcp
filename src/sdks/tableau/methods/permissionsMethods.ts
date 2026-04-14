import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { permissionsApis } from '../apis/permissionsApi.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/** Granular content types (Ask Data / lenses excluded). */
export type GranularPermissionKind =
  | 'collection'
  | 'datasource'
  | 'project'
  | 'view'
  | 'virtualconnection'
  | 'workbook';

/** Default permission URI segments under a project (lenses excluded — Ask Data). */
export type DefaultPermissionSegment =
  | 'workbooks'
  | 'datasources'
  | 'dataroles'
  | 'metrics'
  | 'flows'
  | 'virtualconnections'
  | 'databases'
  | 'tables';

/** POST replace-project-default-permissions resource segments (per REST API 3.23+). */
export type ReplaceProjectDefaultSegment =
  | 'dataroles'
  | 'databases'
  | 'datasources'
  | 'flows'
  | 'tables'
  | 'workbooks';

/** POST replace-content-permissions targets. */
export type ReplaceContentKind = 'datasource' | 'flow' | 'project' | 'view' | 'workbook';

export type GranteePathKind = 'users' | 'groups';

function granularPermissionsPath(
  siteId: string,
  kind: GranularPermissionKind,
  resourceId: string,
): string {
  switch (kind) {
    case 'collection':
      return `/sites/${siteId}/collections/${resourceId}/permissions`;
    case 'datasource':
      return `/sites/${siteId}/datasources/${resourceId}/permissions`;
    case 'project':
      return `/sites/${siteId}/projects/${resourceId}/permissions`;
    case 'view':
      return `/sites/${siteId}/views/${resourceId}/permissions`;
    case 'virtualconnection':
      return `/sites/${siteId}/virtualconnections/${resourceId}/permissions`;
    case 'workbook':
      return `/sites/${siteId}/workbooks/${resourceId}/permissions`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function defaultPermissionsBasePath(
  siteId: string,
  projectId: string,
  segment: DefaultPermissionSegment,
): string {
  return `/sites/${siteId}/projects/${projectId}/default-permissions/${segment}`;
}

function replaceContentPath(siteId: string, kind: ReplaceContentKind, resourceId: string): string {
  switch (kind) {
    case 'datasource':
      return `/sites/${siteId}/datasources/${resourceId}/permissions`;
    case 'flow':
      return `/sites/${siteId}/flows/${resourceId}/permissions`;
    case 'project':
      return `/sites/${siteId}/projects/${resourceId}/permissions`;
    case 'view':
      return `/sites/${siteId}/views/${resourceId}/permissions`;
    case 'workbook':
      return `/sites/${siteId}/workbooks/${resourceId}/permissions`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Tableau REST API — Permissions Methods (Ask Data / lens endpoints omitted).
 *
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_permissions.htm
 */
export default class PermissionsMethods extends AuthenticatedMethods<typeof permissionsApis> {
  constructor(baseUrl: string, creds: Credentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, permissionsApis, { axiosConfig }), creds);
  }

  private jsonHeaders(): AxiosRequestConfig {
    return {
      ...this.authHeader,
      headers: {
        ...this.authHeader.headers,
        Accept: 'application/json',
      },
    };
  }

  private jsonWriteHeaders(): AxiosRequestConfig {
    return {
      ...this.authHeader,
      headers: {
        ...this.authHeader.headers,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
  }

  listGranularPermissions = async (
    siteId: string,
    kind: GranularPermissionKind,
    resourceId: string,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.get(
        granularPermissionsPath(siteId, kind, resourceId),
        this.jsonHeaders(),
      )
    ).data;

  addGranularPermissions = async (
    siteId: string,
    kind: GranularPermissionKind,
    resourceId: string,
    body: unknown,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.put(
        granularPermissionsPath(siteId, kind, resourceId),
        body,
        this.jsonWriteHeaders(),
      )
    ).data;

  deleteGranularPermission = async (
    siteId: string,
    kind: GranularPermissionKind,
    resourceId: string,
    grantee: GranteePathKind,
    granteeId: string,
    capabilityName: string,
    capabilityMode: string,
  ): Promise<unknown> => {
    const base = granularPermissionsPath(siteId, kind, resourceId);
    const path = `${base}/${grantee}/${granteeId}/${encodeURIComponent(capabilityName)}/${encodeURIComponent(capabilityMode)}`;
    return (await this._apiClient.axios.delete(path, this.jsonHeaders())).data;
  };

  listDefaultPermissions = async (
    siteId: string,
    projectId: string,
    segment: DefaultPermissionSegment,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.get(
        defaultPermissionsBasePath(siteId, projectId, segment),
        this.jsonHeaders(),
      )
    ).data;

  addDefaultPermissions = async (
    siteId: string,
    projectId: string,
    segment: DefaultPermissionSegment,
    body: unknown,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.put(
        defaultPermissionsBasePath(siteId, projectId, segment),
        body,
        this.jsonWriteHeaders(),
      )
    ).data;

  deleteDefaultPermission = async (
    siteId: string,
    projectId: string,
    segment: DefaultPermissionSegment,
    grantee: GranteePathKind,
    granteeId: string,
    capabilityName: string,
    capabilityMode: string,
  ): Promise<unknown> => {
    const base = defaultPermissionsBasePath(siteId, projectId, segment);
    const path = `${base}/${grantee}/${granteeId}/${encodeURIComponent(capabilityName)}/${encodeURIComponent(capabilityMode)}`;
    return (await this._apiClient.axios.delete(path, this.jsonHeaders())).data;
  };

  replaceProjectDefaultPermissions = async (
    siteId: string,
    projectId: string,
    segment: ReplaceProjectDefaultSegment,
    body: unknown,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.post(
        `/sites/${siteId}/projects/${projectId}/default-permissions/${segment}`,
        body,
        this.jsonWriteHeaders(),
      )
    ).data;

  replaceContentPermissions = async (
    siteId: string,
    kind: ReplaceContentKind,
    resourceId: string,
    body: unknown,
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.post(
        replaceContentPath(siteId, kind, resourceId),
        body,
        this.jsonWriteHeaders(),
      )
    ).data;
}
