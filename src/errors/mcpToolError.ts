import { ZodiosError } from '@zodios/core';
import { Err } from 'ts-results-es';
import { fromError } from 'zod-validation-error/v3';

import { LoadWorkbookXmlError } from '../desktop/commands/workbook/loadWorkbookXml.js';
import { ExecuteCommandError } from '../desktop/toolExecutor/toolExecutor.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';

export class McpToolError extends Error {
  readonly type: string;
  readonly statusCode: number;
  readonly internalStatusCode?: number;
  readonly internalError?: string;
  readonly internalErrorDetails?: string;

  constructor({
    type,
    message,
    statusCode,
    // internal error is any underlying error caused by dependencies
    internalStatusCode,
    internalError,
    internalErrorDetails,
  }: {
    type: string;
    message: string;
    statusCode: number;
    internalStatusCode?: number;
    internalError?: string;
    internalErrorDetails?: string;
  }) {
    super(message);
    this.type = type;
    this.statusCode = statusCode;
    this.internalStatusCode = internalStatusCode;
    this.internalError = internalError;
    this.internalErrorDetails = internalErrorDetails;
  }

  getErrorText(): string {
    return this.message;
  }

  toErr(): Err<this> {
    return new Err(this);
  }
}

export class ArgsValidationError extends McpToolError {
  constructor(message: string) {
    super({ type: 'args-validation', message, statusCode: 400 });
  }
}

// Thrown by paginated list tools when the requested `pageNumber` is beyond the
// reach of the tool's configured MAX_RESULT_LIMIT offset ceiling. Without this
// up-front guard the page would be fetched and then trimmed to zero items,
// surfacing a misleading "no results were found" message even though
// totalAvailable is non-zero. statusCode 400: the requested page is invalid for
// the current configuration.
export class PageExceedsLimitError extends McpToolError {
  constructor(message: string) {
    super({ type: 'page-exceeds-limit', message, statusCode: 400 });
  }
}

export class DatasourceNotAllowedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'datasource-not-allowed', message, statusCode: 403 });
  }
}

// Thrown by the two-phase delete tools when a confirmed delete (`confirm: true`) is requested but the
// target resource is not carrying the pending-deletion tag. The tag is server-side state set by a
// prior, distinct preview call, so its presence — verified by a fresh re-fetch — is the authoritative
// proof that a preview actually ran. Unlike a caller-computable confirmation token, this gate cannot
// be bypassed by deriving a value: the caller has no way to mark the resource as pending deletion
// other than by running the preview phase. statusCode 409: a required precondition/state is missing.
export class PreviewNotRunError extends McpToolError {
  constructor(message: string) {
    super({ type: 'preview-not-run', message, statusCode: 409 });
  }
}

export class FeatureDisabledError extends McpToolError {
  constructor(message: string) {
    super({ type: 'feature-disabled', message, statusCode: 404 });
  }
}

export class FlowNotAllowedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'flow-not-allowed', message, statusCode: 403 });
  }
}

export class PulseDisabledError extends McpToolError {
  constructor() {
    super({ type: 'pulse-disabled', message: 'Pulse is disabled', statusCode: 400 });
  }

  override getErrorText(): string {
    return 'Pulse is disabled on this Tableau Cloud site. To enable Pulse, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.';
  }
}

export class PulseInsightsDisabledError extends McpToolError {
  constructor() {
    super({
      type: 'pulse-insights-disabled',
      message: 'Pulse AI insights are disabled',
      statusCode: 403,
    });
  }

  override getErrorText(): string {
    return 'AI-powered Pulse insights are not enabled on this Tableau Cloud site. This feature requires Tableau+ to be enabled by a site administrator.';
  }
}

export class PulseNotAvailableError extends McpToolError {
  constructor() {
    super({
      type: 'tableau-server',
      message: 'Pulse not available on Tableau Server',
      statusCode: 404,
    });
  }

  override getErrorText(): string {
    return 'Pulse is not available on Tableau Server. Consider disabling the Pulse MCP tools in your client or removing them using the EXCLUDE_TOOLS environment variable. To enable Pulse on your Tableau Cloud site, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.';
  }
}

export class QueryValidationError extends McpToolError {
  constructor(message: string) {
    super({ type: 'query-validation', message, statusCode: 400 });
  }
}

export class PulseInsightsApiError extends McpToolError {
  constructor(message: string, statusCode: number, errorCode?: string, details?: string) {
    super({
      type: 'pulse-insights-api-error',
      message,
      statusCode,
      internalStatusCode: statusCode,
      internalError: errorCode,
      internalErrorDetails: details,
    });
  }
}

