import { BLOCKING_DIALOG_GUIDANCE } from '../desktop/callDeadline.js';
import { ExecuteCommandError } from '../desktop/externalApi/executorTypes.js';
import {
  BARE_COMMAND_FAILURE_GUIDANCE,
  isBareCommandFailure,
} from '../desktop/wrappers/applyFailureClassifier.js';
import type { GetDashboardXmlError } from '../desktop/wrappers/getDashboardXml.js';
import type { GetWorksheetXmlError } from '../desktop/wrappers/getWorksheetXml.js';
import type { LoadDashboardXmlError } from '../desktop/wrappers/loadDashboardXml.js';
import type { LoadWorkbookXmlError } from '../desktop/wrappers/loadWorkbookXml.js';
import type { LoadWorksheetXmlError } from '../desktop/wrappers/loadWorksheetXml.js';
import {
  type StructuredResult,
  type WireStructuredContent,
  wireStructuredContent,
} from '../tools/desktop/structuredContent.js';
import { McpToolError } from './mcpToolError.js';

// Load XML errors preserve Desktop's message when present; otherwise serialize structural errors.
function xmlLoadErrorMessage(
  error: LoadWorkbookXmlError | LoadWorksheetXmlError | LoadDashboardXmlError,
): string {
  return 'message' in error && typeof error.message === 'string'
    ? error.message
    : JSON.stringify(error);
}

/**
 * Signals that a multi-step operation did not fully complete while preserving
 * the complete machine-readable recovery payload in the MCP error body.
 */
export class IncompleteOperationError<T extends object> extends McpToolError {
  readonly structuredContent?: WireStructuredContent;
  private readonly recoveryPayload: StructuredResult<T>;

  constructor(recoveryPayload: StructuredResult<T>) {
    super({
      type: 'incomplete-operation',
      message: 'The requested operation did not complete.',
      statusCode: 409,
    });
    this.recoveryPayload = recoveryPayload;
    const { structuredContent, ...body } = recoveryPayload;
    // A client that prefers structuredContent never reads getErrorText() below, so the
    // recovery payload has to ride in the block too — otherwise the agent is told only
    // "do this next" with no record of which asks failed or how far the operation got.
    this.structuredContent = structuredContent
      ? wireStructuredContent(body, structuredContent)
      : undefined;
  }

  override getErrorText(): string {
    const { structuredContent: _, ...body } = this.recoveryPayload;
    return JSON.stringify(body);
  }
}

/**
 * The image-render call exceeded its deadline. Distinct from client cancellation: the render
 * hangs indefinitely when Tableau Desktop is showing a modal dialog that blocks rendering. Use
 * the same exact, bounded dialog recovery as other ordinary Desktop timeouts rather than retrying
 * the export or requiring an immediate human-only dismissal.
 */
export class ImageExportTimeoutError extends McpToolError {
  constructor(label: string, timeoutMs: number) {
    const seconds = Math.round(timeoutMs / 1000);
    super({
      type: 'image-export-timeout',
      message: [
        `${label} image export exceeded ${seconds}s and was aborted.`,
        BLOCKING_DIALOG_GUIDANCE,
      ].join('\n'),
      statusCode: 504,
    });
  }
}

export class DesktopCommandExecutionError extends McpToolError {
  // A timeout counts as dialog-blocked too: the dedicated dialog tools may recover an ordinary
  // hung call, while the error guidance still forbids blindly retrying the originating operation.
  readonly blockedByDesktopDialog: boolean;

  constructor(error: ExecuteCommandError, fix?: string) {
    const message = formatDesktopCommandExecutionError(error);
    super({
      type: 'desktop-command-execution-error',
      message: fix ? `${message}\n${fix}` : message,
      statusCode: 500,
    });
    this.blockedByDesktopDialog =
      error.type === 'command-timed-out' ||
      (error.type === 'command-failed' && error.error?.code === 'awaiting-user');
  }
}

function formatDesktopCommandExecutionError(error: ExecuteCommandError): string {
  if (error.type !== 'command-failed') {
    return JSON.stringify(error);
  }

  const commandError = error.error;
  const message = commandError?.message;
  if (!message) {
    return JSON.stringify(error);
  }

  const tableauErrorCode = commandError['tableau-error-code'];
  const formattedMessage =
    typeof tableauErrorCode === 'string' && tableauErrorCode.length > 0
      ? `${message}\ntableau-error-code: ${tableauErrorCode}`
      : message;
  return isBareCommandFailure(message)
    ? `${formattedMessage}\n${BARE_COMMAND_FAILURE_GUIDANCE}`
    : formattedMessage;
}

export class WorkbookXmlLoadFailedError extends McpToolError {
  constructor(error: LoadWorkbookXmlError) {
    super({
      type: 'load-workbook-xml-error',
      message: xmlLoadErrorMessage(error),
      statusCode: 500,
    });
  }
}

export class WorksheetXmlLoadFailedError extends McpToolError {
  constructor(error: LoadWorksheetXmlError, fix?: string) {
    const message = xmlLoadErrorMessage(error);
    super({
      type: 'load-worksheet-xml-error',
      message: fix ? `${message}\n${fix}` : message,
      statusCode: 500,
    });
  }
}

export class GetWorksheetXmlFailedError extends McpToolError {
  constructor(error: GetWorksheetXmlError) {
    super({
      type: 'get-worksheet-xml-error',
      message: JSON.stringify(error),
      statusCode: 500,
    });
  }
}

export class GetDashboardXmlFailedError extends McpToolError {
  constructor(error: GetDashboardXmlError) {
    super({
      type: 'get-dashboard-xml-error',
      message: JSON.stringify(error),
      statusCode: 500,
    });
  }
}

export class DashboardXmlLoadFailedError extends McpToolError {
  constructor(error: LoadDashboardXmlError) {
    super({
      type: 'load-dashboard-xml-error',
      message: xmlLoadErrorMessage(error),
      statusCode: 500,
    });
  }
}

// A storyboard serializes as a `<dashboard type='storyboard'>`, so it shares the dashboard load
// path and its error shape; only the error `type` differs so the agent sees a storyboard-scoped
// failure rather than a misleading dashboard one.
export class StoryboardXmlLoadFailedError extends McpToolError {
  constructor(error: LoadDashboardXmlError) {
    super({
      type: 'load-storyboard-xml-error',
      message: xmlLoadErrorMessage(error),
      statusCode: 500,
    });
  }
}
