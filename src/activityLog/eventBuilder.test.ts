import { describe, expect, it } from 'vitest';

import { buildExampleToolInvokedEvent } from './eventBuilder.js';
import { InvalidCeppEventAttributeError } from './sdk/index.js';

const SITE_LUID = '11111111-1111-1111-1111-111111111111';
const USER_LUID = '22222222-2222-2222-2222-222222222222';
const EVENT_TIME = '2024-06-16T18:03:47.203309Z';

describe('buildExampleToolInvokedEvent', () => {
  it('builds a site event carrying the tool-call context', () => {
    const event = buildExampleToolInvokedEvent(
      { siteLuid: SITE_LUID, userLuid: USER_LUID, toolName: 'list-projects' },
      EVENT_TIME,
    );

    expect(event.isSiteEvent()).toBe(true);
    expect(event.isTenantEvent()).toBe(false);
    expect(event.getEventTime()).toBe(EVENT_TIME);
    expect(event.toJSON()).toEqual({
      eventTime: EVENT_TIME,
      siteLuid: SITE_LUID,
      actorUserLuid: USER_LUID,
      toolName: 'list-projects',
    });
  });

  it('omits actorUserLuid when userLuid is empty', () => {
    const event = buildExampleToolInvokedEvent(
      { siteLuid: SITE_LUID, userLuid: '', toolName: 'list-projects' },
      EVENT_TIME,
    );

    expect(event.toJSON()).not.toHaveProperty('actorUserLuid');
  });

  it('defaults eventTime to an ISO-8601 timestamp when not supplied', () => {
    const event = buildExampleToolInvokedEvent({
      siteLuid: SITE_LUID,
      userLuid: USER_LUID,
      toolName: 'list-projects',
    });

    expect(event.getEventTime()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  });

  it('rejects a malformed siteLuid via SDK attribute validation', () => {
    expect(() =>
      buildExampleToolInvokedEvent(
        { siteLuid: 'not-a-luid', userLuid: USER_LUID, toolName: 'list-projects' },
        EVENT_TIME,
      ),
    ).toThrow(InvalidCeppEventAttributeError);
  });

  it('rejects an empty required toolName', () => {
    expect(() =>
      buildExampleToolInvokedEvent(
        { siteLuid: SITE_LUID, userLuid: USER_LUID, toolName: '' },
        EVENT_TIME,
      ),
    ).toThrow(InvalidCeppEventAttributeError);
  });
});
