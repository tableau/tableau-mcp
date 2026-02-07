import { BoundedContext } from '../config.js';
import { useRestApi } from '../restApiInstance.js';
import { DataSource } from '../sdks/tableau/types/dataSource.js';
import { View } from '../sdks/tableau/types/view.js';
import { Workbook } from '../sdks/tableau/types/workbook.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { getConfigWithOverrides } from '../utils/mcpSiteSettings.js';
import { RestApiArgs } from '../utils/restApiArgs.js';

type AllowedResult<T = unknown> =
  | { allowed: true; content?: T }
  | { allowed: false; message: string };

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

  private async setBoundedContext({ restApiArgs }: { restApiArgs: RestApiArgs }): Promise<void> {
    const { boundedContext } = await getConfigWithOverrides({
      restApiArgs,
    });

    this._allowedProjectIds = boundedContext.projectIds;
    this._allowedDatasourceIds = boundedContext.datasourceIds;
    this._allowedWorkbookIds = boundedContext.workbookIds;
    this._allowedTags = boundedContext.tags;
  }

  private async getAllowedProjectIds({
    restApiArgs,
  }: {
    restApiArgs: RestApiArgs;
  }): Promise<Set<string> | null> {
    await this.setBoundedContext({ restApiArgs });
    return this._allowedProjectIds!;
  }

  private async getAllowedDatasourceIds({
    restApiArgs,
  }: {
    restApiArgs: RestApiArgs;
  }): Promise<Set<string> | null> {
    await this.setBoundedContext({ restApiArgs });
    return this._allowedDatasourceIds!;
  }

  private async getAllowedWorkbookIds({
    restApiArgs,
  }: {
    restApiArgs: RestApiArgs;
  }): Promise<Set<string> | null> {
    await this.setBoundedContext({ restApiArgs });
    return this._allowedWorkbookIds!;
  }

  private async getAllowedTags({
    restApiArgs,
  }: {
    restApiArgs: RestApiArgs;
  }): Promise<Set<string> | null> {
    await this.setBoundedContext({ restApiArgs });
    return this._allowedTags!;
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

    const allowedProjectIds = await this.getAllowedProjectIds({ restApiArgs });
    const allowedTags = await this.getAllowedTags({ restApiArgs });
    if (!allowedProjectIds && !allowedTags) {
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

    const allowedProjectIds = await this.getAllowedProjectIds({ restApiArgs });
    const allowedTags = await this.getAllowedTags({ restApiArgs });
    if (!allowedProjectIds && !allowedTags) {
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

    const allowedProjectIds = await this.getAllowedProjectIds({ restApiArgs });
    const allowedTags = await this.getAllowedTags({ restApiArgs });
    if (!allowedProjectIds && !allowedTags) {
      // If project filtering is enabled, we cannot cache the result since the workbook containing the view may be moved between projects.
      // If tag filtering is enabled, we cannot cache the result since the view tags can change over time.
      this._cachedViewIds.set(viewId, result);
    }

    return result;
  }

  private async _isDatasourceAllowed({
    datasourceLuid,
    restApiArgs,
  }: {
    datasourceLuid: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult> {
    const cachedResult = this._cachedDatasourceIds.get(datasourceLuid);
    if (cachedResult) {
      return cachedResult;
    }

    const allowedDatasourceIds = await this.getAllowedDatasourceIds({ restApiArgs });
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
        ...restApiArgs,
        jwtScopes: ['tableau:content:read'],
        callback: async (restApi) =>
          await restApi.datasourcesMethods.queryDatasource({
            siteId: restApi.siteId,
            datasourceId: datasourceLuid,
          }),
      });
    }

    const allowedProjectIds = await this.getAllowedProjectIds({ restApiArgs });
    if (allowedProjectIds) {
      try {
        datasource = await getDatasource();

        if (!allowedProjectIds?.has(datasource.project.id)) {
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

    const allowedTags = await this.getAllowedTags({ restApiArgs });
    if (allowedTags) {
      try {
        datasource = datasource ?? (await getDatasource());

        if (!datasource.tags?.tag?.some((tag) => allowedTags?.has(tag.label))) {
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
    restApiArgs,
  }: {
    workbookId: string;
    restApiArgs: RestApiArgs;
  }): Promise<AllowedResult<Workbook>> {
    const cachedResult = this._cachedWorkbookIds.get(workbookId);
    if (cachedResult) {
      return cachedResult;
    }

    const allowedWorkbookIds = await this.getAllowedWorkbookIds({ restApiArgs });
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
        ...restApiArgs,
        jwtScopes: ['tableau:content:read'],
        callback: async (restApi) =>
          await restApi.workbooksMethods.getWorkbook({
            siteId: restApi.siteId,
            workbookId,
          }),
      });
    }

    const allowedProjectIds = await this.getAllowedProjectIds({ restApiArgs });
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

    const allowedTags = await this.getAllowedTags({ restApiArgs });
    if (allowedTags) {
      try {
        workbook = workbook ?? (await getWorkbook());

        if (!workbook.tags?.tag?.some((tag) => allowedTags?.has(tag.label))) {
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
    restApiArgs,
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
        ...restApiArgs,
        jwtScopes: ['tableau:content:read'],
        callback: async (restApi) => {
          return await restApi.viewsMethods.getView({
            siteId: restApi.siteId,
            viewId,
          });
        },
      });
    }

    const allowedWorkbookIds = await this.getAllowedWorkbookIds({ restApiArgs });
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

    const allowedProjectIds = await this.getAllowedProjectIds({ restApiArgs });
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

    const allowedTags = await this.getAllowedTags({ restApiArgs });
    if (allowedTags) {
      try {
        view = view ?? (await getView());

        if (!view.tags?.tag?.some((tag) => allowedTags?.has(tag.label))) {
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
