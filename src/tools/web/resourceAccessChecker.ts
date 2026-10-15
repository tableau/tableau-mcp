import { log } from '../../logging/logger.js';
import { BoundedContext } from '../../overridableConfig.js';
import { useRestApi } from '../../restApiInstance.js';
import {
  getDatasourceNamesAndTagsByLuid,
  getDatasourceNamesAndTagsQuery,
} from '../../sdks/tableau/methods/lineageUtils.js';
import { DataSource, isEmbeddedDatasource } from '../../sdks/tableau/types/dataSource.js';
import { Flow, FlowOutputStep } from '../../sdks/tableau/types/flow.js';
import { View } from '../../sdks/tableau/types/view.js';
import { Workbook } from '../../sdks/tableau/types/workbook.js';
import {
  RESOURCE_ACCESS_CHECKER_FLOW_API_SCOPES,
  RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
} from '../../server/oauth/scopes.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { getHttpStatus } from '../../utils/getHttpStatus.js';
import { MAX_PAGE_SIZE, paginate } from '../../utils/paginate.js';
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
    workbookLuid,
    supportsWorkbookLuid,
    extra,
  }: {
    datasourceLuid: string;
    // The parent workbook of an embedded datasource; it can't be resolved from the datasource LUID.
    workbookLuid?: string;
    // Whether the calling tool exposes a workbookLuid parameter. Only such callers get the hint to
    // retry with workbookLuid; others get a plain denial for an unreachable embedded datasource.
    supportsWorkbookLuid?: boolean;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<DataSource>> {
    const result = await this._isDatasourceAllowed({
      datasourceLuid,
      workbookLuid,
      supportsWorkbookLuid,
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
    workbookLuid,
    supportsWorkbookLuid,
    extra,
  }: {
    datasourceLuid: string;
    workbookLuid?: string;
    supportsWorkbookLuid?: boolean;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<DataSource>> {
    const allowedDatasourceIds = await this.getAllowedDatasourceIds({ extra });
    const allowedTags = await this.getAllowedTags({ extra });
    const allowedProjectIds = await this.getAllowedProjectIds({ extra });
    const allowedWorkbookIds = await this.getAllowedWorkbookIds({ extra });

    // Embedded datasources can't be allowlisted by LUID, so they are admitted via their workbook,
    // and only when a scope that restricts workbooks is configured. INCLUDE_DATASOURCE_IDS is an
    // absolute ceiling: when it is set, nothing outside it is admitted, embedded datasources
    // included.
    const canAdmitViaWorkbook =
      !allowedDatasourceIds &&
      !!workbookLuid &&
      !!(allowedWorkbookIds || allowedProjectIds || allowedTags);

    // If INCLUDE_DATASOURCE_IDS is defined, check if datasource is in that allowlist.
    const isOutsideAllowedDatasourceIds =
      !!allowedDatasourceIds && !allowedDatasourceIds.has(datasourceLuid);
    const notInAllowedDatasourceIdsResult: AllowedResult<DataSource> = {
      allowed: false,
      message: [
        'The set of allowed data sources that can be queried is limited by the server configuration.',
        `Querying the datasource with LUID ${datasourceLuid} is not allowed.`,
      ].join(' '),
    };
    if (isOutsideAllowedDatasourceIds && !canAdmitViaWorkbook) {
      return notInAllowedDatasourceIdsResult;
    }

    // INCLUDE_WORKBOOK_IDS doesn't restrict datasources on its own, but it must still gate the
    // workbook of an embedded datasource when one is provided.
    const mustCheckWorkbookIds = !!workbookLuid && !!allowedWorkbookIds;
    if (
      !isOutsideAllowedDatasourceIds &&
      !allowedTags &&
      !allowedProjectIds &&
      !mustCheckWorkbookIds
    ) {
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
        return await useRestApi({
          ...extra,
          jwtScopes: RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
          callback: async (restApi) =>
            await paginate({
              pageConfig: { pageSize: MAX_PAGE_SIZE },
              getDataFn: async (pageConfig) => {
                const { pagination, datasources } =
                  await restApi.datasourcesMethods.listDatasources({
                    siteId: restApi.siteId,
                    filter: `name:eq:${name}`,
                    pageSize: pageConfig.pageSize,
                    pageNumber: pageConfig.pageNumber,
                  });
                return { pagination, data: datasources };
              },
            }),
        });
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
      // Query Data Source can fail for an embedded datasource (e.g. 403 when the user can't see the
      // workbook's project, or 404 on some servers). Only these two statuses are treated as a
      // possible embedded datasource; any other failure (500, timeout, 401) is inconclusive and
      // falls through to the published path, failing closed rather than admitting via the workbook.
      const httpStatus = error instanceof Error ? getHttpStatus(error) : undefined;
      const canClassifyAsEmbedded = httpStatus === '403' || httpStatus === '404';

      // The Metadata API's publishedDatasourcesConnection only returns published datasources, so a
      // hit proves this LUID is published. It serves two purposes: a guard against admitting a
      // published datasource through its workbook, and (on 403 only, preserving prior behavior) the
      // name/tags fallback when Query Data Source 403s on project visibility.
      const publishedMetadata = canClassifyAsEmbedded
        ? await getNameAndTagsFromMetadataApi()
        : undefined;

      // Workbook connection datasource IDs are only ever embedded LUIDs, so membership proves the
      // datasource is embedded without Query Data Source. Skip when the Metadata API shows the LUID
      // is published.
      if (workbookLuid && canClassifyAsEmbedded && !publishedMetadata) {
        const connectionDatasourceIds = await this.getWorkbookConnectionDatasourceIds({
          workbookLuid,
          extra,
        }).catch((connectionsError) => {
          log(
            {
              message: `Connections lookup failed for workbook ${workbookLuid}`,
              level: 'warning',
              logger: 'resource-access',
              data: getExceptionMessage(connectionsError),
            },
            extra,
          );
          return undefined;
        });
        if (connectionDatasourceIds?.has(datasourceLuid)) {
          return await this.isEmbeddedDatasourceAllowedViaWorkbook({
            datasourceLuid,
            workbookLuid,
            connectionDatasourceIds,
            extra,
          });
        }
      }

      // Not shown to be embedded, so it is gated as a published datasource from here on.
      if (isOutsideAllowedDatasourceIds) {
        return notInAllowedDatasourceIdsResult;
      }
      if (!allowedTags && !allowedProjectIds) {
        return { allowed: true };
      }

      // Query Data Source returns 403 when the user can't see the data source's parent project,
      // even if they can query the data source itself.
      // The Metadata API isn't subject to that check, so fall back to it.
      const metadata = httpStatus === '403' ? publishedMetadata : undefined;
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

    if (datasource && isEmbeddedDatasource(datasource)) {
      if (!workbookLuid) {
        // Only tools that accept workbookLuid should be told to retry with it; others can't, so
        // they get a plain denial instead of a hint for an argument they don't support.
        const hint = supportsWorkbookLuid
          ? `The datasource with LUID ${datasourceLuid} is an embedded (workbook) data source, so it can only be queried by also providing the workbookLuid of the workbook it belongs to.`
          : `The datasource with LUID ${datasourceLuid} is an embedded (workbook) data source, which cannot be accessed under the current server configuration.`;
        return {
          allowed: false,
          message: [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
            hint,
          ].join(' '),
        };
      }
      return await this.isEmbeddedDatasourceAllowedViaWorkbook({
        datasourceLuid,
        workbookLuid,
        datasource,
        extra,
      });
    }

    if (isOutsideAllowedDatasourceIds) {
      return notInAllowedDatasourceIdsResult;
    }
    if (!allowedTags && !allowedProjectIds) {
      return { allowed: true, content: datasource };
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

      if (!allowedProjectIds.has(datasource.project?.id ?? '')) {
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

  private async getWorkbookConnectionDatasourceIds({
    workbookLuid,
    extra,
  }: {
    workbookLuid: string;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<Set<string>> {
    const connections = await useRestApi({
      ...extra,
      jwtScopes: RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
      callback: async (restApi) =>
        await restApi.workbooksMethods.queryWorkbookConnections({
          siteId: restApi.siteId,
          workbookId: workbookLuid,
        }),
    });
    return new Set(
      connections.flatMap((connection) =>
        connection.datasource ? [connection.datasource.id] : [],
      ),
    );
  }

  // Verifies the datasource belongs to the workbook before gating on it, so an allowed workbook
  // can't be used to reach an unrelated embedded datasource.
  private async isEmbeddedDatasourceAllowedViaWorkbook({
    datasourceLuid,
    workbookLuid,
    datasource,
    connectionDatasourceIds,
    extra,
  }: {
    datasourceLuid: string;
    workbookLuid: string;
    datasource?: DataSource;
    connectionDatasourceIds?: Set<string>;
    extra: TableauWebRequestHandlerExtra;
  }): Promise<AllowedResult<DataSource>> {
    const baseMessage =
      'The set of allowed data sources that can be queried is limited by the server configuration.';

    let datasourceIds = connectionDatasourceIds;
    if (!datasourceIds) {
      try {
        datasourceIds = await this.getWorkbookConnectionDatasourceIds({ workbookLuid, extra });
      } catch (error) {
        log(
          {
            message: `Resource access check failed for workbook ${workbookLuid} connections`,
            level: 'error',
            logger: 'resource-access',
            data: error,
          },
          extra,
        );
        return {
          allowed: false,
          message: [
            baseMessage,
            `An error occurred while checking if the datasource with LUID ${datasourceLuid} belongs to the workbook with LUID ${workbookLuid}:`,
            getExceptionMessage(error),
          ].join(' '),
        };
      }
    }

    if (!datasourceIds.has(datasourceLuid)) {
      return {
        allowed: false,
        message: [
          baseMessage,
          `The datasource with LUID ${datasourceLuid} cannot be queried because it does not belong to the workbook with LUID ${workbookLuid}.`,
        ].join(' '),
      };
    }

    const workbookResult = await this._isWorkbookAllowed({ workbookId: workbookLuid, extra });
    if (!workbookResult.allowed) {
      // workbookResult.message already carries a "limited by the server configuration" sentence, so
      // baseMessage is omitted here to avoid repeating it.
      return {
        allowed: false,
        message: [
          `The embedded datasource with LUID ${datasourceLuid} cannot be queried because its workbook is not allowed:`,
          workbookResult.message,
        ].join(' '),
      };
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
