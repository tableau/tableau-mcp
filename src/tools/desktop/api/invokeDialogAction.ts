import { randomUUID } from 'node:crypto';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  DialogIdentity,
  dialogIdentitySchema,
  InvokeDialogActionRequest,
  InvokeDialogActionResult,
} from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const messageBoxActionSchema = z
  .object({ kind: z.enum(['button', 'close', 'cancel']), label: z.string().min(1).optional() })
  .strict()
  .refine(({ kind, label }) => (kind === 'button') === (label !== undefined), {
    message: 'button needs label; close and cancel take none',
  });
type MessageBoxAction = z.infer<typeof messageBoxActionSchema>;

const paramsSchema = {
  session: sessionParam(),
  dialog: dialogIdentitySchema.describe(''),
  action: messageBoxActionSchema.describe(''),
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

type InvokeDialogActionToolArgs = {
  session: string | undefined;
  dialog: DialogIdentity;
  action: MessageBoxAction;
};

export const getInvokeDialogActionTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'invoke-dialog-action',
    minApiVersion: '0.2.26',
    title,
    description: 'Use get-active-dialogs context; exact action only. Never guess or retry.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, dialog, action }, extra): Promise<CallToolResult> => {
      const request: InvokeDialogActionRequest = {
        dialog: {
          objectName: dialog.objectName,
          title: dialog.title,
          className: dialog.className,
          sessionId: dialog.sessionId,
          revision: dialog.revision,
        },
        requestId: randomUUID(),
        action:
          action.kind === 'button'
            ? { kind: 'button', label: action.label ?? '' }
            : { kind: action.kind },
      };
      const loggedArgs: InvokeDialogActionToolArgs = {
        session,
        dialog: {
          objectName: REDACTED_DIALOG_VALUE,
          title: REDACTED_DIALOG_VALUE,
          className: REDACTED_DIALOG_VALUE,
          sessionId: dialog.sessionId,
          revision: dialog.revision,
        },
        action: action.label === undefined ? action : { ...action, label: REDACTED_DIALOG_VALUE },
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
