/**
 * A REPRESENTATIVE EXAMPLE ActivityLog event — NOT a real TMCP/CEPP schema.
 *
 * Real tableau-mcp event schemas are not defined yet. This stands in for one of the
 * SDK's generated event classes (which live under the package's `./events` subpath and
 * follow this exact builder + `ICeppEvent` shape) so the scaffolding compiles and can be
 * exercised end to end. When the real schemas land, delete this file and import the
 * generated event(s) from `@tableau/activitylog-logging-client-ts/events` instead — the
 * builder call sites in `eventBuilder.ts` change to the real class names, nothing else.
 */
import {
  CeppEventAttributeMetadata,
  CeppEventMetadata,
  ICeppEvent,
  ICeppEventBuilder,
  validateAttribute,
} from '../index.js';

const EVENT_TIME_METADATA: CeppEventAttributeMetadata = {
  name: 'eventTime',
  type: 'string',
  displayName: 'Event Time',
  required: true,
  comment: 'UTC timestamp in ISO-8601 string format. Example: 2024-06-16T18:03:47.203309Z',
  validationRegex: '^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2}(?:\\.\\d{1,9})?)Z$',
};

const SITE_LUID_METADATA: CeppEventAttributeMetadata = {
  name: 'siteLuid',
  type: 'string',
  displayName: 'Site Luid',
  required: true,
  comment: 'Site LUID of the Tableau site where the event took place',
  validationRegex: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
};

const ACTOR_USER_LUID_METADATA: CeppEventAttributeMetadata = {
  name: 'actorUserLuid',
  type: 'string',
  displayName: 'Actor User Luid',
  required: false,
  comment: 'User LUID of the user who performed the action that initiated the event',
};

const TOOL_NAME_METADATA: CeppEventAttributeMetadata = {
  name: 'toolName',
  type: 'string',
  displayName: 'Tool Name',
  required: true,
  comment: 'Name of the MCP tool that was invoked (example attribute).',
};

const EVENT_METADATA: CeppEventMetadata = {
  sdkName: 'activitylog-logging-client-ts',
  sdkVersion: '0.1.0',
  eventType: 'EXAMPLE_TOOL_INVOKED',
  eventVersion: '0.1',
  eventCategory: 'example',
  applicableToOnline: true,
  applicableToServer: true,
  customerAccessible: false,
  internalAccessible: true,
  comment: 'Representative example event emitted when an MCP tool is invoked.',
};

export class ExampleToolInvokedEvent implements ICeppEvent {
  readonly eventTime: string;
  readonly siteLuid: string;
  readonly actorUserLuid: string | undefined;
  readonly toolName: string;

  constructor(builder: ExampleToolInvokedEventBuilder) {
    this.eventTime = validateAttribute(builder.eventTime, EVENT_TIME_METADATA);
    this.siteLuid = validateAttribute(builder.siteLuid, SITE_LUID_METADATA);
    this.actorUserLuid = validateAttribute(builder.actorUserLuid, ACTOR_USER_LUID_METADATA);
    this.toolName = validateAttribute(builder.toolName, TOOL_NAME_METADATA);
  }

  static builder(): ExampleToolInvokedEventBuilder {
    return new ExampleToolInvokedEventBuilder();
  }

  getEventMetadata(): CeppEventMetadata {
    return EVENT_METADATA;
  }

  getEventTime(): string {
    return this.eventTime;
  }

  isSiteEvent(): boolean {
    return true;
  }

  isTenantEvent(): boolean {
    return false;
  }

  toJSON(): Record<string, unknown> {
    const record: Record<string, unknown> = {
      eventTime: this.eventTime,
      siteLuid: this.siteLuid,
      toolName: this.toolName,
    };
    if (this.actorUserLuid !== undefined) {
      record.actorUserLuid = this.actorUserLuid;
    }
    return record;
  }
}

export class ExampleToolInvokedEventBuilder implements ICeppEventBuilder<ExampleToolInvokedEvent> {
  eventTime: string | undefined;
  siteLuid: string | undefined;
  actorUserLuid: string | undefined;
  toolName: string | undefined;

  setEventTime(value: string): this {
    this.eventTime = value;
    return this;
  }

  setSiteLuid(value: string): this {
    this.siteLuid = value;
    return this;
  }

  setActorUserLuid(value: string | undefined): this {
    this.actorUserLuid = value;
    return this;
  }

  setToolName(value: string): this {
    this.toolName = value;
    return this;
  }

  build(): ExampleToolInvokedEvent {
    // Required-field enforcement happens inside the event constructor via
    // validateAttribute(), mirroring the SDK's generated builders.
    return new ExampleToolInvokedEvent(this);
  }
}
