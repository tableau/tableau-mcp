/**
 * Hand-written types for the parts of `@tableau/activitylog-logging-client-ts` this server uses.
 *
 * tableau-mcp is a public npm package, but the CEPP logging SDK is published only to Salesforce's
 * internal registry, so it is not a declared dependency and is missing from public CI and external
 * installs. The SDK is loaded at runtime with a dynamic `import()` (see `sdk.ts`) and is only found
 * where the hosted deployment installed it. Because it can't be resolved at compile time, we can't
 * `import type` from it; these interfaces mirror the subset of its `.` and `./events` exports that
 * we call. Type-only: this file emits no runtime code.
 */

/** `.` export — recorder config (mirrors SDK `CeppEventRecorderConfig`). */
export interface CeppEventRecorderConfig {
  readonly recordingEnabled: boolean;
  readonly tableauOnline: boolean;
  readonly ioErrorSuppressionEnabled: boolean;
}

/** `.` export — the logger the SDK writes records and its own diagnostics through. */
export interface CeppLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** `.` export — options for the SDK's `CeppEventLoggingRecorder`. */
export interface CeppEventLoggingRecorderOptions {
  config: CeppEventRecorderConfig;
  logger?: CeppLogger;
  siteLogger?: CeppLogger;
  tenantLogger?: CeppLogger;
}

/** A built CEPP event. Opaque to us — we only hand it to a recorder. */
export interface ICeppEvent {
  getEventTime(): string;
  isSiteEvent(): boolean;
  isTenantEvent(): boolean;
  toJSON(): Record<string, unknown>;
}

/** `.` export — the recorder contract (we only call `record`). */
export interface ICeppEventRecorder {
  record(event: ICeppEvent): void;
}

/** Shape of the SDK's `.` (root) export. */
export interface CeppSdkRootModule {
  CeppEventLoggingRecorder: new (options: CeppEventLoggingRecorderOptions) => ICeppEventRecorder;
}

/**
 * `./events` export — the generated `McpToolCall` event's builder: the common site attributes plus
 * the event's own attributes, and `build()`. When the outcome is success, `build()` validates every
 * attribute (required, regex) and throws on a bad value. For any other outcome it only validates
 * `eventOutcome`, so callers must not rely on it to catch bad values on failed calls.
 */
export interface McpToolCallBuilder {
  setEventTime(value: string): McpToolCallBuilder;
  setServiceName(value: string): McpToolCallBuilder;
  setSiteLuid(value: string): McpToolCallBuilder;
  setActorUserLuid(value: string): McpToolCallBuilder;
  setInitiatingUserLuid(value: string): McpToolCallBuilder;
  setEventOutcome(value: string): McpToolCallBuilder;
  setToolCallId(value: string): McpToolCallBuilder;
  setToolName(value: string): McpToolCallBuilder;
  setOauthClientId(value: string): McpToolCallBuilder;
  setClientName(value: string): McpToolCallBuilder;
  setUserAgent(value: string): McpToolCallBuilder;
  setMcpRequestId(value: string): McpToolCallBuilder;
  setObjectType(value: string): McpToolCallBuilder;
  setObjectLuid(value: string): McpToolCallBuilder;
  setErrorCode(value: string): McpToolCallBuilder;
  build(): ICeppEvent;
}

/** Shape of the SDK's `./events` export — only the event class we build. */
export interface CeppSdkEventsModule {
  McpToolCall: {
    builder(): McpToolCallBuilder;
  };
}
