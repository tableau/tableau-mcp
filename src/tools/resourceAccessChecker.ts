import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { BoundedContext, Config, getConfig } from '../config.js';
import { useRestApi } from '../restApiInstance.js';
import { Server } from '../server.js';

type AllowedResult = { allowed: true } | { allowed: false; message: string };
type RestApiArgs = {
  config: Config;
  requestId: RequestId;
  server: Server;
};

class ResourceAccessChecker {
  private readonly _allowedProjectIds: Set<string> | null;
  private readonly _allowedDatasourceIds: Set<string> | null;
  private readonly _allowedWorkbookIds: Set<string> | null;

  private readonly _knownProjectIds: Map<string, AllowedResult>;
  private readonly _knownDatasourceIds: Map<string, AllowedResult>;
  private readonly _knownWorkbookIds: Map<string, AllowedResult>;

  constructor(boundedContext: BoundedContext) {
    this._allowedProjectIds = boundedContext.projectIds;
    this._allowedDatasourceIds = boundedContext.datasourceIds;
    this._allowedWorkbookIds = boundedContext.workbookIds;

    this._knownProjectIds = new Map();
    this._knownDatasourceIds = new Map();
    this._knownWorkbookIds = new Map();
  }

  async isDatasourceAllowed({
    datasourceLuid,
    restApiArgs,
  }: {
    datasourceLuid: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    const result = await this._isDatasourceAllowed({
      datasourceLuid,
      restApiArgs,
    });

    this._knownDatasourceIds.set(datasourceLuid, result);
    return result;
  }

  async isWorkbookAllowed({
    workbookId,
    restApiArgs,
  }: {
    workbookId: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    const result = await this._isWorkbookAllowed({
      workbookId,
      restApiArgs,
    });

    this._knownWorkbookIds.set(workbookId, result);
    return result;
  }

  private async _isDatasourceAllowed({
    datasourceLuid,
    restApiArgs: { config, requestId, server },
  }: {
    datasourceLuid: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    if (this._knownDatasourceIds.has(datasourceLuid)) {
      return this._knownDatasourceIds.get(datasourceLuid)!;
    }

    if (this._allowedDatasourceIds && !this._allowedDatasourceIds.has(datasourceLuid)) {
      return {
        allowed: false,
        message: [
          'The set of allowed data sources that can be queried is limited by the server configuration.',
          `Querying the datasource with LUID ${datasourceLuid} is not allowed.`,
        ].join(' '),
      };
    }

    if (this._allowedProjectIds) {
      let allowed = this._allowedProjectIds.size > 0;
      if (allowed) {
        const datasourceProjectId = await useRestApi({
          config,
          requestId,
          server,
          jwtScopes: ['tableau:content:read'],
          callback: async (restApi) => {
            const datasource = await restApi.datasourcesMethods.queryDatasource({
              siteId: restApi.siteId,
              datasourceId: datasourceLuid,
            });

            return datasource.project.id;
          },
        });
        allowed = this._allowedProjectIds.has(datasourceProjectId);
      }

      if (!allowed) {
        return {
          allowed: false,
          message: [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
            `Querying the datasource with LUID ${datasourceLuid} is not allowed because it does not belong to an allowed project.`,
          ].join(' '),
        };
      }
    }

    return { allowed: true };
  }

  private async _isWorkbookAllowed({
    workbookId,
    restApiArgs: { config, requestId, server },
  }: {
    workbookId: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    if (this._allowedWorkbookIds && !this._allowedWorkbookIds.has(workbookId)) {
      return {
        allowed: false,
        message: [
          'The set of allowed workbooks that can be queried is limited by the server configuration.',
          `Querying the workbook with LUID ${workbookId} is not allowed.`,
        ].join(' '),
      };
    }

    if (this._allowedProjectIds) {
      let allowed = this._allowedProjectIds.size > 0;
      if (allowed) {
        const workbookProjectId = await useRestApi({
          config,
          requestId,
          server,
          jwtScopes: ['tableau:content:read'],
          callback: async (restApi) => {
            const workbook = await restApi.workbooksMethods.getWorkbook({
              siteId: restApi.siteId,
              workbookId,
            });

            return workbook.project?.id ?? '';
          },
        });

        allowed = this._allowedProjectIds.has(workbookProjectId);
      }

      if (!allowed) {
        return {
          allowed: false,
          message: [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
            `Querying the workbook with LUID ${workbookId} is not allowed because it does not belong to an allowed project.`,
          ].join(' '),
        };
      }
    }

    return { allowed: true };
  }
}

const resourceAccessChecker = new ResourceAccessChecker(getConfig().boundedContext);
export { resourceAccessChecker };
