import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { PreviewNotRunError, UnknownError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/featureGate.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  UpdateCloudExtractRefreshSchedule,
  updateCloudExtractRefreshScheduleSchema,
} from '../../../sdks/tableau/types/extractRefreshTask.js';
import { WebMcpServer } from '../../../server.web.js';
import { getAppConfig } from '../../../web/apps/appConfig.js';
import { AppApprovalEvidence, getMutationPreviewTtlMs, NoEvidence } from '../_lib/evidence.js';
import { guardMutation, MutationTarget } from '../_lib/mutationGuard.js';
import { AppToolResult, WebTool } from '../tool.js';

/**
 * The confirm-panel payload the update-cloud-extract-refresh-task preview returns (flag-ON) as
 * `AppToolResult.data`, serialized into the tool-result text the MCP-Apps iframe parses to render the
 * HITL confirm UI describing the SCHEDULE CHANGE (frequency + time window + a live countdown to
 * `expiresAtMs`). The full `schedule` object is carried so the confirm tool can apply the exact same
 * change. No secret/token is carried — the approval is presence-based server-side.
 */
export type UpdateCloudExtractRefreshTaskConfirmPanel = {
  kind: 'update-cloud-extract-refresh-task-confirm';
  taskId: string;
  schedule: UpdateCloudExtractRefreshSchedule;
  frequency: string;
  start: string;
  end?: string;
  expiresAtMs: number;
};

const paramsSchema = {
  taskId: z.string().uuid('taskId must be a valid UUID'),
  schedule: updateCloudExtractRefreshScheduleSchema,
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a non-destructive preview: reports the new schedule that would be ' +
        'applied without changing anything. When true, applies the schedule update. The update is ' +
        'gated on this flag so a schedule is never overwritten without an explicit confirmed call.',
    ),
};

export const getUpdateCloudExtractRefreshTaskTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  // MCP-Apps HITL: when the flag is ON, the preview carries an app so the host renders an iframe
  // confirm panel and the schedule change is applied as a human gesture
  // (confirm-update-cloud-extract-refresh-task). Flag OFF → no `app`, byte-identical to today's
  // confirm-only behavior.
  const mcpAppsEnabled = getFeatureGate().isFeatureEnabled('mcp-apps');

  const updateCloudExtractRefreshTaskTool = new WebTool({
    server,
    name: 'update-cloud-extract-refresh-task',
    disabled: !config.adminToolsEnabled,
    ...(mcpAppsEnabled ? { app: getAppConfig('update-cloud-extract-refresh-task') } : {}),
    description: `
  Updates the schedule of an extract refresh task on Tableau Cloud. Use this to change how often an extract refresh runs (e.g. downgrade Daily → Weekly), shift its time window, or modify the day/hour it executes — without recreating the task.

  This tool is restricted to Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` feature flag to be enabled.

  **Tableau Cloud only.** This tool calls the Cloud variant of the update endpoint and is not appropriate for Tableau Server.

  This mutation is gated on an explicit confirmation flag: with \`confirm\` omitted or false the tool runs a non-destructive preview that reports the schedule that would be applied without changing anything; set \`confirm: true\` to apply the update. Present the change to the user and get explicit approval before confirming.

  Use this tool when you need to:
  - Reduce the frequency of an under-used extract refresh (e.g. Hourly → Daily, Daily → Weekly)
  - Move a refresh window to off-peak hours
  - Change the recurrence intervals (e.g. weekday → weekend)

  **Parameters:**
  - \`taskId\` (required) – The ID of the extract refresh task to update. Obtain this from the \`list-extract-refresh-tasks\` tool.
  - \`confirm\` (optional) – Set \`true\` to apply the update. When omitted or false, previews the change without applying it.
  - \`schedule\` (required) – The new schedule to apply. Replaces the existing schedule wholesale; partial-field merging is not supported by the Tableau API.
    - \`frequency\` (required) – One of \`Hourly\`, \`Daily\`, \`Weekly\`, \`Monthly\`.
    - \`frequencyDetails.start\` (required) – Start time in 24-hour \`HH:mm:ss\` format, e.g. \`"06:00:00"\`.
    - \`frequencyDetails.end\` (required for \`Hourly\`; omit for \`Daily\`/\`Weekly\`/\`Monthly\`) – End time in 24-hour \`HH:mm:ss\` format. For \`Hourly\` its minute portion must match \`start\` and it must be strictly after \`start\`.
    - \`frequencyDetails.intervals.interval\` (optional) – Array of recurrence intervals. Each entry can specify \`weekDay\` (Sunday..Saturday), \`monthDay\`, \`hours\`, or \`minutes\` depending on the frequency.

  **Schedule constraints (enforced at the schema layer — invalid input is rejected before any Tableau API call):**
  - \`start\` and \`end\` must be zero-padded \`HH:mm:ss\` (e.g. \`"06:00:00"\`, not \`"6:00:00"\`).
  - The **minute** portion of \`start\` (and \`end\`, when present) must be on a 5-minute boundary: \`00\`, \`05\`, \`10\`, \`15\`, \`20\`, \`25\`, \`30\`, \`35\`, \`40\`, \`45\`, \`50\`, or \`55\`, with seconds = \`00\`. \`07:26:00\` is rejected; \`07:25:00\` and \`07:30:00\` are accepted.
  - For \`Hourly\`: the minute portion of \`start\` and \`end\` must match (e.g. \`06:00:00\`/\`18:00:00\` ✓, \`06:00:00\`/\`18:30:00\` ✗); \`end\` must be strictly after \`start\`.
  - For \`Daily\`/\`Weekly\`/\`Monthly\`: \`end\` is ignored — omit it.
  - \`Hourly\` and \`Daily\` require at least one interval with \`weekDay\` (Tableau rejects them otherwise with \`409004\`).
  - \`Weekly\` requires at least one interval with \`weekDay\`; \`Monthly\` requires at least one interval with \`monthDay\`.

  Tableau may still reject a request that passes schema validation with \`409004 Conflict\` for site-specific schedule rules; the tool surfaces Tableau's structured error code/summary/detail in the response so callers can recover.

  **Response:** A confirmation message describing the updated task and its new schedule.

  **Note:** This operation overwrites the existing schedule. To revert, call again with the prior schedule values. Tableau Cloud uses \`tableau:tasks:write\` scope.
  `,
    paramsSchema,
    annotations: {
      title: 'Update Cloud Extract Refresh Task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return await updateCloudExtractRefreshTaskTool.logAndExecute<
        string | AppToolResult<UpdateCloudExtractRefreshTaskConfirmPanel>
      >({
        extra,
        args,
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: updateCloudExtractRefreshTaskTool.requiredApiScopes,
            callback: async (restApi) => {
              // Flag ON (MCP-Apps HITL): the model-driven confirm:true path is CLOSED so an agent
              // cannot self-confirm a schedule change by re-calling this tool — the only route to
              // applying the change is a human gesture in the confirm panel
              // (confirm-update-cloud-extract-refresh-task). Reject before any side effect. Flag OFF
              // keeps the original confirm-only path intact.
              if (args.confirm && mcpAppsEnabled) {
                return new PreviewNotRunError(
                  'Mutation blocked: changing an extract refresh schedule requires a human ' +
                    'confirmation in the update-cloud-extract-refresh-task approval panel. Run ' +
                    'update-cloud-extract-refresh-task in preview (omit confirm) to open the panel; the ' +
                    'change is applied by confirm-update-cloud-extract-refresh-task only when a person ' +
                    "clicks Apply. The assistant cannot confirm on the user's behalf.",
                ).toErr();
              }

              // Confirm-only mutation: no preview→confirm evidence to establish/verify, but still
              // route the admin gate, identity/target resolution, and authoritative audit through the
              // shared mutation guard. The guard audits both the preview (confirm omitted) and the
              // confirmed update.
              const resolveTarget = async (): Promise<MutationTarget> => ({
                id: args.taskId,
                kind: 'extract-refresh-task',
              });
              const guardResult = await guardMutation({
                restApi,
                extra,
                tool: 'update-cloud-extract-refresh-task',
                action: 'update',
                mode: 'confirm-only',
                phase: args.confirm ? 'confirm' : 'preview',
                evidence: new NoEvidence(),
                resolveTarget,
              });
              if (guardResult.isErr()) {
                return guardResult.error.toErr();
              }

              // Preview phase: report the schedule that would be applied without changing anything.
              if (!args.confirm) {
                const { frequency, frequencyDetails } = args.schedule;
                const window = frequencyDetails.end
                  ? ` (${frequencyDetails.start}–${frequencyDetails.end})`
                  : ` (start ${frequencyDetails.start})`;

                // Flag ON: record a single-use, TTL-bounded human-approval window and return an
                // AppToolResult so the host renders the in-iframe confirm panel describing the schedule
                // change. The change is then applied by the model-invisible
                // confirm-update-cloud-extract-refresh-task tool — the approval recorded here is what its
                // AppApprovalEvidence verifies. No secret is transported; approval is presence-based,
                // keyed server-side by site+user+task.
                if (mcpAppsEnabled) {
                  await new AppApprovalEvidence('update-cloud-extract-refresh-task').establish({
                    restApi,
                    siteId: restApi.siteId,
                    target: { id: args.taskId, kind: 'extract-refresh-task' },
                    tool: 'confirm-update-cloud-extract-refresh-task',
                    userLuid: extra.getUserLuid(),
                  });
                  const expiresAtMs = Date.now() + getMutationPreviewTtlMs();
                  return new Ok<AppToolResult<UpdateCloudExtractRefreshTaskConfirmPanel>>({
                    data: {
                      kind: 'update-cloud-extract-refresh-task-confirm',
                      taskId: args.taskId,
                      schedule: args.schedule,
                      frequency,
                      start: frequencyDetails.start,
                      end: frequencyDetails.end,
                      expiresAtMs,
                    },
                    // No web URL to embed for a confirm panel; the host renders from `data`.
                    url: '',
                  });
                }

                // Flag OFF: today's exact preview text. No approval recorded, no iframe.
                return new Ok(
                  `Preview — extract refresh task '${args.taskId}' would be updated to: ${frequency}${window}. ` +
                    'No change has been made. ' +
                    'NEXT STEP — REQUIRED: present this change to the user and ask them to explicitly ' +
                    'confirm it. Do NOT apply without the user’s approval. ' +
                    'Once approved, call again with confirm: true to apply the new schedule.',
                );
              }

              const result = await restApi.tasksMethods.updateCloudExtractRefreshTask({
                siteId: restApi.siteId,
                taskId: args.taskId,
                schedule: args.schedule,
              });

              if (result.isErr()) {
                if (result.error.type === 'tableau-api') {
                  const { status, code, summary, detail } = result.error;
                  // 404 from Cloud commonly means the tool was called against a Tableau Server
                  // site or the taskId doesn't exist on this site — surface a Cloud-only hint
                  // instead of the bare "Not Found".
                  if (status === 404) {
                    const codeStr = code ? ` [${code}]` : '';
                    return new UnknownError(
                      `Tableau 404${codeStr}: extract refresh task '${args.taskId}' not found. This tool is Tableau Cloud only — verify you're connected to a Cloud site (not Server) and that the taskId came from list-extract-refresh-tasks.`,
                      404,
                    ).toErr();
                  }
                  const codeStr = code ? ` [${code}]` : '';
                  const summaryDetail = [summary, detail].filter(Boolean).join(': ');
                  const tail = summaryDetail ? `: ${summaryDetail}` : '';
                  return new UnknownError(`Tableau ${status}${codeStr}${tail}`, status).toErr();
                }
                return new UnknownError(result.error.message).toErr();
              }

              const updated = result.value;
              // Fall back to args for every field — the Cloud response payload varies by site
              // and we don't want a partial response to produce a misleading message.
              const frequency = updated.schedule?.frequency ?? args.schedule.frequency;
              const start =
                updated.schedule?.frequencyDetails?.start ?? args.schedule.frequencyDetails.start;
              const end =
                updated.schedule?.frequencyDetails?.end ?? args.schedule.frequencyDetails.end;
              const window = end ? ` (${start}–${end})` : ` (start ${start})`;
              return new Ok(
                `Extract refresh task '${args.taskId}' has been successfully updated. New schedule: ${frequency}${window}.`,
              );
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return updateCloudExtractRefreshTaskTool;
};
