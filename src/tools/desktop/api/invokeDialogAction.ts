import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z } from 'zod';

import {
  DIALOG_ACTION_KINDS,
  DIALOG_PRINT_RANGES,
  DIALOG_SHEET_SCOPES,
  DialogActionInvocation,
  dialogActionInvocationSchema,
  InvokeDialogActionRequest,
  invokeDialogActionRequestSchema,
  InvokeDialogActionResult,
} from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import type { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

// Keep the served schema compact; strict action-field validation runs inside logAndExecute.
const actionSchema = z
  .object({
    kind: z.string(),
  })
  .catchall(z.unknown());

const dialogSchema = z
  .object({
    objectName: z.string(),
    title: z.string(),
    className: z.string(),
    sessionId: z.string(),
    revision: z.number().int().nonnegative(),
  })
  .passthrough();

const paramsSchema = {
  session: sessionParam(),
  dialog: dialogSchema.describe('Identity.'),
  requestId: z.string().optional().describe('Opaque.'),
  action: actionSchema.describe('Flat kind + named values; no input wrapper.'),
};

const title = 'Invoke Dialog Action';
const REDACTED_DIALOG_VALUE = '[redacted]';
const PENDING_RECONCILIATION_GUIDANCE =
  'The action was dispatched and is pending, not indeterminate. Do not replay this mutation. ' +
  'Continue with read only get-active-dialogs calls on the same Desktop session, matching ' +
  'recentActions by status.requestId and status.sessionId from this receipt. Read-only inspection ' +
  'is not an action retry and needs no additional permission. An empty dialogs array does not ' +
  'prove completion or panel closure. Use at most 10 inspections or 30 seconds, whichever comes ' +
  'first. If the matching status is missing, continue inspecting within that budget. On inspection ' +
  'failure, expired or indeterminate status, or budget exhaustion without a terminal status, ' +
  'stop mutations and report the unresolved requestId. After a terminal status, verify the expected ' +
  'dialog and caller state. A separately authorized next action (such as cancel after a rejected ' +
  'save) requires a fresh active dialog identity, its advertised capability, and a new requestId.';

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
  dialog: z.infer<typeof dialogSchema>;
  requestId: string | undefined;
  action: DialogActionInvocation;
};

function currentRequest(
  dialog: z.infer<typeof dialogSchema>,
  requestId: string,
  action: DialogActionInvocation,
): InvokeDialogActionRequest {
  if (dialog.sessionId === undefined || dialog.revision === undefined) {
    throw new McpToolError({
      type: 'invalid_request',
      message: 'Missing dialog session identity.',
      statusCode: 400,
    });
  }
  return invokeDialogActionRequestSchema.parse({
    dialog: { ...dialog, sessionId: dialog.sessionId, revision: dialog.revision },
    requestId,
    action,
  });
}

function redactedAction(action: DialogActionInvocation): DialogActionInvocation {
  switch (action.kind) {
    case DIALOG_ACTION_KINDS[0]:
      return { kind: DIALOG_ACTION_KINDS[0], label: REDACTED_DIALOG_VALUE };
    case DIALOG_ACTION_KINDS[1]:
      return { kind: DIALOG_ACTION_KINDS[1] };
    case DIALOG_ACTION_KINDS[2]:
      return { kind: DIALOG_ACTION_KINDS[2] };
    case DIALOG_ACTION_KINDS[3]:
      return {
        kind: DIALOG_ACTION_KINDS[3],
        path: REDACTED_DIALOG_VALUE,
      };
    case DIALOG_ACTION_KINDS[5]:
      return {
        kind: DIALOG_ACTION_KINDS[5],
        path: REDACTED_DIALOG_VALUE,
      };
    case DIALOG_ACTION_KINDS[4]:
      return {
        kind: DIALOG_ACTION_KINDS[4],
        paths: [REDACTED_DIALOG_VALUE],
      };
    case DIALOG_ACTION_KINDS[6]:
      return {
        kind: DIALOG_ACTION_KINDS[6],
        path: REDACTED_DIALOG_VALUE,
        filterId: REDACTED_DIALOG_VALUE,
        overwriteConfirmed: false,
      };
    case DIALOG_ACTION_KINDS[7]:
      return {
        kind: DIALOG_ACTION_KINDS[7],
        red: 0,
        green: 0,
        blue: 0,
      };
    case DIALOG_ACTION_KINDS[8]:
      return {
        kind: DIALOG_ACTION_KINDS[8],
        printerId: REDACTED_DIALOG_VALUE,
        range: DIALOG_PRINT_RANGES[0],
        sheetScope: DIALOG_SHEET_SCOPES[1],
        firstPage: 0,
        lastPage: 0,
        copies: 1,
        collate: false,
        exportSelection: false,
      };
  }
}

