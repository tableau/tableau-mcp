export const activityLogObjectTypes = [
  'custom-view',
  'datasource',
  'extract-refresh-task',
  'flow',
  'flow-run',
  'flow-task',
  'pulse-metric-definition',
  'user',
  'view',
  'workbook',
] as const;

// Kebab-case, matching the resource types the delete-content tool already takes.
export type ActivityLogObjectType = (typeof activityLogObjectTypes)[number];

/** The single Tableau object a tool call acts against. */
export type ActivityLogObject = {
  type: ActivityLogObjectType;
  luid: string;
};

export type ToolCallDetails = {
  toolName: string;
  /** Empty when the call failed before sign-in established it. */
  siteLuid: string;
  /** Empty when the call failed before sign-in established it. */
  userLuid: string;
  /** Whether the client got a usable result, which is not always the telemetry `success`. */
  success: boolean;
  /** HTTP status of the failure, or '' when unknown. */
  errorCode: string;
  /** The OAuth client_id, already sanitized for storage. */
  oauthClientId: string | undefined;
  /** Display name of a recognized OAuth client. */
  clientName: string | undefined;
  /** Raw, client-chosen header value: bound its length before storing it. */
  userAgent: string | string[] | undefined;
  /** Client-chosen: bound its length before storing it. */
  mcpRequestId: string;
  /** Only set when the id the client passed is a LUID. */
  object: ActivityLogObject | undefined;
};

/**
 * Records a finished tool call in the Activity Log. The default does nothing; a hosted deployment
 * supplies its own through `ACTIVITY_LOG_PROVIDER=custom`.
 */
export interface ActivityLogProvider {
  /**
   * A throw or rejection is logged and dropped: it never changes the tool's result. The synchronous
   * part runs before the result is returned, so do I/O asynchronously; errors raised later from a
   * timer or event emitter can't be caught here.
   */
  recordToolCall(details: ToolCallDetails): void | Promise<void>;

  /**
   * Flush buffered events and release resources on shutdown. Awaited from the process's
   * SIGTERM/SIGINT handler. Optional: a provider that writes through needs nothing here.
   */
  close?(): Promise<void>;
}
