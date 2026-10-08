import { log } from '../../logging/logger.js';
import { BoundedContext } from '../../overridableConfig.js';
import { useRestApi } from '../../restApiInstance.js';
import {
  getDatasourceNamesAndTagsByLuid,
  getDatasourceNamesAndTagsQuery,
} from '../../sdks/tableau/methods/lineageUtils.js';
import { DataSource } from '../../sdks/tableau/types/dataSource.js';
import { Flow, FlowOutputStep } from '../../sdks/tableau/types/flow.js';
import { View } from '../../sdks/tableau/types/view.js';
import { Workbook } from '../../sdks/tableau/types/workbook.js';
import {
  RESOURCE_ACCESS_CHECKER_FLOW_API_SCOPES,
  RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
} from '../../server/oauth/scopes.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { getHttpStatus } from '../../utils/getHttpStatus.js';
import { TableauWebRequestHandlerExtra } from './toolContext.js';

type AllowedResult<T = unknown> =
  | { allowed: true; content?: T }
  | { allowed: false; message: string };

/**
 * The flow detail returned by "Query Flow" — surfaced as the `content` of an
 * allowed flow result so `get-flow` can reuse it instead of re-fetching.
 */
type AllowedFlowContent = { flow: Flow; outputSteps: FlowOutputStep[] };

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

  async isFlowAllowed({
    flowId,
    extra,
  }: {
    flowId: string;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<AllowedFlowContent>> {
    const result = await this._isFlowAllowed({
      flowId,
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
    // If INCLUDE_DATASOURCE_IDS is defined, check if datasource is in that allowlist.
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

    const allowedTags = await this.getAllowedTags({ extra });
    const allowedProjectIds = await this.getAllowedProjectIds({ extra });
    if (!allowedTags && !allowedProjectIds) {
      return { allowed: true };
    }

    // GET /datasources/{id}
    // Returns both the project and the tags.
    //
    // Limitations: This API requires View permissions on the parent project,
    // which is not strictly necessary to query the datasource itself.
    async function queryDatasource(): Promise<DataSource> {
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

    // Metadata API, by LUID
    // Returns the datasource name and tags.
    //
    // Limitations:
    // * Requires Metadata API to be enabled on the server
    // * This API does not return the project ID of the datasource
    //
    // Returns undefined when Metadata API requests are disabled, the request fails, or the datasource isn't returned.
    async function getNameAndTagsFromMetadataApi(): Promise<
      { name: string; tags: Array<string> } | undefined
    > {
      if ((await extra.getConfigWithOverrides()).disableMetadataApiRequests) {
        return undefined;
      }

      try {
        const response = await useRestApi({
          ...extra,
          jwtScopes: RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
          callback: async (restApi) =>
            await restApi.metadataMethods.graphql(getDatasourceNamesAndTagsQuery([datasourceLuid])),
        });
        return getDatasourceNamesAndTagsByLuid(response).get(datasourceLuid);
      } catch (error) {
        log(
          {
            message: `Metadata API lookup failed for datasource ${datasourceLuid}`,
            level: 'warning',
            logger: 'resource-access',
            data: getExceptionMessage(error),
          },
          extra,
        );
        return undefined;
      }
    }

    // GET /datasources (list), filtered by name
    // Returns the datasources with the given name, which include their project IDs.
    //
    // Limitations:
    // * This API can't filter by LUID, so callers must match the LUID themselves
    // * Filter expressions are comma-delimited, so a name with a comma can't be filtered on
    //
    // Returns an empty list when the name can't be filtered on or the request fails.
    async function getDatasourcesByName(name: string): Promise<Array<DataSource>> {
      if (name.includes(',')) {
        return [];
      }

      try {
        const { datasources } = await useRestApi({
          ...extra,
          jwtScopes: RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
          callback: async (restApi) =>
            await restApi.datasourcesMethods.listDatasources({
              siteId: restApi.siteId,
              filter: `name:eq:${name}`,
              pageSize: 1000,
            }),
        });
        return datasources;
      } catch (error) {
        log(
          {
            message: `List lookup failed for datasource ${datasourceLuid}`,
            level: 'warning',
            logger: 'resource-access',
            data: getExceptionMessage(error),
          },
          extra,
        );
        return [];
      }
    }

    let datasource: DataSource | undefined;
    let datasourceName: string;
    let datasourceTags: Array<string>;
    try {
      // Query Data Source returns the project LUID and tags, so prefer it over the Metadata API.
      datasource = await queryDatasource();
      datasourceName = datasource.name;
      datasourceTags = datasource.tags?.tag?.map((tag) => tag.label) ?? [];
    } catch (error) {
      // Query Data Source returns 403 when the user can't see the data source's parent project,
      // even if they can query the data source itself.
      // The Metadata API isn't subject to that check, so fall back to it.
      const metadata =
        error instanceof Error && getHttpStatus(error) === '403'
          ? await getNameAndTagsFromMetadataApi()
          : undefined;
      if (!metadata) {
        log(
          {
            message: `Resource access check failed for datasource ${datasourceLuid}`,
            level: 'error',
            logger: 'resource-access',
            data: error,
          },
          extra,
        );
        const checks = [
          ...(allowedProjectIds ? ['is in an allowed project'] : []),
          ...(allowedTags ? ['has one of the allowed tags'] : []),
        ].join(' and ');
        return {
          allowed: false,
          message: [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
            `An error occurred while checking if the datasource with LUID ${datasourceLuid} ${checks}:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
      datasourceName = metadata.name;
      datasourceTags = metadata.tags;
    }

    // If INCLUDE_TAGS is defined, check if the datasource has one of the allowed tags.
    // Tags are checked before the project because, after a 403, retrieving the project LUID requires a call to ListDatasources.
    if (allowedTags && !datasourceTags.some((tag) => allowedTags.has(tag))) {
      return {
        allowed: false,
        message: [
          'The set of allowed data sources that can be queried is limited by the server configuration.',
          `The datasource with LUID ${datasourceLuid} cannot be queried because it does not have one of the allowed tags.`,
        ].join(' '),
      };
    }

    // If INCLUDE_PROJECT_IDS is defined, check if the datasource belongs to one of the allowed projects.
    if (allowedProjectIds) {
      if (!datasource) {
        // If we didn't get the datasource from Query Data Source,
        // we need to look it up by name with the List Data Sources API
        const datasourcesWithSameName = await getDatasourcesByName(datasourceName);
        datasource = datasourcesWithSameName.find((ds) => ds.id === datasourceLuid);
        if (!datasource) {
          return {
            allowed: false,
            message: [
              'The set of allowed data sources that can be queried is limited by the server configuration.',
              `The datasource with LUID ${datasourceLuid} cannot be queried because its project could not be determined.`,
            ].join(' '),
          };
        }
      }

      if (!datasource.project) {
        // Embedded (workbook) data sources have no project, so a project allowlist can't admit
        // them. Fail closed here; resolving the parent workbook's project for allowlist matching
        // is tracked by W-23864479.
        return {
          allowed: false,
          message: [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
            `The datasource with LUID ${datasourceLuid} cannot be queried because it is an embedded (workbook) data source, which cannot be matched against the allowed projects.`,
          ].join(' '),
        };
      }

      if (!allowedProjectIds.has(datasource.project.id)) {
        return {
          allowed: false,
          message: [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
            `The datasource with LUID ${datasourceLuid} cannot be queried because it does not belong to an allowed project.`,
          ].join(' '),
        };
      }
    }

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
        log(
          {
            message: `Resource access check failed for workbook ${workbookId}`,
            level: 'error',
            logger: 'resource-access',
            data: error,
          },
          extra,
        );
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
        log(
          {
            message: `Resource access check failed for workbook ${workbookId} tags`,
            level: 'error',
            logger: 'resource-access',
            data: error,
          },
          extra,
        );
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

  private async _isFlowAllowed({
    flowId,
    extra,
  }: {
    flowId: string;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<AllowedFlowContent>> {
    // Flows have no dedicated `flowIds` bounded context (only projects and tags
    // apply to flows), so unlike workbooks there is no id-based short circuit.
    // The flow is fetched only when a project or tag filter is configured.
    let flowResult: AllowedFlowContent | undefined;
    async function getFlow(): Promise<AllowedFlowContent> {
      return await useRestApi({
        ...extra,
        // Flows are gated by `tableau:flows:read`, not `tableau:content:read`.
        jwtScopes: RESOURCE_ACCESS_CHECKER_FLOW_API_SCOPES,
        callback: async (restApi) =>
          await restApi.flowsMethods.queryFlow({
            siteId: restApi.siteId,
            flowId,
          }),
      });
    }

    const allowedProjectIds = await this.getAllowedProjectIds({ extra });
    if (allowedProjectIds) {
      try {
        flowResult = await getFlow();

        if (!allowedProjectIds.has(flowResult.flow.project?.id ?? '')) {
          return {
            allowed: false,
            message: [
              'The set of allowed flows that can be queried is limited by the server configuration.',
              `The flow with LUID ${flowId} cannot be queried because it does not belong to an allowed project.`,
            ].join(' '),
          };
        }
      } catch (error) {
        log(
          {
            message: `Resource access check failed for flow ${flowId}`,
            level: 'error',
            logger: 'resource-access',
            data: error,
          },
          extra,
        );
        return {
          allowed: false,
          message: [
            'The set of allowed flows that can be queried is limited by the server configuration.',
            `An error occurred while checking if the flow with LUID ${flowId} is in an allowed project:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    const allowedTags = await this.getAllowedTags({ extra });
    if (allowedTags) {
      try {
        flowResult = flowResult ?? (await getFlow());

        if (!flowResult.flow.tags?.tag?.some((tag) => allowedTags.has(tag.label))) {
          return {
            allowed: false,
            message: [
              'The set of allowed flows that can be queried is limited by the server configuration.',
              `The flow with LUID ${flowId} cannot be queried because it does not have one of the allowed tags.`,
            ].join(' '),
          };
        }
      } catch (error) {
        log(
          {
            message: `Resource access check failed for flow ${flowId} tags`,
            level: 'error',
            logger: 'resource-access',
            data: error,
          },
          extra,
        );
        return {
          allowed: false,
          message: [
            'The set of allowed flows that can be queried is limited by the server configuration.',
            `An error occurred while checking if the flow with LUID ${flowId} has one of the allowed tags:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    return { allowed: true, content: flowResult };
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
        log(
          {
            message: `Resource access check failed for view ${viewId} workbook`,
            level: 'error',
            logger: 'resource-access',
            data: error,
          },
          extra,
        );
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
        log(
          {
            message: `Resource access check failed for view ${viewId} project`,
            level: 'error',
            logger: 'resource-access',
            data: error,
          },
          extra,
        );
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
        log(
          {
            message: `Resource access check failed for view ${viewId} tags`,
            level: 'error',
            logger: 'resource-access',
            data: error,
          },
          extra,
        );
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
      log(
        {
          message: `Resource access check failed for custom view ${customViewId}`,
          level: 'error',
          logger: 'resource-access',
          data: error,
        },
        extra,
      );
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
