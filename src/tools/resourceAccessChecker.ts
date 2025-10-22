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

  private readonly _cachedDatasourceIds: Map<string, AllowedResult>;
  private readonly _cachedWorkbookIds: Map<string, AllowedResult>;
  private readonly _cachedViewIds: Map<string, AllowedResult>;

  constructor(boundedContext: BoundedContext) {
    // The methods assume these sets are non-empty.
    this._allowedProjectIds = boundedContext.projectIds;
    this._allowedDatasourceIds = boundedContext.datasourceIds;
    this._allowedWorkbookIds = boundedContext.workbookIds;

    this._cachedDatasourceIds = new Map();
    this._cachedWorkbookIds = new Map();
    this._cachedViewIds = new Map();
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

    if (!this._allowedProjectIds) {
      // If project filtering is enabled, we cannot cache the result since the datasource may be moved between projects.
      this._cachedDatasourceIds.set(datasourceLuid, result);
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

    if (!this._allowedProjectIds) {
      // If project filtering is enabled, we cannot cache the result since the workbook may be moved between projects.
      this._cachedWorkbookIds.set(workbookId, result);
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

    if (!this._allowedProjectIds) {
      // If project filtering is enabled, we cannot cache the result since the workbook containing the view may be moved between projects.
      this._cachedViewIds.set(viewId, result);
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
    const cachedResult = this._cachedDatasourceIds.get(datasourceLuid);
    if (cachedResult) {
      return cachedResult;
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

      if (!this._allowedProjectIds.has(datasourceProjectId)) {
        return {
          allowed: false,
          message: [
            'The set of allowed projects that can be queried is limited by the server configuration.',
            `The datasource with LUID ${datasourceLuid} cannot be queried because it does not belong to an allowed project.`,
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
    const cachedResult = this._cachedWorkbookIds.get(workbookId);
    if (cachedResult) {
      return cachedResult;
    }

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

      if (!this._allowedProjectIds.has(workbookProjectId)) {
        return {
          allowed: false,
          message: [
            'The set of allowed projects that can be queried is limited by the server configuration.',
            `The workbook with LUID ${workbookId} cannot be queried because it does not belong to an allowed project.`,
          ].join(' '),
        };
      }
    }

    return { allowed: true };
  }

  private async _isViewAllowed({
    viewId,
    restApiArgs: { config, requestId, server },
  }: {
    viewId: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    const cachedResult = this._cachedViewIds.get(viewId);
    if (cachedResult) {
      return cachedResult;
    }

    let viewWorkbookId = '';
    let viewProjectId = '';

    if (this._allowedWorkbookIds) {
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

      if (!this._allowedWorkbookIds.has(viewWorkbookId)) {
        return {
          allowed: false,
          message: [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
            `The view with LUID ${viewId} cannot be queried because it does not belong to an allowed workbook.`,
          ].join(' '),
        };
      }
    }

    if (this._allowedProjectIds) {
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

      if (!this._allowedProjectIds.has(viewProjectId)) {
        return {
          allowed: false,
          message: [
            'The set of allowed projects that can be queried is limited by the server configuration.',
            `The view with LUID ${viewId} cannot be queried because it does not belong to an allowed project.`,
          ].join(' '),
        };
      }
    }

    return { allowed: true };
  }
}

const resourceAccessChecker = new ResourceAccessChecker(getConfig().boundedContext);
const exportedForTesting = { ResourceAccessChecker };
export { exportedForTesting, resourceAccessChecker };
