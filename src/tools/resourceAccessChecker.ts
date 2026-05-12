import { BoundedContext } from '../overridableConfig.js';
import { useRestApi } from '../restApiInstance.js';
import { DataSource } from '../sdks/tableau/types/dataSource.js';
import { View } from '../sdks/tableau/types/view.js';
import { Workbook } from '../sdks/tableau/types/workbook.js';
import { RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES } from '../server/oauth/scopes.js';
import { ExpiringMap } from '../utils/expiringMap.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { TableauRequestHandlerExtra } from './toolContext.js';

type AllowedResult<T = unknown> =
  | { allowed: true; content?: T }
  | { allowed: false; message: string };

const CACHED_RESOURCE_EXPIRATION_TIME = 3 * 60 * 1000; // 3 minutes

export class ResourceAccessChecker {
  private _testOverrides: {
    projectIds: Set<string> | null | undefined;
    datasourceIds: Set<string> | null | undefined;
    workbookIds: Set<string> | null | undefined;
    tags: Set<string> | null | undefined;
  };

  private readonly _cachedDatasourceIds: Map<string, AllowedResult>;
  private readonly _cachedWorkbookIds: Map<string, AllowedResult<Workbook>>;
  private readonly _cachedViewIds: Map<string, AllowedResult>;
  private readonly _cachedCustomViewIds: Map<string, AllowedResult>;

  static create(): ResourceAccessChecker {
    return new ResourceAccessChecker();
  }

  static createForTesting(boundedContext: BoundedContext): ResourceAccessChecker {
    return new ResourceAccessChecker(boundedContext);
  }

  // Optional bounded context to use for testing.
  private constructor(testOverrides?: BoundedContext) {
    // The methods assume these sets are non-empty.
    this._testOverrides = {
      projectIds: testOverrides?.projectIds,
      datasourceIds: testOverrides?.datasourceIds,
      workbookIds: testOverrides?.workbookIds,
      tags: testOverrides?.tags,
    };

    this._cachedDatasourceIds = new ExpiringMap({
      defaultExpirationTimeMs: CACHED_RESOURCE_EXPIRATION_TIME,
    });
    this._cachedWorkbookIds = new ExpiringMap({
      defaultExpirationTimeMs: CACHED_RESOURCE_EXPIRATION_TIME,
    });
    this._cachedViewIds = new ExpiringMap({
      defaultExpirationTimeMs: CACHED_RESOURCE_EXPIRATION_TIME,
    });
    this._cachedCustomViewIds = new ExpiringMap({
      defaultExpirationTimeMs: CACHED_RESOURCE_EXPIRATION_TIME,
    });
  }

  private hasTestOverrides(): boolean {
    return Object.values(this._testOverrides).some((value) => value !== undefined);
  }

  private async getBoundedContext({
    extra,
  }: {
    extra: TableauRequestHandlerExtra;
  }): Promise<BoundedContext> {
    if (this.hasTestOverrides()) {
      return {
        projectIds: this._testOverrides.projectIds ?? null,
        datasourceIds: this._testOverrides.datasourceIds ?? null,
        workbookIds: this._testOverrides.workbookIds ?? null,
        tags: this._testOverrides.tags ?? null,
      };
    }

    return (await extra.getConfigWithOverrides()).boundedContext;
  }

  async isDatasourceAllowed({
    datasourceLuid,
    extra,
  }: {
    datasourceLuid: string;
    extra: TableauRequestHandlerExtra;
  }): Promise<AllowedResult> {
    const boundedContext = await this.getBoundedContext({ extra });
    if (!boundedContext.datasourceIds && !boundedContext.projectIds && !boundedContext.tags) {
      return { allowed: true };
    }

    const result = await this._isDatasourceAllowed({
      datasourceLuid,
      extra,
      boundedContext,
    });

    if (result.allowed) {
      this._cachedDatasourceIds.set(datasourceLuid, result);
    }
    return result;
  }

  async isWorkbookAllowed({
    workbookId,
    extra,
  }: {
    workbookId: string;
    extra: TableauRequestHandlerExtra;
  }): Promise<AllowedResult<Workbook>> {
    const boundedContext = await this.getBoundedContext({ extra });
    if (!boundedContext.workbookIds && !boundedContext.projectIds && !boundedContext.tags) {
      return { allowed: true };
    }

    const result = await this._isWorkbookAllowed({
      workbookId,
      extra,
      boundedContext,
    });

    if (result.allowed) {
      this._cachedWorkbookIds.set(workbookId, result);
    }
    return result;
  }

  async isViewAllowed({
    viewId,
    extra,
  }: {
    viewId: string;
    extra: TableauRequestHandlerExtra;
  }): Promise<AllowedResult> {
    const boundedContext = await this.getBoundedContext({ extra });
    if (!boundedContext.workbookIds && !boundedContext.projectIds && !boundedContext.tags) {
      return { allowed: true };
    }

    const result = await this._isViewAllowed({
      viewId,
      extra,
      boundedContext,
    });

    if (result.allowed) {
      this._cachedViewIds.set(viewId, result);
    }
    return result;
  }

  /**
   * Resolves a custom view to its underlying published view, then applies the same rules as {@link isViewAllowed}.
   */
  async isCustomViewAllowed({
    customViewId,
    extra,
  }: {
    customViewId: string;
    extra: TableauRequestHandlerExtra;
  }): Promise<AllowedResult> {
    const boundedContext = await this.getBoundedContext({ extra });
    if (!boundedContext.workbookIds && !boundedContext.projectIds && !boundedContext.tags) {
      return { allowed: true };
    }

    const result = await this._isCustomViewAllowed({
      customViewId,
      extra,
      boundedContext,
    });

    if (result.allowed) {
      this._cachedCustomViewIds.set(customViewId, result);
    }
    return result;
  }

