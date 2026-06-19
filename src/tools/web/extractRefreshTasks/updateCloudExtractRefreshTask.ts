import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { AdminOnlyError, UnknownError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { updateCloudExtractRefreshScheduleSchema } from '../../../sdks/tableau/types/extractRefreshTask.js';
import { WebMcpServer } from '../../../server.web.js';
import { assertAdmin } from '../adminGate.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  taskId: z.string().uuid('taskId must be a valid UUID'),
  schedule: updateCloudExtractRefreshScheduleSchema,
};

export const getUpdateCloudExtractRefreshTaskTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const updateCloudExtractRefreshTaskTool = new WebTool({
    server,
    name: 'update-cloud-extract-refresh-task',
    disabled: !config.adminToolsEnabled,
    description: `
  Updates the schedule of an extract refresh task on Tableau Cloud. Use this to change how often an extract refresh runs (e.g. downgrade Daily → Weekly), shift its time window, or modify the day/hour it executes — without recreating the task.

  This tool is restricted to Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` feature flag to be enabled.

  **Tableau Cloud only.** This tool calls the Cloud variant of the update endpoint and is not appropriate for Tableau Server.

  Use this tool when you need to:
  - Reduce the frequency of an under-used extract refresh (e.g. Hourly → Daily, Daily → Weekly)
  - Move a refresh window to off-peak hours
  - Change the recurrence intervals (e.g. weekday → weekend)

  **Parameters:**
  - \`taskId\` (required) – The ID of the extract refresh task to update. Obtain this from the \`list-extract-refresh-tasks\` tool.
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
      return await updateCloudExtractRefreshTaskTool.logAndExecute<string>({
        extra,
        args,
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: updateCloudExtractRefreshTaskTool.requiredApiScopes,
            callback: async (restApi) => {
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                return new AdminOnlyError(adminResult.error).toErr();
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
