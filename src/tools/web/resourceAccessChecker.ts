import { log } from '../../logging/logger.js';
import { BoundedContext } from '../../overridableConfig.js';
import { useRestApi } from '../../restApiInstance.js';
import { DataSource } from '../../sdks/tableau/types/dataSource.js';
import { View } from '../../sdks/tableau/types/view.js';
import { Workbook } from '../../sdks/tableau/types/workbook.js';
import { RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES } from '../../server/oauth/scopes.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { TableauWebRequestHandlerExtra } from './toolContext.js';

type AllowedResult<T = unknown> =
  | { allowed: true; content?: T }
  | { allowed: false; message: string };

class ResourceAccessChecker {
  private _testOverrides: {
    projectIds: Set<string> | null | undefined;
    datasourceIds: Set<string> | null | undefined;
    workbookIds: Set<string> | null | undefined;
    viewIds: Set<string> | null | undefined;
    tags: Set<string> | null | undefined;
  };

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
      viewIds: testOverrides?.viewIds,
      tags: testOverrides?.tags,
    };
  }

  private async getAllowedProjectIds({
    extra,
  }: {
    extra: TableauWebRequestHandlerExtra;
  }): Promise<Set<string> | null> {
    return (
      this._testOverrides.projectIds ??
      (await extra.getConfigWithOverrides()).boundedContext.projectIds
    );
  }

  private async getAllowedDatasourceIds({
    extra,
  }: {
    extra: TableauWebRequestHandlerExtra;
  }): Promise<Set<string> | null> {
    return (
      this._testOverrides.datasourceIds ??
      (await extra.getConfigWithOverrides()).boundedContext.datasourceIds
    );
  }

  private async getAllowedWorkbookIds({
    extra,
  }: {
    extra: TableauWebRequestHandlerExtra;
  }): Promise<Set<string> | null> {
    return (
      this._testOverrides.workbookIds ??
      (await extra.getConfigWithOverrides()).boundedContext.workbookIds
    );
  }

  private async getAllowedViewIds({
    extra,
  }: {
    extra: TableauWebRequestHandlerExtra;
  }): Promise<Set<string> | null> {
    return (
      this._testOverrides.viewIds ?? (await extra.getConfigWithOverrides()).boundedContext.viewIds
    );
  }

  private async getAllowedTags({
    extra,
  }: {
    extra: TableauWebRequestHandlerExtra;
  }): Promise<Set<string> | null> {
    return this._testOverrides.tags ?? (await extra.getConfigWithOverrides()).boundedContext.tags;
  }

  async isDatasourceAllowed({
    datasourceLuid,
    extra,
  }: {
    datasourceLuid: string;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<DataSource>> {
    const result = await this._isDatasourceAllowed({
      datasourceLuid,
      extra,
    });

    return result;
  }

  async isWorkbookAllowed({
    workbookId,
    extra,
  }: {
    workbookId: string;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<Workbook>> {
    const result = await this._isWorkbookAllowed({
      workbookId,
      extra,
    });

    return result;
  }

  async isViewAllowed({
    viewId,
    extra,
  }: {
    viewId: string;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<View>> {
    const result = await this._isViewAllowed({
      viewId,
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
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult> {
    const result = await this._isCustomViewAllowed({
      customViewId,
      extra,
    });

    return result;
  }

  private async _isDatasourceAllowed({
    datasourceLuid,
    extra,
  }: {
    datasourceLuid: string;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<DataSource>> {
    const allowedDatasourceIds = await this.getAllowedDatasourceIds({ extra });
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

    const allowedProjectIds = await this.getAllowedProjectIds({ extra });
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
        log({
          message: `Resource access check failed for datasource ${datasourceLuid}`,
          level: 'error',
          logger: 'resource-access',
          data: error,
        });
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

    const allowedTags = await this.getAllowedTags({ extra });
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
        log({
          message: `Resource access check failed for datasource ${datasourceLuid} tags`,
          level: 'error',
          logger: 'resource-access',
          data: error,
        });
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

    // Reuse the datasource already fetched by a project/tag scope check (undefined when no scope
    // forced a fetch) so callers can avoid querying it again. Mirrors isWorkbookAllowed.
    return { allowed: true, content: datasource };
  }

  private async _isWorkbookAllowed({
    workbookId,
    extra,
  }: {
    workbookId: string;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<Workbook>> {
    const allowedWorkbookIds = await this.getAllowedWorkbookIds({ extra });
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

    const allowedProjectIds = await this.getAllowedProjectIds({ extra });
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
        log({
          message: `Resource access check failed for workbook ${workbookId}`,
          level: 'error',
          logger: 'resource-access',
          data: error,
        });
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

    const allowedTags = await this.getAllowedTags({ extra });
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
        log({
          message: `Resource access check failed for workbook ${workbookId} tags`,
          level: 'error',
          logger: 'resource-access',
          data: error,
        });
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
  }: {
    viewId: string;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<View>> {
    const allowedViewIds = await this.getAllowedViewIds({ extra });
    if (allowedViewIds && !allowedViewIds.has(viewId)) {
      return {
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `Querying the view with LUID ${viewId} is not allowed.`,
        ].join(' '),
      };
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

    const allowedWorkbookIds = await this.getAllowedWorkbookIds({ extra });
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
        log({
          message: `Resource access check failed for view ${viewId} workbook`,
          level: 'error',
          logger: 'resource-access',
          data: error,
        });
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

    const allowedProjectIds = await this.getAllowedProjectIds({ extra });
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
        log({
          message: `Resource access check failed for view ${viewId} project`,
          level: 'error',
          logger: 'resource-access',
          data: error,
        });
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

    const allowedTags = await this.getAllowedTags({ extra });
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
        log({
          message: `Resource access check failed for view ${viewId} tags`,
          level: 'error',
          logger: 'resource-access',
          data: error,
        });
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

    return { allowed: true, content: view };
  }

  private async _isCustomViewAllowed({
    customViewId,
    extra,
  }: {
    customViewId: string;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult> {
    const allowedWorkbookIds = await this.getAllowedWorkbookIds({ extra });
    const allowedProjectIds = await this.getAllowedProjectIds({ extra });
    const allowedViewIds = await this.getAllowedViewIds({ extra });
    const allowedTags = await this.getAllowedTags({ extra });
    if (!allowedWorkbookIds && !allowedProjectIds && !allowedViewIds && !allowedTags) {
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
      log({
        message: `Resource access check failed for custom view ${customViewId}`,
        level: 'error',
        logger: 'resource-access',
        data: error,
      });
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

let resourceAccessChecker = ResourceAccessChecker.create();
const exportedForTesting = {
  createResourceAccessChecker: ResourceAccessChecker.createForTesting,
  resetResourceAccessCheckerSingleton: () => {
    resourceAccessChecker = ResourceAccessChecker.create();
  },
};

export { exportedForTesting, resourceAccessChecker };