export class EmbedTokenNotAvailableError extends McpToolError {
  constructor() {
    super({
      type: 'embed-token-not-available',
      message: 'Failed to get an embed token for the current authentication configuration.',
      statusCode: 500,
    });
  }
}

export class ViewNotAllowedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'view-not-allowed', message, statusCode: 403 });
  }
}

export class CustomViewNotAllowedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'custom-view-not-allowed', message, statusCode: 403 });
  }
}

export class WorkbookNotAllowedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'workbook-not-allowed', message, statusCode: 403 });
  }
}

export class WorkbookNotFoundError extends McpToolError {
  constructor(message: string) {
    super({ type: 'workbook-not-found', message, statusCode: 404 });
  }
}

export class ZodiosValidationError extends McpToolError {
  constructor(error: ZodiosError) {
    super({
      type: 'zodios-error',
      message: error.message,
      statusCode: 400,
      internalError: error.data?.toString(),
      internalErrorDetails: fromError(error.cause).toString(),
    });
  }
}

export class ServiceUnavailableError extends McpToolError {
  constructor(message: string) {
    super({ type: 'service-unavailable', message, statusCode: 503 });
  }
}

export class UnknownError extends McpToolError {
  constructor(message: string, statusCode = 500) {
    super({ type: 'unknown', message, statusCode });
  }
}

export class NoDesktopInstancesFoundError extends McpToolError {
  constructor() {
    super({
      type: 'no-desktop-instances-found',
      message: [
        'No running Tableau Desktop instances found.',
        'Make sure:',
        '  1. Tableau Desktop is running',
        '  2. Agent API is enabled',
        '  3. The manifest file exists in the expected location',
      ].join('\n'),
      statusCode: 404,
    });
  }
}

export class GetEventsFailedError extends McpToolError {
  constructor(error: unknown) {
    super({
      type: 'get-events-failed',
      message: [
        `Failed to get events: ${getExceptionMessage(error)}.`,
        'Make sure:',
        '  1. Tableau Desktop is running',
        '  2. Agent API is enabled',
      ].join('\n'),
      statusCode: 500,
    });
  }
}

export class AdminOnlyError extends McpToolError {
  constructor(message: string) {
    super({ type: 'admin-only', message, statusCode: 403 });
  }
}

export class AdminInsightsUnavailableError extends McpToolError {
  constructor(message: string) {
    super({ type: 'admin-insights-unavailable', message, statusCode: 404 });
  }
}

export class DesktopCommandExecutionError extends McpToolError {
  constructor(error: ExecuteCommandError) {
    super({
      type: 'desktop-command-execution-error',
      message: JSON.stringify(error),
      statusCode: 500,
    });
  }
}

export class WorkbookXmlLoadFailedError extends McpToolError {
  constructor(error: LoadWorkbookXmlError) {
    super({
      type: 'load-workbook-xml-error',
      message: JSON.stringify(error),
      statusCode: 500,
    });
  }
}

export class FileReadError extends McpToolError {
  constructor(error: unknown) {
    super({
      type: 'file-read-error',
      message: `Failed to read file: ${getExceptionMessage(error)}. Make sure the file exists and is readable.`,
      statusCode: 500,
    });
  }
}

// Publish preconditions that fail before any content is written (bad/missing/oversized file, or an
// unresolvable publish target). statusCode 400: the request cannot be satisfied as given.
export class PublishWorkbookError extends McpToolError {
  constructor(message: string) {
    super({ type: 'publish-workbook-error', message, statusCode: 400 });
  }
}

// Bad input to the pure .twbx builder (illegal packageId, unsafe content path, or a .trex whose
// source-location references a file that was not bundled). buildTwbx throws this; the tool wrappers
// catch it and return .toErr() so it renders as a clean 400 tool error instead of a raw stack.
export class BuildTwbxError extends McpToolError {
  constructor(message: string) {
    super({ type: 'build-twbx-error', message, statusCode: 400 });
  }
}

// A requested data-app workspace does not exist for the caller's actor scope, or it has expired and
// is no longer readable. Opaque handles (`appId`) intentionally return the same not-found signal for
// "never existed", "belongs to a different actor", and "expired" so a caller cannot probe for the
// existence of another scope's workspaces. statusCode 404: the handle resolves to nothing usable.
export class DataAppWorkspaceNotFoundError extends McpToolError {
  constructor(message = 'Data app workspace not found or expired.') {
    super({ type: 'data-app-workspace-not-found', message, statusCode: 404 });
  }
}

