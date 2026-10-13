import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z } from 'zod';

import {
  AnyInvokeDialogActionResult,
  DIALOG_ACTION_KINDS,
  DIALOG_PRINT_RANGES,
  DIALOG_SHEET_SCOPES,
  DialogActionInvocation,
  dialogActionInvocationSchema,
  InvokeDialogActionRequest,
  invokeDialogActionRequestSchema,
  legacyDialogActionSchema,
  LegacyInvokeDialogActionRequest,
  legacyInvokeDialogActionRequestSchema,
  NativeInvokeDialogActionRequest,
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
    sessionId: z.string().optional(),
    revision: z.number().optional(),
  })
  .passthrough();

const paramsSchema = {
  session: sessionParam(),
  dialog: dialogSchema.describe('Identity.'),
  requestId: z.string().optional().describe('Opaque.'),
  action: actionSchema.describe('input.fields.'),
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
  dialog: {
    objectName: string;
    title: string;
    className: string;
    sessionId?: string;
    revision?: number;
  };
  requestId: string | undefined;
  action: DialogActionInvocation;
};

function nativeRequest(
  dialog: z.infer<typeof dialogSchema>,
  requestId: string,
  action: DialogActionInvocation,
): NativeInvokeDialogActionRequest {
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

function legacyRequest(
  dialog: z.infer<typeof dialogSchema>,
  action: DialogActionInvocation,
): LegacyInvokeDialogActionRequest {
  const parsedAction = legacyDialogActionSchema.safeParse(action);
  if (!parsedAction.success) {
    throw new McpToolError({
      type: 'invalid_request',
      message: 'A native dialog action requires a fresh dialog session identity.',
      statusCode: 400,
    });
  }
  return legacyInvokeDialogActionRequestSchema.parse({
    dialog: { objectName: dialog.objectName, title: dialog.title, className: dialog.className },
    action: parsedAction.data,
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
    minApiVersion: '0.2.13',
    title,
    description: 'get-active-dialogs context: exact action. Never guess or retry.',
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
      const hasNativeIdentity = hasSessionId && hasRevision;
      const loggedArgs: InvokeDialogActionToolArgs = {
        session,
        dialog: {
          objectName: REDACTED_DIALOG_VALUE,
          title: REDACTED_DIALOG_VALUE,
          className: REDACTED_DIALOG_VALUE,
        },
        requestId: hasNativeIdentity ? REDACTED_DIALOG_VALUE : undefined,
        action: parsedAction.success
          ? redactedAction(parsedAction.data)
          : { kind: DIALOG_ACTION_KINDS[1] },
      };
      return await tool.logAndExecute<AnyInvokeDialogActionResult>({
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
}): Promise<Result<AnyInvokeDialogActionResult, McpToolError>> {
  if (!parsedAction.success) {
    throw new McpToolError({
      type: 'invalid_request',
      message: 'The dialog action must exactly match the advertised action input.',
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
  if (hasSessionId !== hasRevision) {
    throw new McpToolError({
      type: 'invalid_request',
      message:
        'dialog.sessionId and dialog.revision must be supplied together from a fresh dialog inspection result.',
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
      message: 'The native dialog identity is invalid.',
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
  if (!hasSessionId && requestId !== undefined) {
    throw new McpToolError({
      type: 'invalid_request',
      message: 'requestId requires a native dialog identity.',
      statusCode: 400,
    });
  }
  const generatedNativeRequestId =
    hasSessionId && requestId === undefined ? crypto.randomUUID() : undefined;
  const request: InvokeDialogActionRequest | LegacyInvokeDialogActionRequest = hasSessionId
    ? nativeRequest(
        dialog,
        requestId ?? generatedNativeRequestId ?? crypto.randomUUID(),
        parsedAction.data,
      )
    : legacyRequest(dialog, parsedAction.data);
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
