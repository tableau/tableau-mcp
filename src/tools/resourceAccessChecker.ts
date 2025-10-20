import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { BoundedContext, Config, getConfig } from '../config.js';
import { useRestApi } from '../restApiInstance.js';
import { Server } from '../server.js';

type AllowedResult = { cache: boolean } & ({ allowed: true } | { allowed: false; message: string });
type RestApiArgs = {
  config: Config;
  requestId: RequestId;
  server: Server;
};

class ResourceAccessChecker {
  private readonly _allowedProjectIds: Set<string> | null;
  private readonly _allowedDatasourceIds: Set<string> | null;
  private readonly _allowedWorkbookIds: Set<string> | null;

  private readonly _knownDatasourceIds: Map<string, AllowedResult>;
  private readonly _knownWorkbookIds: Map<string, AllowedResult>;
  private readonly _knownViewIds: Map<string, AllowedResult>;

  constructor(boundedContext: BoundedContext) {
    this._allowedProjectIds = boundedContext.projectIds;
    this._allowedDatasourceIds = boundedContext.datasourceIds;
    this._allowedWorkbookIds = boundedContext.workbookIds;

    this._knownDatasourceIds = new Map();
    this._knownWorkbookIds = new Map();
    this._knownViewIds = new Map();
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

    if (result.cache) {
      this._knownDatasourceIds.set(datasourceLuid, result);
    }

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

    if (result.cache) {
      this._knownWorkbookIds.set(workbookId, result);
    }

    return result;
  }

  async isViewAllowed({
    viewId,
    restApiArgs,
  }: {
    viewId: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    const result = await this._isViewAllowed({
      viewId,
      restApiArgs,
    });

    if (result.cache) {
      this._knownViewIds.set(viewId, result);
    }

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
        cache: true,
        message: [
          'The set of allowed data sources that can be queried is limited by the server configuration.',
          `Querying the datasource with LUID ${datasourceLuid} is not allowed.`,
        ].join(' '),
      };
    }

    let cache = true;
    if (this._allowedProjectIds) {
      let allowed = false;
      if (this._allowedProjectIds.size > 0) {
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

        // Do not cache since the datasource may be moved between projects after this check.
        cache = false;
        allowed = this._allowedProjectIds.has(datasourceProjectId);
      }

      if (!allowed) {
        return {
          allowed: false,
          cache,
          message: [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
            `Querying the datasource with LUID ${datasourceLuid} is not allowed because it does not belong to an allowed project.`,
          ].join(' '),
        };
      }
    }

    return { allowed: true, cache };
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
        cache: true,
        message: [
          'The set of allowed workbooks that can be queried is limited by the server configuration.',
          `Querying the workbook with LUID ${workbookId} is not allowed.`,
        ].join(' '),
      };
    }

    let cache = true;
    if (this._allowedProjectIds) {
      let allowed = false;
      if (this._allowedProjectIds.size > 0) {
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

        // Do not cache since the workbook may be moved between projects after this check.
        cache = false;
        allowed = this._allowedProjectIds.has(workbookProjectId);
      }

      if (!allowed) {
        return {
          allowed: false,
          cache,
          message: [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
            `Querying the workbook with LUID ${workbookId} is not allowed because it does not belong to an allowed project.`,
          ].join(' '),
        };
      }
    }

    return { allowed: true, cache };
  }

  private async _isViewAllowed({
    viewId,
    restApiArgs: { config, requestId, server },
  }: {
    viewId: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    let viewWorkbookId = '';
    let viewProjectId = '';

    if (this._allowedWorkbookIds) {
      let allowed = false;
      if (this._allowedWorkbookIds.size > 0) {
        const view = await useRestApi({
          config,
          requestId,
          server,
          jwtScopes: ['tableau:content:read'],
          callback: async (restApi) => {
            return await restApi.viewsMethods.getView({
              siteId: restApi.siteId,
              viewId,
            });
          },
        });

        viewWorkbookId = view.workbook?.id ?? '';
        viewProjectId = view.project?.id ?? '';

        allowed = this._allowedWorkbookIds.has(viewWorkbookId);
      }

      if (!allowed) {
        return {
          allowed: false,
          // A view cannot be moved between workbooks so caching is safe.
          cache: true,
          message: [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
            `Querying the view with LUID ${viewId} is not allowed because it does not belong to an allowed workbook.`,
          ].join(' '),
        };
      }
    }

    if (this._allowedProjectIds) {
      let allowed = false;
      if (this._allowedProjectIds.size > 0) {
        viewProjectId =
          viewProjectId ||
          (await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:content:read'],
            callback: async (restApi) => {
              const view = await restApi.viewsMethods.getView({
                siteId: restApi.siteId,
                viewId,
              });

              return view.project?.id ?? '';
            },
          }));

        allowed = this._allowedProjectIds.has(viewProjectId);
      }

      if (!allowed) {
        return {
          allowed: false,
          // A view cannot be moved between projects so caching is safe.
          cache: true,
          message: [
            'The set of allowed projects that can be queried is limited by the server configuration.',
            `Querying the view with LUID ${viewId} is not allowed because it does not belong to an allowed project.`,
          ].join(' '),
        };
      }
    }

    return { allowed: true, cache: true };
  }
}

const resourceAccessChecker = new ResourceAccessChecker(getConfig().boundedContext);
export { resourceAccessChecker };
