import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { flowsApis } from '../apis/flowsApi.js';
import { RestApiCredentials } from '../restApi.js';
import { TableauRestError } from '../tableauRestError.js';
import { Flow, FlowConnection, FlowOutputStep, FlowRun } from '../types/flow.js';
import { RunFlowJob } from '../types/job.js';
import { Pagination } from '../types/pagination.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Flows methods of the Tableau Server REST API
 *
 * @export
 * @class FlowsMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm
 */
export default class FlowsMethods extends AuthenticatedMethods<typeof flowsApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, flowsApis, { axiosConfig }), creds);
  }

  /**
   * Returns the flows on a site.
   *
   * Required scopes: `tableau:flows:read`
   *
   * @param siteId - The Tableau site ID
   * @param filter - Optional filter string in the format field:operator:value
   * @param sort - Optional sort expression (e.g. createdAt:desc)
   * @param pageSize - Items per page (1-1000, default 100)
   * @param pageNumber - Offset for paging (default 1)
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flows_for_site
   */
  queryFlowsForSite = async ({
    siteId,
    filter,
    sort,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    filter?: string;
    sort?: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<{ pagination: Pagination; flows: Flow[] }> => {
    const response = await this._apiClient.queryFlowsForSite({
      params: { siteId },
      queries: { filter, sort, pageSize, pageNumber },
      ...this.authHeader,
    });
    return {
      pagination: response.pagination,
      flows: response.flows.flow ?? [],
    };
  };

  /**
   * Returns information about the specified flow, including the flow's output steps,
   * project, owner, tags, and parameters.
   *
   * Required scopes: `tableau:flows:read`
   *
   * @param siteId - The Tableau site ID
   * @param flowId - The ID of the flow to return information for
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow
   */
  queryFlow = async ({
    siteId,
    flowId,
  }: {
    siteId: string;
    flowId: string;
  }): Promise<{ flow: Flow; outputSteps: FlowOutputStep[] }> => {
    const response = await this._apiClient.queryFlow({
      params: { siteId, flowId },
      ...this.authHeader,
    });
    return {
      flow: response.flow,
      outputSteps: response.flowOutputSteps?.flowOutputStep ?? [],
    };
  };

  /**
   * Returns a list of input data connections for the specified flow.
   *
   * Required scopes: `tableau:flow_connections:read`
   *
   * @param siteId - The Tableau site ID
   * @param flowId - The ID of the flow to return connections for
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow_connections
   */
  queryFlowConnections = async ({
    siteId,
    flowId,
  }: {
    siteId: string;
    flowId: string;
  }): Promise<FlowConnection[]> => {
    const response = await this._apiClient.queryFlowConnections({
      params: { siteId, flowId },
      ...this.authHeader,
    });
    return response.connections.connection ?? [];
  };

  /**
   * Returns flow runs on a site, optionally filtered (e.g. by flowId).
   *
   * Required scopes: `tableau:flow_runs:read`
   *
   * @param siteId - The Tableau site ID
   * @param filter - Optional filter string (e.g. flowId:eq:abc-123)
   * @param sort - Optional sort expression (e.g. startedAt:desc)
   * @param pageSize - Items per page (1-1000, default 100)
   * @param pageNumber - Offset for paging (default 1)
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_runs
   */
  getFlowRuns = async ({
    siteId,
    filter,
    sort,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    filter?: string;
    sort?: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<FlowRun[]> => {
    const response = await this._apiClient.getFlowRuns({
      params: { siteId },
      queries: { filter, sort, pageSize, pageNumber },
      ...this.authHeader,
    });
    return response.flowRuns.flowRuns ?? [];
  };

  /**
   * Runs the specified flow on demand ("Run Flow Now") and returns the async
   * background job. By default every output step runs; pass `outputStepIds` to
   * run a subset. `runMode` defaults to `full` server-side.
   *
   * Required scopes: `tableau:flows:run`
   * Requires Data Management + Tableau Prep Conductor; Run Now must be enabled
   * on the site.
   *
   * @param siteId - The Tableau site ID
   * @param flowId - The ID of the flow to run (sent in BOTH the URI and the body)
   * @param runMode - Optional `full` | `incremental`
   * @param outputStepIds - Optional subset of output step IDs to run
   * @param parameterSpecs - Optional flow parameter overrides
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#run_flow_now
   */
  runFlowNow = async ({
    siteId,
    flowId,
    runMode,
    outputStepIds,
    parameterSpecs,
  }: {
    siteId: string;
    flowId: string;
    runMode?: 'full' | 'incremental';
    outputStepIds?: string[];
    parameterSpecs?: Array<{ parameterId: string; overrideValue: string }>;
  }): Promise<RunFlowJob> => {
    if (outputStepIds?.length === 0) {
      throw new Error(
        'outputStepIds must contain at least one output step id when provided; omit it to run all output steps.',
      );
    }

    const raw = await this._apiClient.runFlowNow(
      {
        flowRunSpec: {
          // flowId is required in the body in addition to the URI path.
          flowId,
          ...(runMode && { runMode }),
          ...(parameterSpecs && parameterSpecs.length > 0
            ? { flowParameterSpecs: { flowParameterSpec: parameterSpecs } }
            : {}),
          ...(outputStepIds && outputStepIds.length > 0
            ? { flowOutputSteps: { flowOutputStep: outputStepIds.map((id) => ({ id })) } }
            : {}),
        },
      },
      {
        params: { siteId, flowId },
        ...this.authHeader,
      },
    );
    return raw.job;
  };

  /**
   * Requests cancellation of a queued or in-progress flow run, addressed by
   * its flow *run* id. No request body; a successful call returns HTTP 200 with a
   * `{}` body.
   *
   * Some domain failures (e.g. "flow run already complete", code 403135) are
   * returned by Tableau as HTTP 200 with an `{ error: { code, summary, detail } }`
   * envelope rather than a non-2xx status, so axios does not throw. This method
   * detects that envelope and throws a {@link TableauRestError} so those cases
   * flow through the same error-mapping path as real non-2xx responses.
   *
   * Cancellation is asynchronous: the server may reconcile the run's terminal
   * status after the request. If the run is already in its final
   * output-write phase, that write may complete and the final status may be
   * Completed or Failed rather than Cancelled.
   *
   * Required scopes: `tableau:flow_runs:update`
   *
   * @param siteId - The Tableau site ID
   * @param flowRunId - The ID of the flow run to cancel
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#cancel_flow_run
   */
  cancelFlowRun = async ({
    siteId,
    flowRunId,
  }: {
    siteId: string;
    flowRunId: string;
  }): Promise<void> => {
    const body = await this._apiClient.cancelFlowRun(undefined, {
      params: { siteId, flowRunId },
      ...this.authHeader,
    });
    const tableauError = (body as { error?: { code?: string; summary?: string; detail?: string } })
      ?.error;
    if (tableauError && (tableauError.code || tableauError.summary)) {
      throw new TableauRestError(tableauError);
    }
  };
}
