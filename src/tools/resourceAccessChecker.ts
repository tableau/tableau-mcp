import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { BoundedContext, Config, getConfig } from '../config.js';
import { useRestApi } from '../restApiInstance.js';
import { DataSource } from '../sdks/tableau/types/dataSource.js';
import { View } from '../sdks/tableau/types/view.js';
import { Workbook } from '../sdks/tableau/types/workbook.js';
import { Server } from '../server.js';
import { getRequiredApiScopesForTool } from '../server/oauth/scopes.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';

type AllowedResult<T = unknown> =
  | { allowed: true; content?: T }
  | { allowed: false; message: string };

export type RestApiArgs = {
  config: Config;
  requestId: RequestId;
  server: Server;
  signal: AbortSignal;
};

class ResourceAccessChecker {
  private _allowedProjectIds: Set<string> | null | undefined;
  private _allowedDatasourceIds: Set<string> | null | undefined;
  private _allowedWorkbookIds: Set<string> | null | undefined;
  private _allowedTags: Set<string> | null | undefined;

  private readonly _cachedDatasourceIds: Map<string, AllowedResult>;
  private readonly _cachedWorkbookIds: Map<string, AllowedResult<Workbook>>;
  private readonly _cachedViewIds: Map<string, AllowedResult>;

  static create(): ResourceAccessChecker {
    return new ResourceAccessChecker();
  }

  static createForTesting(boundedContext: BoundedContext): ResourceAccessChecker {
    return new ResourceAccessChecker(boundedContext);
  }

  // Optional bounded context to use for testing.
  private constructor(boundedContext?: BoundedContext) {
    // The methods assume these sets are non-empty.
    this._allowedProjectIds = boundedContext?.projectIds;
    this._allowedDatasourceIds = boundedContext?.datasourceIds;
    this._allowedWorkbookIds = boundedContext?.workbookIds;
    this._allowedTags = boundedContext?.tags;

    this._cachedDatasourceIds = new Map();
    this._cachedWorkbookIds = new Map();
    this._cachedViewIds = new Map();
  }

  private get allowedProjectIds(): Set<string> | null {
    if (this._allowedProjectIds === undefined) {
      this._allowedProjectIds = getConfig().boundedContext.projectIds;
    }

    return this._allowedProjectIds;
  }

  private get allowedDatasourceIds(): Set<string> | null {
    if (this._allowedDatasourceIds === undefined) {
      this._allowedDatasourceIds = getConfig().boundedContext.datasourceIds;
    }

    return this._allowedDatasourceIds;
  }

  private get allowedWorkbookIds(): Set<string> | null {
    if (this._allowedWorkbookIds === undefined) {
      this._allowedWorkbookIds = getConfig().boundedContext.workbookIds;
    }

    return this._allowedWorkbookIds;
  }

