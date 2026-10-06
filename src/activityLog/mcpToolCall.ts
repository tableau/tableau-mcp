import { randomUUID } from 'node:crypto';

import {
  getClientDisplayName,
  sanitizeClientIdForTelemetry,
} from '../telemetry/clientDisplayName.js';
import { CeppSdkEventsModule, ICeppEvent } from './sdkTypes.js';

/** `serviceName` on every event, and the `{service}` in the site event file name. */
export const SERVICE_NAME = 'tableau-mcp';

// Client-chosen, so capped to keep a record well under the shipper's line limit.
export const MAX_USER_AGENT_LENGTH = 512;
export const MAX_MCP_REQUEST_ID_LENGTH = 200;

export const LUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HTTP_STATUS_REGEX = /^[1-5][0-9]{2}$/;

// Kebab-case, matching the resource types the delete-content tool already takes.
export type ActivityLogObjectType =
  | 'custom-view'
  | 'datasource'
  | 'extract-refresh-task'
  | 'flow'
  | 'flow-run'
  | 'flow-task'
  | 'pulse-metric-definition'
  | 'user'
  | 'view'
  | 'workbook';

/** The single Tableau object a tool call acts against. */
export type ActivityLogObject = {
  type: ActivityLogObjectType;
  luid: string;
};

export type McpToolCallDetails = {
  toolName: string;
  siteLuid: string;
  userLuid: string;
  /** Whether the client got a usable result, which is not always the telemetry `success`. */
  success: boolean;
  /** HTTP status of the failure, or '' when unknown. */
  errorCode: string;
  /** Raw OAuth client_id; sanitized before it is recorded. */
  oauthClientId: string | undefined;
  userAgent: string | string[] | undefined;
  mcpRequestId: string;
  object: ActivityLogObject | undefined;
};

export type EventOutcome = 'success' | 'unauthorized' | 'client_error' | 'internal_error';

// The server's own "not allowed" errors use 403, so they count as unauthorized. A failure with no
// known status is internal_error, matching the 500 logAndExecute defaults a thrown error to.
export function getEventOutcome(success: boolean, errorCode: string): EventOutcome {
  if (success) {
    return 'success';
  }
  if (errorCode === '401' || errorCode === '403') {
    return 'unauthorized';
  }
  if (/^4[0-9]{2}$/.test(errorCode)) {
    return 'client_error';
  }
  return 'internal_error';
}

/**
 * Returns `null` when the call can't be attributed to a site and user. The SDK validates
 * attributes only on success outcomes, so every value set here is checked here.
 */
export function buildMcpToolCallEvent(
  events: CeppSdkEventsModule,
  details: McpToolCallDetails,
): ICeppEvent | null {
  const { toolName, siteLuid, userLuid, success, errorCode, oauthClientId, mcpRequestId, object } =
    details;
  if (!LUID_REGEX.test(siteLuid) || !LUID_REGEX.test(userLuid)) {
    return null;
  }

  const builder = events.McpToolCall.builder()
    .setEventTime(new Date().toISOString())
    .setServiceName(SERVICE_NAME)
    .setSiteLuid(siteLuid)
    // No impersonation in MCP: the user who made the call is also the one it ran as.
    .setActorUserLuid(userLuid)
    .setInitiatingUserLuid(userLuid)
    .setEventOutcome(getEventOutcome(success, errorCode))
    .setToolCallId(randomUUID())
    .setToolName(toolName);

  if (!success && HTTP_STATUS_REGEX.test(errorCode)) {
    builder.setErrorCode(errorCode);
  }

  const sanitizedClientId = sanitizeClientIdForTelemetry(oauthClientId);
  if (sanitizedClientId) {
    builder.setOauthClientId(sanitizedClientId);
  }

  const clientName = getClientDisplayName(oauthClientId);
  if (clientName) {
    builder.setClientName(clientName);
  }

  const userAgent = (
    Array.isArray(details.userAgent) ? details.userAgent[0] : details.userAgent
  )?.trim();
  if (userAgent) {
    builder.setUserAgent(truncate(userAgent, MAX_USER_AGENT_LENGTH));
  }

  if (mcpRequestId) {
    builder.setMcpRequestId(truncate(mcpRequestId, MAX_MCP_REQUEST_ID_LENGTH));
  }

  // The id comes from the client's arguments, which may not be a LUID (e.g. a name).
  if (object && LUID_REGEX.test(object.luid)) {
    builder.setObjectType(object.type).setObjectLuid(object.luid);
  }

  return builder.build();
}

// Cuts by code point so a surrogate pair isn't split into invalid Unicode.
function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : Array.from(value).slice(0, maxLength).join('');
}
