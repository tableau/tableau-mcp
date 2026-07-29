/**
 * Vendored minimal surface of `@tableau/activitylog-logging-client-ts` (v0.1.0).
 *
 * WHY THIS EXISTS: tableau-mcp is a public GitHub repo. The real ActivityLog / CEPP
 * logging SDK is published only to Salesforce's internal Nexus registry (BASIC-auth,
 * not reachable by external contributors or public CI), so depending on it directly
 * would break `npm install` for everyone outside the Salesforce network. Until the
 * package is available on a public registry, this file vendors the exact subset of the
 * SDK's root (`.`) export that the scaffolding uses.
 *
 * SWAPPING TO THE REAL PACKAGE: add `@tableau/activitylog-logging-client-ts` to
 * package.json and replace `from '.../sdk/index.js'` imports with
 * `from '@tableau/activitylog-logging-client-ts'`. The exported names and signatures
 * below mirror the package 1:1, so no other code changes are required. Then delete
 * this directory.
 *
 * DO NOT extend this shim with app-specific logic — it is a faithful mirror, nothing more.
 */
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Event contracts
// ---------------------------------------------------------------------------

export interface CeppEventAttributeMetadata {
  readonly name: string;
  readonly type: string;
  readonly displayName: string;
  readonly required: boolean;
  readonly comment: string;
  readonly validationRegex?: string;
}

export interface CeppEventMetadata {
  readonly sdkName: string;
  readonly sdkVersion: string;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly eventCategory: string;
  readonly applicableToOnline: boolean;
  readonly applicableToServer: boolean;
  readonly customerAccessible: boolean;
  readonly internalAccessible: boolean;
  readonly comment: string;
}

export interface ICeppEvent {
  getEventMetadata(): CeppEventMetadata;
  getEventTime(): string;
  isSiteEvent(): boolean;
  isTenantEvent(): boolean;
  toJSON(): Record<string, unknown>;
}

export interface ICeppEventBuilder<T extends ICeppEvent> {
  build(): T;
}

// ---------------------------------------------------------------------------
// Attribute validation
// ---------------------------------------------------------------------------

export class InvalidCeppEventAttributeError extends Error {
  readonly attributeName: string;

  constructor(attributeName: string, message: string) {
    super(message);
    this.name = 'InvalidCeppEventAttributeError';
    this.attributeName = attributeName;
  }
}

export function validateAttribute<T>(
  value: T | undefined | null,
  metadata: CeppEventAttributeMetadata,
): T {
  const name = metadata.name;

  if (!metadata.required) {
    return value as T;
  }

  if (value === undefined || value === null) {
    throw new InvalidCeppEventAttributeError(name, `${name} is required, so cannot be null`);
  }

  if (metadata.type !== 'string') {
    return value;
  }

  if (typeof value !== 'string') {
    throw new InvalidCeppEventAttributeError(
      name,
      `${name} requires a String, value is of type ${typeof value}`,
    );
  }

  if (value === '') {
    throw new InvalidCeppEventAttributeError(name, `${name} is required, so cannot be empty`);
  }

  if (value.trim() === '') {
    throw new InvalidCeppEventAttributeError(name, `${name} is required, so cannot be blank`);
  }

  const regex = metadata.validationRegex;
  if (regex !== undefined && regex !== '') {
    let pattern: RegExp;
    try {
      // Full-string anchoring matches Java's Pattern.matches(), not Go's partial MatchString.
      pattern = new RegExp(`^(?:${regex})$`);
    } catch {
      throw new InvalidCeppEventAttributeError(
        name,
        `${name} could not be validated because the validation regex is invalid: ${regex}`,
      );
    }
    if (!pattern.test(value)) {
      throw new InvalidCeppEventAttributeError(
        name,
        `${name} is not valid according to the validation regex`,
      );
    }
  }

  return value as T;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export interface CeppLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export class ConsoleLogger implements CeppLogger {
  info(message: string): void {
    // eslint-disable-next-line no-console -- faithful mirror of the SDK's default logger.
    console.log(message);
  }

  warn(message: string): void {
    console.warn(message);
  }

  error(message: string): void {
    console.error(message);
  }
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export class CeppEventRecord {
  readonly traceUuid: string;
  readonly event: ICeppEvent;

  private constructor(event: ICeppEvent, traceUuid: string) {
    this.event = event;
    this.traceUuid = traceUuid;
  }

  static create(event: ICeppEvent): CeppEventRecord {
    return new CeppEventRecord(event, randomUUID());
  }

  static createBatch(events: ICeppEvent[]): CeppEventRecord[] {
    const sharedTraceUuid = randomUUID();
    return events.map((event) => new CeppEventRecord(event, sharedTraceUuid));
  }

  toJSON(): Record<string, unknown> {
    return {
      traceUuid: this.traceUuid,
      event: this.event.toJSON(),
      metadata: this.event.getEventMetadata(),
    };
  }
}

export interface CeppEventRecorderConfig {
  readonly recordingEnabled: boolean;
  readonly tableauOnline: boolean;
  readonly ioErrorSuppressionEnabled: boolean;
}

export interface ICeppEventRecorder {
  record(event: ICeppEvent): void;
  recordBatch(events: ICeppEvent[]): void;
}

export abstract class AbstractCeppEventRecorder implements ICeppEventRecorder {
  protected readonly config: CeppEventRecorderConfig;
  protected readonly logger: CeppLogger;

  constructor(config: CeppEventRecorderConfig, logger?: CeppLogger) {
    this.config = config;
    this.logger = logger ?? new ConsoleLogger();
  }

  record(event: ICeppEvent): void {
    if (event === null || event === undefined) {
      return;
    }

    if (!this.isRecordingEnabled()) {
      return;
    }

    if (!this.isRecordingApplicable(event)) {
      return;
    }

    const record = CeppEventRecord.create(event);
    this.emitRecordSafe(record);
  }

  recordBatch(events: ICeppEvent[]): void {
    if (events === null || events === undefined) {
      return;
    }

    if (!this.isRecordingEnabled()) {
      return;
    }

    const applicableEvents = events.filter(
      (e) => e !== null && e !== undefined && this.isRecordingApplicable(e),
    );

    if (applicableEvents.length === 0) {
      return;
    }

    const records = CeppEventRecord.createBatch(applicableEvents);
    for (const record of records) {
      this.emitRecordSafe(record);
    }
  }

  private isRecordingEnabled(): boolean {
    return this.config.recordingEnabled;
  }

  private isRecordingApplicable(event: ICeppEvent): boolean {
    const metadata = event.getEventMetadata();
    return (
      (metadata.applicableToOnline && this.config.tableauOnline) ||
      (metadata.applicableToServer && !this.config.tableauOnline)
    );
  }

  private emitRecordSafe(record: CeppEventRecord): void {
    try {
      this.emitRecord(record);
    } catch (e) {
      if (this.config.ioErrorSuppressionEnabled && this.isIoError(e)) {
        this.logger.error(
          `CEPP recording error suppressed: ${e instanceof Error ? e.message : String(e)}`,
        );
      } else {
        throw e;
      }
    }
  }

  // Suppress transient sink failures, but let genuine programming errors surface:
  // attribute-validation failures and TypeError/RangeError signal a caller or schema
  // bug, not I/O noise, so they are excluded. Non-Error throws are treated as I/O.
  private isIoError(e: unknown): boolean {
    if (!(e instanceof Error)) return true;
    const name = e.name;
    return (
      name !== 'InvalidCeppEventAttributeError' && name !== 'TypeError' && name !== 'RangeError'
    );
  }

  protected abstract emitRecord(record: CeppEventRecord): void;
}
