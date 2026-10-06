import {
  buildMcpToolCallEvent,
  getEventOutcome,
  MAX_MCP_REQUEST_ID_LENGTH,
  MAX_USER_AGENT_LENGTH,
  McpToolCallDetails,
} from './mcpToolCall.js';
import { CeppSdkEventsModule, McpToolCallBuilder } from './sdkTypes.js';

const SITE_LUID = '11111111-2222-3333-4444-555555555555';
const USER_LUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d{1,9})?)Z$/;

// A stand-in for the SDK's generated McpToolCall: every `setX(value)` stores `x: value`, and the
// built event's toJSON() returns what was set.
function fakeEventsModule(): CeppSdkEventsModule {
  return {
    McpToolCall: {
      builder: () => {
        const values: Record<string, string> = {};
        const builder: McpToolCallBuilder = new Proxy({} as McpToolCallBuilder, {
          get: (_target, prop: string) => {
            if (prop === 'build') {
              return () => ({
                getEventTime: () => values.eventTime,
                isSiteEvent: () => true,
                isTenantEvent: () => false,
                toJSON: () => ({ ...values }),
              });
            }
            return (value: string) => {
              values[prop.charAt(3).toLowerCase() + prop.slice(4)] = value;
              return builder;
            };
          },
        });
        return builder;
      },
    },
  };
}

function details(overrides: Partial<McpToolCallDetails> = {}): McpToolCallDetails {
  return {
    toolName: 'list-workbooks',
    siteLuid: SITE_LUID,
    userLuid: USER_LUID,
    success: true,
    errorCode: '',
    oauthClientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    userAgent: 'claude-ai/0.1.0 (external, cli)',
    mcpRequestId: '42',
    object: undefined,
    ...overrides,
  };
}

function build(overrides: Partial<McpToolCallDetails> = {}): Record<string, unknown> | undefined {
  return buildMcpToolCallEvent(fakeEventsModule(), details(overrides))?.toJSON();
}

describe('getEventOutcome', () => {
  it.each([
    [true, '', 'success'],
    [false, '401', 'unauthorized'],
    [false, '403', 'unauthorized'],
    [false, '400', 'client_error'],
    [false, '404', 'client_error'],
    [false, '500', 'internal_error'],
    [false, '503', 'internal_error'],
    [false, '', 'internal_error'],
  ])('success=%s, errorCode=%j is %s', (success, errorCode, outcome) => {
    expect(getEventOutcome(success, errorCode)).toBe(outcome);
  });
});

describe('buildMcpToolCallEvent', () => {
  it('sets the common site attributes and the event attributes for a successful call', () => {
    const event = build();

    expect(event).toEqual({
      eventTime: expect.stringMatching(ISO_REGEX),
      serviceName: 'tableau-mcp',
      siteLuid: SITE_LUID,
      actorUserLuid: USER_LUID,
      initiatingUserLuid: USER_LUID,
      eventOutcome: 'success',
      toolCallId: expect.stringMatching(UUID_REGEX),
      toolName: 'list-workbooks',
      oauthClientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
      clientName: 'Claude',
      userAgent: 'claude-ai/0.1.0 (external, cli)',
      mcpRequestId: '42',
    });
  });

  it('gives every call its own toolCallId', () => {
    expect(build()?.toolCallId).not.toBe(build()?.toolCallId);
  });

  it('records the outcome and errorCode of a failed call', () => {
    const event = build({ success: false, errorCode: '403' });

    expect(event?.eventOutcome).toBe('unauthorized');
    expect(event?.errorCode).toBe('403');
  });

  it('leaves errorCode unset when the failure has no three-digit status', () => {
    expect(build({ success: false, errorCode: '' })).not.toHaveProperty('errorCode');
    expect(build({ success: false, errorCode: '4xx' })).not.toHaveProperty('errorCode');
  });

  it('returns null when the site or user LUID is missing or not a UUID', () => {
    expect(build({ siteLuid: '' })).toBeUndefined();
    expect(build({ userLuid: '' })).toBeUndefined();
    expect(build({ siteLuid: 'test-site-luid' })).toBeUndefined();
  });

  it('leaves the client attributes unset when there is no client_id', () => {
    const event = build({ oauthClientId: undefined });

    expect(event).not.toHaveProperty('oauthClientId');
    expect(event).not.toHaveProperty('clientName');
  });

  it('records a sanitized client_id and no clientName for an unrecognized client', () => {
    const event = build({ oauthClientId: 'https://user:pw@unknown.example.com/client?x=1#y' });

    expect(event?.oauthClientId).toBe('https://unknown.example.com/client');
    expect(event).not.toHaveProperty('clientName');
  });

  it('uses the first User-Agent value and caps its length', () => {
    expect(build({ userAgent: ['first/1.0', 'second/2.0'] })?.userAgent).toBe('first/1.0');
    expect(build({ userAgent: 'x'.repeat(2000) })?.userAgent).toHaveLength(MAX_USER_AGENT_LENGTH);
  });

  it('caps the length without splitting a surrogate pair', () => {
    // Odd offset, so a UTF-16 cut at the cap would land inside an emoji.
    expect(build({ userAgent: `a${'😀'.repeat(MAX_USER_AGENT_LENGTH)}` })?.userAgent).toBe(
      `a${'😀'.repeat(MAX_USER_AGENT_LENGTH - 1)}`,
    );
  });

  it('leaves userAgent unset when the header is missing or blank', () => {
    expect(build({ userAgent: undefined })).not.toHaveProperty('userAgent');
    expect(build({ userAgent: '  ' })).not.toHaveProperty('userAgent');
  });

  it('caps the length of a client-chosen request id', () => {
    expect(build({ mcpRequestId: 'r'.repeat(1000) })?.mcpRequestId).toHaveLength(
      MAX_MCP_REQUEST_ID_LENGTH,
    );
  });

  it('records the object the call acted against', () => {
    const event = build({ object: { type: 'workbook', luid: SITE_LUID } });

    expect(event).toMatchObject({ objectType: 'workbook', objectLuid: SITE_LUID });
  });

  it('records the object of a failed call too', () => {
    const event = build({
      success: false,
      errorCode: '403',
      object: { type: 'datasource', luid: SITE_LUID },
    });

    expect(event).toMatchObject({ objectType: 'datasource', objectLuid: SITE_LUID });
  });

  it('leaves both object attributes unset when the id is not a LUID', () => {
    const event = build({ object: { type: 'datasource', luid: 'Superstore' } });

    expect(event).not.toHaveProperty('objectType');
    expect(event).not.toHaveProperty('objectLuid');
  });

  it('leaves both object attributes unset when the call has no single object', () => {
    const event = build({ object: undefined });

    expect(event).not.toHaveProperty('objectType');
    expect(event).not.toHaveProperty('objectLuid');
  });
});
