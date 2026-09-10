import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  InvokeDialogActionRequest,
  InvokeDialogActionResult,
} from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const actionSchema = z
  .object({
    kind: z.enum(['button', 'close']),
    label: z.string().min(1).optional(),
  })
  .refine(
    (action) =>
      (action.kind === 'button' && action.label !== undefined) ||
      (action.kind === 'close' && action.label === undefined),
    { message: 'button requires label; close omits label' },
  )
  .describe('Exact returned action; button needs label, close omits it.');

const paramsSchema = {
  session: sessionParam(),
  dialog: z
    .object({
      objectName: z.string(),
      title: z.string(),
      className: z.string(),
    })
    .describe('Exact returned dialog identity.'),
  action: actionSchema,
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
    minApiVersion: '0.2.12',
    title,
    description:
      'After get-active-dialogs, use its text and task context to choose one exact returned action. Never guess or retry.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, dialog, action }, extra): Promise<CallToolResult> => {
      const request: InvokeDialogActionRequest = {
        dialog,
        action:
          action.kind === 'button'
            ? { kind: 'button', label: action.label as string }
            : { kind: 'close' },
      };
      const loggedArgs: InvokeDialogActionToolArgs = {
        session,
        dialog: {
          objectName: REDACTED_DIALOG_VALUE,
          title: REDACTED_DIALOG_VALUE,
          className: REDACTED_DIALOG_VALUE,
        },
        action:
          action.kind === 'button'
            ? { kind: 'button', label: REDACTED_DIALOG_VALUE }
            : { kind: 'close' },
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
