import { describe, expect, it, vi } from 'vitest';

// The CEPP SDK is an internal Nexus-only package, absent here. Mock its `./events`
// subpath with a builder that echoes the values it was given, so we can assert the POC
// event is populated correctly without the real package installed.
vi.mock('@tableau/activitylog-logging-client-ts/events', () => {
  class FakeBuilder {
    values: Record<string, string> = {};
    setEventTime(v: string): this {
      this.values.eventTime = v;
      return this;
    }
    setServiceName(v: string): this {
      this.values.serviceName = v;
      return this;
    }
    setSiteLuid(v: string): this {
      this.values.siteLuid = v;
      return this;
    }
    setActorUserLuid(v: string): this {
      this.values.actorUserLuid = v;
      return this;
    }
    setInitiatingUserLuid(v: string): this {
      this.values.initiatingUserLuid = v;
      return this;
    }
    setPlatform(v: string): this {
      this.values.platform = v;
      return this;
    }
    setPlatformVersion(v: string): this {
      this.values.platformVersion = v;
      return this;
    }
    setOperationType(v: string): this {
      this.values.operationType = v;
      return this;
    }
    build(): Record<string, unknown> {
      const values = this.values;
      return {
        getEventTime: () => values.eventTime,
        isSiteEvent: () => true,
        isTenantEvent: () => false,
        toJSON: () => ({ ...values }),
      };
    }
  }
  return {
    ActivityLogSettingsChange: {
      builder: (): FakeBuilder => new FakeBuilder(),
    },
  };
});

import { buildActivityLogSettingsChangeEvent } from './eventBuilder.js';

describe('buildActivityLogSettingsChangeEvent', () => {
  it('builds an ActivityLogSettingsChange site event via the SDK builder with POC values', async () => {
    const event = await buildActivityLogSettingsChangeEvent();

    expect(event).not.toBeNull();
    expect(event!.isSiteEvent()).toBe(true);
    expect(event!.isTenantEvent()).toBe(false);
    expect(event!.getEventTime()).toBe('2024-06-16T18:03:47.203309Z');
    expect(event!.toJSON()).toEqual({
      eventTime: '2024-06-16T18:03:47.203309Z',
      serviceName: 'tableau-mcp',
      siteLuid: '12345678-1234-1234-1234-123456789abc',
      actorUserLuid: '12345678-1234-1234-1234-123456789abc',
      initiatingUserLuid: '12345678-1234-1234-1234-123456789abc',
      platform: 'Tableau Cloud',
      platformVersion: 'POC',
      operationType: 'create',
    });
  });
});