  private get allowedTags(): Set<string> | null {
    if (this._allowedTags === undefined) {
      this._allowedTags = getConfig().boundedContext.tags;
    }

    return this._allowedTags;
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

    if (!this.allowedProjectIds && !this.allowedTags) {
      // If project filtering is enabled, we cannot cache the result since the datasource may be moved between projects.
      // If tag filtering is enabled, we cannot cache the result since the datasource tags can change over time.
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
  }): Promise<AllowedResult<Workbook>> {
    const result = await this._isWorkbookAllowed({
      workbookId,
      restApiArgs,
    });

    if (!this.allowedProjectIds && !this.allowedTags) {
      // If project filtering is enabled, we cannot cache the result since the workbook may be moved between projects.
      // If tag filtering is enabled, we cannot cache the result since the workbook tags can change over time.
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

    if (!this.allowedProjectIds && !this.allowedTags) {
      // If project filtering is enabled, we cannot cache the result since the workbook containing the view may be moved between projects.
      // If tag filtering is enabled, we cannot cache the result since the view tags can change over time.
      this._cachedViewIds.set(viewId, result);
    }

    return result;
  }

  private async _isDatasourceAllowed({
    datasourceLuid,
    restApiArgs: { config, requestId, server, signal },
  }: {
    datasourceLuid: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    const cachedResult = this._cachedDatasourceIds.get(datasourceLuid);
    if (cachedResult) {
      return cachedResult;
    }

    if (this.allowedDatasourceIds && !this.allowedDatasourceIds.has(datasourceLuid)) {
      return {
        allowed: false,
        message: [
          'The set of allowed data sources that can be queried is limited by the server configuration.',
          `Querying the datasource with LUID ${datasourceLuid} is not allowed.`,
        ].join(' '),
      };
    }

    let datasource: DataSource | undefined;
    async function getDatasource(): Promise<DataSource> {
      return await useRestApi({
        config,
        requestId,
        server,
        jwtScopes: getRequiredApiScopesForTool('list-datasources'),
        signal,
        callback: async (restApi) =>
          await restApi.datasourcesMethods.queryDatasource({
            siteId: restApi.siteId,
            datasourceId: datasourceLuid,
          }),
      });
    }

    if (this.allowedProjectIds) {
      try {
        datasource = await getDatasource();

        if (!this.allowedProjectIds.has(datasource.project.id)) {
          return {
            allowed: false,
            message: [
              'The set of allowed data sources that can be queried is limited by the server configuration.',
              `The datasource with LUID ${datasourceLuid} cannot be queried because it does not belong to an allowed project.`,
            ].join(' '),
          };
        }
      } catch (error) {
        return {
          allowed: false,
          message: [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
            `An error occurred while checking if the datasource with LUID ${datasourceLuid} is in an allowed project:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    if (this.allowedTags) {
      try {
        datasource = datasource ?? (await getDatasource());

        if (!datasource.tags?.tag?.some((tag) => this.allowedTags?.has(tag.label))) {
          return {
            allowed: false,
            message: [
              'The set of allowed data sources that can be queried is limited by the server configuration.',
              `The datasource with LUID ${datasourceLuid} cannot be queried because it does not have one of the allowed tags.`,
            ].join(' '),
          };
        }
      } catch (error) {
        return {
          allowed: false,
          message: [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
            `An error occurred while checking if the datasource with LUID ${datasourceLuid} has one of the allowed tags:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    return { allowed: true };
  }

  private async _isWorkbookAllowed({
    workbookId,
    restApiArgs: { config, requestId, server, signal },
  }: {
    workbookId: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult<Workbook>> {
    const cachedResult = this._cachedWorkbookIds.get(workbookId);
    if (cachedResult) {
      return cachedResult;
    }

    if (this.allowedWorkbookIds && !this.allowedWorkbookIds.has(workbookId)) {
      return {
        allowed: false,
        message: [
          'The set of allowed workbooks that can be queried is limited by the server configuration.',
          `Querying the workbook with LUID ${workbookId} is not allowed.`,
        ].join(' '),
      };
    }

    let workbook: Workbook | undefined;
    async function getWorkbook(): Promise<Workbook> {
      return await useRestApi({
        config,
        requestId,
        server,
        jwtScopes: getRequiredApiScopesForTool('get-workbook'),
        signal,
        callback: async (restApi) =>
          await restApi.workbooksMethods.getWorkbook({
            siteId: restApi.siteId,
            workbookId,
          }),
      });
    }

    if (this.allowedProjectIds) {
      try {
        workbook = await getWorkbook();

        if (!this.allowedProjectIds.has(workbook.project?.id ?? '')) {
          return {
            allowed: false,
            message: [
              'The set of allowed workbooks that can be queried is limited by the server configuration.',
              `The workbook with LUID ${workbookId} cannot be queried because it does not belong to an allowed project.`,
            ].join(' '),
          };
        }
      } catch (error) {
        return {
          allowed: false,
          message: [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
            `An error occurred while checking if the workbook with LUID ${workbookId} is in an allowed project:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    if (this.allowedTags) {
      try {
        workbook = workbook ?? (await getWorkbook());

        if (!workbook.tags?.tag?.some((tag) => this.allowedTags?.has(tag.label))) {
          return {
            allowed: false,
            message: [
              'The set of allowed workbooks that can be queried is limited by the server configuration.',
              `The workbook with LUID ${workbookId} cannot be queried because it does not have one of the allowed tags.`,
            ].join(' '),
          };
        }
      } catch (error) {
        return {
          allowed: false,
          message: [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
            `An error occurred while checking if the workbook with LUID ${workbookId} has one of the allowed tags:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    return { allowed: true, content: workbook };
  }

  private async _isViewAllowed({
    viewId,
    restApiArgs: { config, requestId, server, signal },
  }: {
    viewId: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    const cachedResult = this._cachedViewIds.get(viewId);
    if (cachedResult) {
      return cachedResult;
    }

    let view: View | undefined;
    async function getView(): Promise<View> {
      return await useRestApi({
        config,
        requestId,
        server,
        jwtScopes: getRequiredApiScopesForTool('list-views'),
        signal,
        callback: async (restApi) => {
          return await restApi.viewsMethods.getView({
            siteId: restApi.siteId,
            viewId,
          });
        },
      });
    }

    if (this.allowedWorkbookIds) {
      try {
        view = await getView();

        if (!this.allowedWorkbookIds.has(view.workbook?.id ?? '')) {
          return {
            allowed: false,
            message: [
              'The set of allowed views that can be queried is limited by the server configuration.',
              `The view with LUID ${viewId} cannot be queried because it does not belong to an allowed workbook.`,
            ].join(' '),
          };
        }
      } catch (error) {
        return {
          allowed: false,
          message: [
            'The set of allowed views that can be queried is limited by the server configuration.',
            `An error occurred while checking if the workbook containing the view with LUID ${viewId} is in an allowed workbook:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    if (this.allowedProjectIds) {
      try {
        view = view ?? (await getView());

        if (!this.allowedProjectIds.has(view.project?.id ?? '')) {
          return {
            allowed: false,
            message: [
              'The set of allowed views that can be queried is limited by the server configuration.',
              `The view with LUID ${viewId} cannot be queried because it does not belong to an allowed project.`,
            ].join(' '),
          };
        }
      } catch (error) {
        return {
          allowed: false,
          message: [
            'The set of allowed views that can be queried is limited by the server configuration.',
            `An error occurred while checking if the view with LUID ${viewId} is in an allowed project:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    if (this.allowedTags) {
      try {
        view = view ?? (await getView());

        if (!view.tags?.tag?.some((tag) => this.allowedTags?.has(tag.label))) {
          return {
            allowed: false,
            message: [
              'The set of allowed views that can be queried is limited by the server configuration.',
              `The view with LUID ${viewId} cannot be queried because it does not have one of the allowed tags.`,
            ].join(' '),
          };
        }
      } catch (error) {
        return {
          allowed: false,
          message: [
            'The set of allowed views that can be queried is limited by the server configuration.',
            `An error occurred while checking if the view with LUID ${viewId} has one of the allowed tags:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    return { allowed: true };
  }
}

let resourceAccessChecker = ResourceAccessChecker.create();
const exportedForTesting = {
  createResourceAccessChecker: ResourceAccessChecker.createForTesting,
  resetResourceAccessCheckerSingleton: () => {
    resourceAccessChecker = ResourceAccessChecker.create();
  },
};

export { exportedForTesting, resourceAccessChecker };