function isOpaqueRequestId(requestId: string): boolean {
  return requestId.length >= 1 && requestId.length <= 128 && /^[!-~]+$/.test(requestId);
}

function hasExactDialogIdentity(dialog: z.infer<typeof dialogSchema>): boolean {
  return Object.keys(dialog).every((key) =>
    ['objectName', 'title', 'className', 'sessionId', 'revision'].includes(key),
  );
}

export const getInvokeDialogActionTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'invoke-dialog-action',
    minApiVersion: '0.2.23',
    title,
    description:
      'get-active-dialogs context: exact action. Never guess or retry mutations. Pending: inspect.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, dialog, requestId, action }, extra): Promise<CallToolResult> => {
      const parsedAction = dialogActionInvocationSchema.safeParse(action);
      const hasSessionId = dialog.sessionId !== undefined;
      const hasRevision = dialog.revision !== undefined;
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
        action: parsedAction.success
          ? redactedAction(parsedAction.data)
          : { kind: DIALOG_ACTION_KINDS[1] },
      };
      return await tool.logAndExecute<InvokeDialogActionResult>({
        extra,
        args: loggedArgs,
        callback: async () =>
          await invokeDialogAction({
            session,
            extra,
            dialog,
            requestId,
            parsedAction,
            hasSessionId,
            hasRevision,
          }),
        getSuccessResult: (result) => ({
          isError: false,
          content: [
            { type: 'text', text: JSON.stringify(result) },
            ...(result.status.state === 'pending'
              ? [{ type: 'text' as const, text: PENDING_RECONCILIATION_GUIDANCE }]
              : []),
          ],
        }),
      });
    },
  });

  return tool;
};

async function invokeDialogAction({
  session,
  extra,
  dialog,
  requestId,
  parsedAction,
  hasSessionId,
  hasRevision,
}: {
  session: string | undefined;
  extra: TableauDesktopRequestHandlerExtra;
  dialog: z.infer<typeof dialogSchema>;
  requestId: string | undefined;
  parsedAction: ReturnType<typeof dialogActionInvocationSchema.safeParse>;
  hasSessionId: boolean;
  hasRevision: boolean;
}): Promise<Result<InvokeDialogActionResult, McpToolError>> {
  if (!parsedAction.success) {
    throw new McpToolError({
      type: 'invalid_request',
      message:
        'The dialog action must exactly match the advertised action input. Use a flat action ' +
        'object: kind and each input.fields name are sibling keys with their required values. ' +
        'Do not nest values under input, fields or values. Local validation failed; no Desktop ' +
        'action was dispatched. Do not guess or retry.',
      statusCode: 400,
    });
  }
  if (!hasExactDialogIdentity(dialog)) {
    throw new McpToolError({
      type: 'invalid_request',
      message: 'The dialog identity contains unsupported fields.',
      statusCode: 400,
    });
  }
  if (!hasSessionId || !hasRevision) {
    throw new McpToolError({
      type: 'invalid_request',
      message:
        'dialog.sessionId and dialog.revision must both be supplied from a fresh dialog inspection result.',
      statusCode: 400,
    });
  }
  if (
    hasSessionId &&
    (typeof dialog.sessionId !== 'string' ||
      typeof dialog.revision !== 'number' ||
      !Number.isInteger(dialog.revision) ||
      dialog.revision < 0)
  ) {
    throw new McpToolError({
      type: 'invalid_request',
      message: 'The dialog session identity is invalid.',
      statusCode: 400,
    });
  }
  if (requestId !== undefined && !isOpaqueRequestId(requestId)) {
    throw new McpToolError({
      type: 'invalid_request',
      message: 'requestId must be a printable opaque identifier up to 128 characters.',
      statusCode: 400,
    });
  }
  const effectiveRequestId = requestId ?? crypto.randomUUID();
  const generatedNativeRequestId = requestId === undefined ? effectiveRequestId : undefined;
  const request = currentRequest(dialog, effectiveRequestId, parsedAction.data);
  const result = await runExternalApiTool({
    session,
    extra,
    callback: async (_executor, _signal, call) =>
      await call(
        'invoke-dialog-action',
        async (executor, signal) => {
          // The outer deadline can win before the aborted transport returns its typed error.
          // Record only an ID generated here; caller-provided values are never echoed by this path.
          if (generatedNativeRequestId !== undefined) {
            extra.deadline?.setNativeDialogRequestId(generatedNativeRequestId);
          }
          return await executor.invokeDialogAction(request, signal);
        },
        {
          routeMissingError: invokeDialogActionRouteMissingError,
          stableNotFoundMeansRouteMissing: true,
        },
      ),
  });
  if (generatedNativeRequestId !== undefined && result.isErr()) {
    result.error.message += `\nDialog requestId=${generatedNativeRequestId}. Inspect recentActions in get-active-dialogs; do not replay.`;
  }
  return result;
}
