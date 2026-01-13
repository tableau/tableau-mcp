import { BoundedContext, getConfig } from '../config.js';
import { RestApiArgs, useRestApi } from '../restApiInstance.js';
import { View } from '../sdks/tableau/types/view.js';
import { Workbook } from '../sdks/tableau/types/workbook.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';

type AllowedResult<T = unknown> =
  | { allowed: true; content?: T }
  | { allowed: false; message: string };

class ResourceAccessChecker {
  private _allowedProjectIds: Set<string> | null | undefined;
  private _allowedDatasourceIds: Set<string> | null | undefined;
  private _allowedWorkbookIds: Set<string> | null | undefined;

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

    if (!this.allowedProjectIds) {
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
  }): Promise<AllowedResult<Workbook>> {
    const result = await this._isWorkbookAllowed({
      workbookId,
      restApiArgs,
    });

    if (!this.allowedProjectIds) {
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
      type: 'view-id',
      viewId,
      restApiArgs,
    });

    if (!this.allowedProjectIds) {
      // If project filtering is enabled, we cannot cache the result since the workbook containing the view may be moved between projects.
      this._cachedViewIds.set(viewId, result);
    }

    return result;
  }

  async isViewAllowedByUrl({
    url,
    restApiArgs,
  }: {
    url: URL;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    const { result, viewId } = await this._isViewAllowedByUrl({
      url,
      restApiArgs,
    });

    if (viewId && !this.allowedProjectIds) {
      // If project filtering is enabled, we cannot cache the result since the workbook containing the view may be moved between projects.
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

    if (this.allowedProjectIds) {
      try {
        const datasourceProjectId = await useRestApi({
          config,
          requestId,
          server,
          jwtScopes: ['tableau:content:read'],
          signal,
          callback: async (restApi) => {
            const datasource = await restApi.datasourcesMethods.queryDatasource({
              siteId: restApi.siteId,
              datasourceId: datasourceLuid,
            });

            return datasource.project.id;
          },
        });

        if (!this.allowedProjectIds.has(datasourceProjectId)) {
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
    if (this.allowedProjectIds) {
      try {
        workbook = await useRestApi({
          config,
          requestId,
          server,
          jwtScopes: ['tableau:content:read'],
          signal,
          callback: async (restApi) => {
            const workbook = await restApi.workbooksMethods.getWorkbook({
              siteId: restApi.siteId,
              workbookId,
            });

            return workbook;
          },
        });

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

    return { allowed: true, content: workbook };
  }

  private async _isViewAllowed(
    input: ({ type: 'view'; view: View } | { type: 'view-id'; viewId: string }) & {
      restApiArgs: RestApiArgs;
    },
  ): Promise<AllowedResult> {
    const {
      type,
      restApiArgs: { config, requestId, server, signal },
    } = input;

    const viewId = type === 'view' ? input.view.id : input.viewId;
    const cachedResult = this._cachedViewIds.get(viewId);
    if (cachedResult) {
      return cachedResult;
    }

    let viewWorkbookId = '';
    let viewProjectId = '';

    if (this.allowedWorkbookIds) {
      try {
        const view =
          type === 'view'
            ? input.view
            : await useRestApi({
                config,
                requestId,
                server,
                jwtScopes: ['tableau:content:read'],
                signal,
                callback: async (restApi) => {
                  return await restApi.viewsMethods.getView({
                    siteId: restApi.siteId,
                    viewId,
                  });
                },
              });

        viewWorkbookId = view.workbook?.id ?? '';
        viewProjectId = view.project?.id ?? '';

        if (!this.allowedWorkbookIds.has(viewWorkbookId)) {
          return {
            allowed: false,
            message: [
              'The set of allowed workbooks that can be queried is limited by the server configuration.',
              `The view with LUID ${viewId} cannot be queried because it does not belong to an allowed workbook.`,
            ].join(' '),
          };
        }
      } catch (error) {
        return {
          allowed: false,
          message: [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
            `An error occurred while checking if the workbook containing the view with LUID ${viewId} is in an allowed workbook:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    if (this.allowedProjectIds) {
      try {
        viewProjectId = type === 'view' ? (input.view.project?.id ?? '') : '';
        viewProjectId =
          viewProjectId ||
          (await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:content:read'],
            signal,
            callback: async (restApi) => {
              const view = await restApi.viewsMethods.getView({
                siteId: restApi.siteId,
                viewId,
              });

              return view.project?.id ?? '';
            },
          }));

        if (!this.allowedProjectIds.has(viewProjectId)) {
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
            `An error occurred while checking if the workbook containing the view with LUID ${viewId} is in an allowed project:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    return { allowed: true };
  }

  private async _isViewAllowedByUrl({
    url,
    restApiArgs: { config, requestId, server, signal },
  }: {
    url: URL;
    restApiArgs: RestApiArgs;
  }): Promise<{ result: AllowedResult; viewId?: string }> {
    if (!this.allowedProjectIds && !this.allowedWorkbookIds) {
      return { result: { allowed: true } };
    }

    const pathParts = url.toString().includes('/t/')
      ? url.pathname.split('/')
      : url.hash.split('?')[0].split('/');

    const viewsIndex = pathParts.indexOf('views');
    if (viewsIndex === -1) {
      return { result: { allowed: false, message: 'Could not identify view in URL' } };
    }

    const workbookContentUrl = pathParts[viewsIndex + 1];
    const sheetContentUrl = pathParts[viewsIndex + 2];
    if (!workbookContentUrl || !sheetContentUrl) {
      return {
        result: { allowed: false, message: 'Could not identify workbook and sheet name in URL' },
      };
    }

    const view: View | undefined = await useRestApi({
      config,
      requestId,
      server,
      jwtScopes: ['tableau:content:read'],
      signal,
      callback: async (restApi) => {
        const { views } = await restApi.viewsMethods.queryViewsForSite({
          siteId: restApi.siteId,
          filter: `contentUrl:eq:${[workbookContentUrl, 'sheets', sheetContentUrl].join('/')}`,
        });

        return views[0];
      },
    });

    if (!view) {
      return {
        result: { allowed: false, message: 'Could not find the view for the given workbook URL' },
      };
    }

    const result = await this._isViewAllowed({
      type: 'view',
      view,
      restApiArgs: { config, requestId, server, signal },
    });

    return { result, viewId: view.id };
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
