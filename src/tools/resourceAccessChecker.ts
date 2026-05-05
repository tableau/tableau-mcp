import { log } from '../logging/logger.js';
import { BoundedContext } from '../overridableConfig.js';
import { useRestApi } from '../restApiInstance.js';
import { DataSource } from '../sdks/tableau/types/dataSource.js';
import { View } from '../sdks/tableau/types/view.js';
import { Workbook } from '../sdks/tableau/types/workbook.js';
import { RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES } from '../server/oauth/scopes.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { TableauRequestHandlerExtra } from './toolContext.js';

type AllowedResult<T = unknown> =
  | { allowed: true; content?: T }
  | { allowed: false; message: string };

// Cache-eligibility view of the bounded context.
// Required fields (`projectIds`, `datasourceIds`, `workbookIds`, `tags`) are
// always `Set<string> | null`. `viewIds` is included as an optional
// forward-compatible field so future view-scoped access cannot accidentally
// reuse the unscoped cache; today it is typically `undefined`.
type CacheBoundedContext = BoundedContext & { viewIds?: Set<string> | null };
type ResourceType = 'datasource' | 'workbook' | 'view' | 'custom-view';
type CacheDecision = 'hit' | 'miss' | 'write' | 'skipped-scoped';

const boundedContextCacheKeys = [
  'projectIds',
  'datasourceIds',
  'workbookIds',
  'tags',
  'viewIds',
] as const;

// Treat any non-null set as an active bound, even when empty.
// An empty set can represent an intentionally restrictive deny-all scope,
// so it must not be allowed to use the unscoped cache.
// `undefined` is treated as inactive only because optional future fields
// (currently `viewIds`) may simply not be present on the bounded context.
function hasActiveBoundedContext(boundedContext: CacheBoundedContext): boolean {
  return boundedContextCacheKeys.some(
    (key) => boundedContext[key] !== null && boundedContext[key] !== undefined,
  );
}

function getActiveBoundedContextKeys(boundedContext: CacheBoundedContext): Array<string> {
  return boundedContextCacheKeys.filter(
    (key) => boundedContext[key] !== null && boundedContext[key] !== undefined,
  );
}

class ResourceAccessChecker {
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

    this._cachedDatasourceIds = new Map();
    this._cachedWorkbookIds = new Map();
    this._cachedViewIds = new Map();
    this._cachedCustomViewIds = new Map();
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

  private logCacheDecision({
    resourceType,
    resourceLuid,
    decision,
    boundedContext,
    extra,
  }: {
    resourceType: ResourceType;
    resourceLuid: string;
    decision: CacheDecision;
    boundedContext: CacheBoundedContext;
    extra: TableauRequestHandlerExtra;
  }): void {
    log({
      level: 'debug',
      logger: 'resource-access',
      message: {
        event: 'resource-access-cache',
        resourceType,
        resourceLuid,
        decision,
        activeBoundedContextKeys: getActiveBoundedContextKeys(boundedContext),
        requestId: extra.requestId,
      },
    });
  }

  private getCachedResult<T>({
    cache,
    cacheKey,
    resourceType,
    boundedContext,
    extra,
  }: {
    cache: Map<string, AllowedResult<T>>;
    cacheKey: string;
    resourceType: ResourceType;
    boundedContext: CacheBoundedContext;
    extra: TableauRequestHandlerExtra;
  }): AllowedResult<T> | undefined {
    if (hasActiveBoundedContext(boundedContext)) {
      this.logCacheDecision({
        resourceType,
        resourceLuid: cacheKey,
        decision: 'skipped-scoped',
        boundedContext,
        extra,
      });
      return undefined;
    }

    const cachedResult = cache.get(cacheKey);
    this.logCacheDecision({
      resourceType,
      resourceLuid: cacheKey,
      decision: cachedResult ? 'hit' : 'miss',
      boundedContext,
      extra,
    });
    return cachedResult;
  }

  private setCachedResult<T>({
    cache,
    cacheKey,
    resourceType,
    boundedContext,
    result,
    extra,
  }: {
    cache: Map<string, AllowedResult<T>>;
    cacheKey: string;
    resourceType: ResourceType;
    boundedContext: CacheBoundedContext;
    result: AllowedResult<T>;
    extra: TableauRequestHandlerExtra;
  }): void {
    if (hasActiveBoundedContext(boundedContext)) {
      return;
    }

    cache.set(cacheKey, result);
    this.logCacheDecision({
      resourceType,
      resourceLuid: cacheKey,
      decision: 'write',
      boundedContext,
      extra,
    });
  }

  async isDatasourceAllowed({
    datasourceLuid,
    extra,
  }: {
    datasourceLuid: string;
    extra: TableauRequestHandlerExtra;
  }): Promise<AllowedResult> {
    const boundedContext = await this.getBoundedContext({ extra });
    const cachedResult = this.getCachedResult({
      cache: this._cachedDatasourceIds,
      cacheKey: datasourceLuid,
      resourceType: 'datasource',
      boundedContext,
      extra,
    });
    if (cachedResult) {
      return cachedResult;
    }

    const result = await this._isDatasourceAllowed({
      datasourceLuid,
      extra,
      boundedContext,
    });

    this.setCachedResult({
      cache: this._cachedDatasourceIds,
      cacheKey: datasourceLuid,
      resourceType: 'datasource',
      boundedContext,
      result,
      extra,
    });

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
    const cachedResult = this.getCachedResult({
      cache: this._cachedWorkbookIds,
      cacheKey: workbookId,
      resourceType: 'workbook',
      boundedContext,
      extra,
    });
    if (cachedResult) {
      return cachedResult;
    }

    const result = await this._isWorkbookAllowed({
      workbookId,
      extra,
      boundedContext,
    });

    this.setCachedResult({
      cache: this._cachedWorkbookIds,
      cacheKey: workbookId,
      resourceType: 'workbook',
      boundedContext,
      result,
      extra,
    });

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
    const cachedResult = this.getCachedResult({
      cache: this._cachedViewIds,
      cacheKey: viewId,
      resourceType: 'view',
      boundedContext,
      extra,
    });
    if (cachedResult) {
      return cachedResult;
    }

    const result = await this._isViewAllowed({
      viewId,
      extra,
      boundedContext,
    });

    this.setCachedResult({
      cache: this._cachedViewIds,
      cacheKey: viewId,
      resourceType: 'view',
      boundedContext,
      result,
      extra,
    });

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
    const cachedResult = this.getCachedResult({
      cache: this._cachedCustomViewIds,
      cacheKey: customViewId,
      resourceType: 'custom-view',
      boundedContext,
      extra,
    });
    if (cachedResult) {
      return cachedResult;
    }

    const result = await this._isCustomViewAllowed({
      customViewId,
      extra,
      boundedContext,
    });

    this.setCachedResult({
      cache: this._cachedCustomViewIds,
      cacheKey: customViewId,
      resourceType: 'custom-view',
      boundedContext,
      result,
      extra,
    });

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
    const isCustomViewAllowed = await this._isViewAllowed({
      viewId: underlyingViewId,
      extra,
      boundedContext,
    });

    return isCustomViewAllowed;
  }
}

let resourceAccessChecker = ResourceAccessChecker.create();
const exportedForTesting = {
  createResourceAccessChecker: ResourceAccessChecker.createForTesting,
  hasActiveBoundedContext,
  resetResourceAccessCheckerSingleton: () => {
    resourceAccessChecker = ResourceAccessChecker.create();
  },
};

export { exportedForTesting, resourceAccessChecker };