// A requested validation receipt does not exist for the caller's actor scope, or it has expired.
// Like workspaces, this collapses "wrong scope"/"never existed"/"expired" into one signal so a
// `validationId` from another actor cannot be probed. statusCode 404.
export class DataAppValidationNotFoundError extends McpToolError {
  constructor(message = 'Data app validation not found or expired.') {
    super({ type: 'data-app-validation-not-found', message, statusCode: 404 });
  }
}

// Validation ids are immutable receipt handles. Reusing one must never replace its package bytes or
// metadata, even when concurrent writers race. statusCode 409: the receipt already exists.
export class DataAppValidationAlreadyExistsError extends McpToolError {
  constructor(message = 'Data app validation already exists.') {
    super({ type: 'data-app-validation-already-exists', message, statusCode: 409 });
  }
}

// The caller has no stable actor scope for a persistence operation (e.g. a multi-user HTTP request
// with neither an authenticated Tableau identity nor an MCP session), or attempted to reach a
// workspace/validation outside its own scope. Raw PATs/tokens are never used as a scope key, so an
// unscoped multi-user request is rejected rather than silently sharing storage. statusCode 403.
export class DataAppWorkspaceAccessDeniedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'data-app-workspace-access-denied', message, statusCode: 403 });
  }
}

// A caller-supplied workspace file path failed containment defenses: traversal (`..`), absolute
// paths, backslashes, NUL bytes, a symlink component, or an attempt to overwrite a protected
// tool-managed manifest. statusCode 400: the path can never be satisfied safely.
export class UnsafeWorkspacePathError extends McpToolError {
  constructor(message: string) {
    super({ type: 'unsafe-workspace-path', message, statusCode: 400 });
  }
}

// A workspace mutation would exceed a configured limit: file count, per-file bytes, or total
// workspace bytes. statusCode 413: the payload is too large to store under policy.
export class DataAppWorkspaceLimitExceededError extends McpToolError {
  constructor(message: string) {
    super({ type: 'data-app-workspace-limit-exceeded', message, statusCode: 413 });
  }
}

// patch-data-app-file: the target file is not present in the workspace. Distinct from
// data-app-workspace-not-found (a missing/expired/wrong-scope `appId`): here the workspace resolved
// fine but has no such file. statusCode 404. The caller should create the file with
// upsert-data-app-files instead of patching it.
export class DataAppFileNotFoundError extends McpToolError {
  constructor(message: string) {
    super({ type: 'data-app-file-not-found', message, statusCode: 404 });
  }
}

// patch-data-app-file: the edit's `oldString` anchor was not found in the current file content.
// statusCode 422: the request is well-formed but cannot be applied against the current content. The
// message may include a near-miss hint (e.g. the anchor matches except for line endings).
export class DataAppPatchAnchorNotFoundError extends McpToolError {
  constructor(message: string) {
    super({ type: 'data-app-patch-anchor-not-found', message, statusCode: 422 });
  }
}

// patch-data-app-file: the `oldString` anchor matched more than one location and `replaceAll` was
// not set. statusCode 422. The message includes the match count so the caller can widen the anchor
// with surrounding context or set `replaceAll: true`.
export class DataAppPatchAmbiguousMatchError extends McpToolError {
  constructor(message: string) {
    super({ type: 'data-app-patch-ambiguous-match', message, statusCode: 422 });
  }
}

// patch-data-app-file: an edit supplied an `expectedDigest` that does not match the file's current
// per-file digest — the file changed since the caller last read it. statusCode 409: a concurrency
// conflict. The caller should re-read the file, recompute the edit, and retry.
export class DataAppPatchStaleError extends McpToolError {
  constructor(message: string) {
    super({ type: 'data-app-patch-stale', message, statusCode: 409 });
  }
}

// patch-data-app-file: the target file's bytes are not valid UTF-8 text (e.g. a binary asset), so an
// anchor-based text edit cannot be applied without risking corruption. statusCode 422. The caller
// should rewrite the file whole with upsert-data-app-files instead.
export class DataAppPatchNotTextError extends McpToolError {
  constructor(message: string) {
    super({ type: 'data-app-patch-not-text', message, statusCode: 422 });
  }
}

// search-data-app-file: a regular-expression search exceeded its time budget and was force-aborted.
// This backstops the static backtracking pre-screen (hasCatastrophicBacktracking), which cannot catch
// every super-linear pattern (e.g. overlapping alternations like "(a|aa)+$"): the match runs in a
// worker thread that is terminated on timeout, so one pathological pattern cannot stall the shared
// event loop for other users. statusCode 400: the caller should simplify the pattern or search with a
// literal substring instead.
export class DataAppRegexTimeoutError extends McpToolError {
  constructor(message: string) {
    super({ type: 'data-app-regex-timeout', message, statusCode: 400 });
  }
}