  private async _isDatasourceAllowed({
    datasourceLuid,
    extra,
    boundedContext,
  }: {
    datasourceLuid: string;
    extra: TableauRequestHandlerExtra;
    boundedContext: BoundedContext;
  }): Promise<AllowedResult> {
    const cachedResult = this._cachedDatasourceIds.get(datasourceLuid);
    if (cachedResult) {
      return cachedResult;
    }

    const allowedDatasourceIds = boundedContext.datasourceIds;
    if (allowedDatasourceIds && !allowedDatasourceIds.has(datasourceLuid)) {
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
        ...extra,
        jwtScopes: RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
        callback: async (restApi) =>
          await restApi.datasourcesMethods.queryDatasource({
            siteId: restApi.siteId,
            datasourceId: datasourceLuid,
          }),
      });
    }

    const allowedProjectIds = boundedContext.projectIds;
    if (allowedProjectIds) {
      try {
        datasource = await getDatasource();

        if (!allowedProjectIds.has(datasource.project.id)) {
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

    const allowedTags = boundedContext.tags;
    if (allowedTags) {
      try {
        datasource = datasource ?? (await getDatasource());

        if (!datasource.tags?.tag?.some((tag) => allowedTags.has(tag.label))) {
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
    extra,
    boundedContext,
  }: {
    workbookId: string;
    extra: TableauRequestHandlerExtra;
    boundedContext: BoundedContext;
  }): Promise<AllowedResult<Workbook>> {
    const cachedResult = this._cachedWorkbookIds.get(workbookId);
    if (cachedResult) {
      return cachedResult;
    }

    const allowedWorkbookIds = boundedContext.workbookIds;
    if (allowedWorkbookIds && !allowedWorkbookIds.has(workbookId)) {
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
        ...extra,
        jwtScopes: RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
        callback: async (restApi) =>
          await restApi.workbooksMethods.getWorkbook({
            siteId: restApi.siteId,
            workbookId,
          }),
      });
    }

    const allowedProjectIds = boundedContext.projectIds;
    if (allowedProjectIds) {
      try {
        workbook = await getWorkbook();

        if (!allowedProjectIds.has(workbook.project?.id ?? '')) {
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

    const allowedTags = boundedContext.tags;
    if (allowedTags) {
      try {
        workbook = workbook ?? (await getWorkbook());

        if (!workbook.tags?.tag?.some((tag) => allowedTags.has(tag.label))) {
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
    extra,
    boundedContext,
  }: {
    viewId: string;
    extra: TableauRequestHandlerExtra;
    boundedContext: BoundedContext;
  }): Promise<AllowedResult> {
    const cachedResult = this._cachedViewIds.get(viewId);
    if (cachedResult) {
      return cachedResult;
    }

    let view: View | undefined;
    async function getView(): Promise<View> {
      return await useRestApi({
        ...extra,
        jwtScopes: RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
        callback: async (restApi) => {
          return await restApi.viewsMethods.getView({
            siteId: restApi.siteId,
            viewId,
          });
        },
      });
    }

    const allowedWorkbookIds = boundedContext.workbookIds;
    if (allowedWorkbookIds) {
      try {
        view = await getView();

        if (!allowedWorkbookIds.has(view.workbook?.id ?? '')) {
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

    const allowedProjectIds = boundedContext.projectIds;
    if (allowedProjectIds) {
      try {
        view = view ?? (await getView());

        if (!allowedProjectIds.has(view.project?.id ?? '')) {
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

    const allowedTags = boundedContext.tags;
    if (allowedTags) {
      try {
        view = view ?? (await getView());

        if (!view.tags?.tag?.some((tag) => allowedTags.has(tag.label))) {
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

  private async _isCustomViewAllowed({
    customViewId,
    extra,
    boundedContext,
  }: {
    customViewId: string;
    extra: TableauRequestHandlerExtra;
    boundedContext: BoundedContext;
  }): Promise<AllowedResult> {
    const cachedResult = this._cachedCustomViewIds.get(customViewId);
    if (cachedResult) {
      return cachedResult;
    }

    const allowedWorkbookIds = boundedContext.workbookIds;
    const allowedProjectIds = boundedContext.projectIds;
    const allowedTags = boundedContext.tags;
    if (!allowedWorkbookIds && !allowedProjectIds && !allowedTags) {
      // If no filtering is enabled, there's no need to resolve the view the custom view belongs to.
      return { allowed: true };
    }

    let underlyingViewId: string | undefined;
    try {
      const customView = await useRestApi({
        ...extra,
        jwtScopes: RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
        callback: async (restApi) =>
          await restApi.viewsMethods.getCustomView({
            siteId: restApi.siteId,
            customViewId,
          }),
      });
      underlyingViewId = customView.view.id;
    } catch (error) {
      return {
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `An error occurred while checking if the custom view with LUID ${customViewId} belongs to an allowed view.`,
          'Please verify that the custom view LUID is correct and you have access to it.',
          getExceptionMessage(error),
        ].join(' '),
      };
    }

    // The custom view is allowed if the underlying view that contains it is allowed.
    const isCustomViewAllowed = await this.isViewAllowed({
      viewId: underlyingViewId,
      extra,
    });

    return isCustomViewAllowed;
  }
}

let globalResourceAccessChecker = ResourceAccessChecker.create();
const exportedForTesting = {
  createResourceAccessChecker: ResourceAccessChecker.createForTesting,
  resetResourceAccessCheckerSingleton: () => {
    globalResourceAccessChecker = ResourceAccessChecker.create();
  },
};

export { exportedForTesting, globalResourceAccessChecker };
