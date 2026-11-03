import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DIALOG_SESSION_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
import {
  DialogActionInvocation,
  dialogActionInvocationSchema,
  dialogIdentitySchema,
  InvokeDialogActionRequest,
  invokeDialogActionRequestSchema,
  InvokeDialogActionResult,
} from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

// Full identity and native-action schemas exceed the tool-list budget. Keep their complete
// validation during argument parsing while advertising compact object inputs.
function compactObjectSchema<Output>(
  schema: z.ZodType<Output>,
): z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Output> {
  return z.record(z.unknown()).transform((value, context) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) context.addIssue(issue);
      return z.NEVER;
    }
    return parsed.data;
  });
}

const paramsSchema = {
  session: sessionParam(),
  dialog: compactObjectSchema(dialogIdentitySchema).describe(
    'Exact objectName/title/className/sessionId/revision returned for the current dialog.',
  ),
  requestId: invokeDialogActionRequestSchema.shape.requestId.describe(
    'Unique logical request ID; preserve it for retries.',
  ),
  action: compactObjectSchema(dialogActionInvocationSchema).describe(
    'kind plus values for one enabled capability advertised by the current dialog.',
  ),
};

const title = 'Invoke Dialog Action';
const REDACTED_DIALOG_VALUE = '[redacted]';

function invokeDialogActionRouteMissingError(): McpToolError {
  return new McpToolError({
    type: 'endpoint-not-in-this-build',
    message:
      'This Tableau Desktop build does not serve POST /v0/app:invokeDialogAction. No dialog ' +
      'action ran. Do not retry invoke-dialog-action. Ask the user to handle the dialog, or update ' +
      'Tableau Desktop to a build that supports dialog actions.',
    statusCode: 404,
  });
}

type InvokeDialogActionToolArgs = InvokeDialogActionRequest & {
  session: string | undefined;
};

export const getInvokeDialogActionTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'invoke-dialog-action',
    minApiVersion: DIALOG_SESSION_MIN_API_VERSION,
    title,
    description:
      'Use get-active-dialogs context and exact identity. Never guess; act only with user intent. Reuse requestId; poll recentActions for pending status.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, dialog, requestId, action }, extra): Promise<CallToolResult> => {
      const request: InvokeDialogActionRequest = {
        requestId,
        dialog,
        action,
      };
      const loggedArgs: InvokeDialogActionToolArgs = {
        session,
        dialog: {
          objectName: REDACTED_DIALOG_VALUE,
          title: REDACTED_DIALOG_VALUE,
          className: REDACTED_DIALOG_VALUE,
          sessionId: REDACTED_DIALOG_VALUE,
          revision: 0,
        },
        requestId: REDACTED_DIALOG_VALUE,
        action: redactAction(action),
      };
      return await tool.logAndExecute<InvokeDialogActionResult>({
        extra,
        args: loggedArgs,
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'invoke-dialog-action',
                async (executor, signal) => await executor.invokeDialogAction(request, signal),
                {
                  routeMissingError: invokeDialogActionRouteMissingError,
                  stableNotFoundMeansRouteMissing: true,
                },
              ),
          }),
      });
    },
  });

  return tool;
};

function redactAction(action: DialogActionInvocation): DialogActionInvocation {
  switch (action.kind) {
    case 'button':
      return { kind: action.kind, label: REDACTED_DIALOG_VALUE };
    case 'close':
    case 'cancel':
      return { kind: action.kind };
    case 'choose-file':
    case 'choose-directory':
      return { kind: action.kind, path: REDACTED_DIALOG_VALUE };
    case 'choose-files':
      return { kind: action.kind, paths: [REDACTED_DIALOG_VALUE] };
    case 'save-file':
      return {
        kind: action.kind,
        path: REDACTED_DIALOG_VALUE,
        filterId: REDACTED_DIALOG_VALUE,
        overwriteConfirmed: false,
      };
    case 'choose-color':
      return { kind: action.kind, red: 0, green: 0, blue: 0 };
    case 'submit-print':
      return {
        kind: action.kind,
        printerId: REDACTED_DIALOG_VALUE,
        range: 'all-pages',
        sheetScope: 'active-sheet',
        firstPage: 0,
        lastPage: 0,
        copies: 1,
        collate: false,
        exportSelection: false,
      };
  }
}
