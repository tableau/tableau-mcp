/**
 * Hand-owned type surface for `@tableau/activitylog-logging-client-ts`.
 *
 * WHY THIS EXISTS: tableau-mcp is a PUBLIC npm package. The CEPP logging SDK is
 * published only to Salesforce's internal Nexus registry, so it is NOT a declared
 * dependency here and is absent from public CI / external installs. The SDK is loaded
 * at runtime via a dynamic `import()` behind the `ACTIVITY_LOG_ENABLED` flag, and only
 * resolves where an internal/hosted deployment has installed it (the "extra setup" a
 * hosted install does — see the TMCP↔ActivityLog design thread). Because the module
 * isn't resolvable at compile time, we can't `import type` from it; these interfaces
 * mirror the exact subset of the SDK's `.` and `./events` exports that we call, so the
 * dynamic imports can be cast to a typed shape without a compile-time dependency.
 *
 * These are type-only declarations: this file emits no runtime code. Keep it a faithful
 * 1:1 mirror of the SDK surface we touch — do not add app logic here.
 */

/** `.` export — recorder config (mirrors SDK `CeppEventRecorderConfig`). */
export interface CeppEventRecorderConfig {
  readonly recordingEnabled: boolean;
  readonly tableauOnline: boolean;
  readonly ioErrorSuppressionEnabled: boolean;
}

/** `.` export — the pluggable logger the SDK writes records/diagnostics through. */
export interface CeppLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** `.` export — options bag for the SDK's `CeppEventLoggingRecorder`. */
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

/** `.` export — the recorder contract (subset: we only call `record`). */
export interface ICeppEventRecorder {
  record(event: ICeppEvent): void;
}

/** Shape of the SDK's `.` (root) export — only the recorder we instantiate. */
export interface CeppSdkRootModule {
  CeppEventLoggingRecorder: new (options: CeppEventLoggingRecorderOptions) => ICeppEventRecorder;
}

/**
 * `./events` export — the generated `ActivityLogSettingsChange` event's fluent builder.
 * Only the setters we call plus `build()`; required fields are enforced inside `build()`
 * by the SDK (throws on missing/invalid), which is why we do no validation ourselves.
 */
export interface ActivityLogSettingsChangeBuilder {
  setEventTime(value: string): ActivityLogSettingsChangeBuilder;
  setServiceName(value: string): ActivityLogSettingsChangeBuilder;
  setSiteLuid(value: string): ActivityLogSettingsChangeBuilder;
  setActorUserLuid(value: string): ActivityLogSettingsChangeBuilder;
  setInitiatingUserLuid(value: string): ActivityLogSettingsChangeBuilder;
  setPlatform(value: string): ActivityLogSettingsChangeBuilder;
  setPlatformVersion(value: string): ActivityLogSettingsChangeBuilder;
  setOperationType(value: string): ActivityLogSettingsChangeBuilder;
  build(): ICeppEvent;
}

/** Shape of the SDK's `./events` export — only the event class we build. */
export interface CeppSdkEventsModule {
  ActivityLogSettingsChange: {
    builder(): ActivityLogSettingsChangeBuilder;
  };
}
