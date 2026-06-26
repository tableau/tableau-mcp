import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { AdminOnlyError, ArgsValidationError, UnknownError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { updateCloudExtractRefreshScheduleSchema } from '../../../sdks/tableau/types/extractRefreshTask.js';
import { WebMcpServer } from '../../../server.web.js';
import { assertAdmin } from '../adminGate.js';
import { WebTool } from '../tool.js';

/**
 * Deterministic confirmation token derived from the site + task. The preview phase returns it; the
 * apply phase requires a matching value. This forces an explicit, deliberate second call with a
 * task-specific token rather than a blind one-shot update.
 *
 * NOTE: this is a friction/correctness gate, NOT proof that a preview actually ran. The token is a
 * pure sha256(siteId:taskId) — both inputs are known to any caller (siteId from the connected site,
 * taskId from the tool arg), so a caller can compute it without previewing. Guaranteeing a preview
 * ran would require server-side state. Stateless by design so it works across instances and
 * restarts. Matches the pattern in delete-datasource / delete-workbook.
 */
export function computeConfirmationToken(siteId: string, taskId: string): string {
  return createHash('sha256').update(`${siteId}:${taskId}`).digest('hex').slice(0, 12);
}

const paramsSchema = {
  taskId: z.string().uuid('taskId must be a valid UUID'),
  schedule: updateCloudExtractRefreshScheduleSchema,
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a non-destructive preview: validates the schedule and returns ' +
        'a confirmationToken without calling the Tableau API. When true, applies the schedule ' +
        'change — requires a matching confirmationToken from the preview step.',
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe(
      'Required when confirm is true. The confirmationToken returned by the preview step ' +
        '(confirm omitted/false) for this taskId. The update is rejected without a matching token ' +
        '— a friction gate requiring a deliberate second call. Note the token is a deterministic ' +
        'hash of caller-known inputs, so it adds deliberation but does not by itself prove a ' +
        'preview ran.',
    ),
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

  This tool is **two-phase** to keep the destructive action safe:

  1. **Preview (default — \`confirm\` omitted or false):** validates the proposed schedule, echoes the change that would be applied, returns a \`confirmationToken\`, and does **not** call the Tableau update endpoint.
  2. **Apply (\`confirm: true\` + \`confirmationToken\`):** applies the schedule change. The token from step 1 is required — the update is rejected without it, a friction gate requiring a deliberate second call rather than a blind one-shot update (the token is a deterministic hash of caller-known inputs, so it adds deliberation but does not by itself prove a preview ran).

  **Required human confirmation:** After preview, present the proposed change (task ID + frequency + time window) to the user and get explicit approval before applying. Do not auto-confirm or compute the \`confirmationToken\` yourself — use the exact value the preview returned.

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
  - \`confirm\` (optional) – Set \`true\` to apply the schedule change. Defaults to preview.
  - \`confirmationToken\` (optional) – Required when \`confirm\` is true; the token from the preview step.

  **Schedule constraints (enforced at the schema layer — invalid input is rejected before any Tableau API call):**
  - \`start\` and \`end\` must be zero-padded \`HH:mm:ss\` (e.g. \`"06:00:00"\`, not \`"6:00:00"\`).
  - The **minute** portion of \`start\` (and \`end\`, when present) must be on a 5-minute boundary: \`00\`, \`05\`, \`10\`, \`15\`, \`20\`, \`25\`, \`30\`, \`35\`, \`40\`, \`45\`, \`50\`, or \`55\`, with seconds = \`00\`. \`07:26:00\` is rejected; \`07:25:00\` and \`07:30:00\` are accepted.
  - For \`Hourly\`: the minute portion of \`start\` and \`end\` must match (e.g. \`06:00:00\`/\`18:00:00\` ✓, \`06:00:00\`/\`18:30:00\` ✗); \`end\` must be strictly after \`start\`.
  - For \`Daily\`/\`Weekly\`/\`Monthly\`: \`end\` is ignored — omit it.
  - \`Hourly\` and \`Daily\` require at least one interval with \`weekDay\` (Tableau rejects them otherwise with \`409004\`).
  - \`Weekly\` requires at least one interval with \`weekDay\`; \`Monthly\` requires at least one interval with \`monthDay\`.

  Tableau may still reject a request that passes schema validation with \`409004 Conflict\` for site-specific schedule rules; the tool surfaces Tableau's structured error code/summary/detail in the response so callers can recover.

  **Response:** A preview message (with \`confirmationToken\`) or a confirmation message describing the updated task and its new schedule.

  **Note:** This operation overwrites the existing schedule. To revert, call again with the prior schedule values. Tableau Cloud uses \`tableau:tasks:write\` scope.
  `,
    paramsSchema,
    annotations: {
      title: 'Update Cloud Extract Refresh Task',
      readOnlyHint: false,
      destructiveHint: true,
      // The two-phase contract (first call → preview + token, second call → apply) means the same
      // args do NOT produce the same outcome. A client retrying after a transient failure could
      // call once (preview, no Tableau write) and again (apply with token, mutates), or call twice
      // with `confirm: true` + token and get a token-reject the second time. Either way the
      // operation is not idempotent. Mirrors `delete-extract-refresh-task` and `delete-datasource`.
      idempotentHint: false,
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

              const siteId = restApi.siteId;
              const expectedToken = computeConfirmationToken(siteId, args.taskId);

              // Gate the destructive path on the confirmation token BEFORE any write, so a missing
              // or mismatched token is rejected with zero side effects. Forces a deliberate
              // two-step update; does not prove a preview ran (token is a deterministic hash of
              // caller-known inputs — see computeConfirmationToken).
              if (args.confirm && args.confirmationToken !== expectedToken) {
                return new ArgsValidationError(
                  'Update requires the confirmationToken returned by the preview step. ' +
                    'Run update-cloud-extract-refresh-task with confirm omitted (or false) for this ' +
                    'taskId first, then call again with confirm: true and the confirmationToken from ' +
                    'that response.',
                ).toErr();
              }

              if (!args.confirm) {
                // Preview phase: validate the schedule (already done by Zod above) and echo the
                // proposed change with the confirmation token. No call to Tableau.
                const previewStart = args.schedule.frequencyDetails.start;
                const previewEnd = args.schedule.frequencyDetails.end;
                const previewWindow = previewEnd
                  ? ` (${previewStart}–${previewEnd})`
                  : ` (start ${previewStart})`;
                return new Ok(
                  `Preview — would update extract refresh task '${args.taskId}' to ${args.schedule.frequency}${previewWindow}. ` +
                    'NEXT STEP — REQUIRED: present this proposed change to the user and obtain ' +
                    "explicit approval. Do NOT update without the user's approval in this " +
                    'conversation. ' +
                    `Once approved, call again with confirm: true and confirmationToken: ${expectedToken}.`,
                );
              }

              const result = await restApi.tasksMethods.updateCloudExtractRefreshTask({
                siteId,
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
