import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import * as discoveryModule from '../../../desktop/externalApi/discovery.js';
import { GetEventsFailedError } from '../../../errors/mcpToolError.js';
import { GetEventsResponse } from '../../../sdks/desktop/agentApi/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCheckForUserChangesTool } from './checkForUserChanges.js';

vi.mock('../../../desktop/externalApi/discovery.js');

describe('checkForUserChangesTool', () => {
  const resultSchema = z.object({
    message: z.string(),
    instructions: z.string().optional(),
    events: z.array(z.string()).optional(),
    currentSequence: z.number().optional(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([]);
  });

  it('should create a tool instance with correct properties', () => {
    const checkForUserChangesTool = getCheckForUserChangesTool(new DesktopMcpServer());
    expect(checkForUserChangesTool.name).toBe('check-for-user-changes');
    expect(checkForUserChangesTool.description).toBe('Check workbook event sequence.');
    expect(checkForUserChangesTool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      sinceSequence: expect.any(Object),
    });
    expect(checkForUserChangesTool.annotations).toMatchObject({
      title: 'Check for User Changes',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('should return checkpoint when sinceSequence is not provided', async () => {
    const mockGetExecutor = vi.fn().mockResolvedValue({
      getEvents: vi.fn().mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: {
          events: [],
          latest_sequence: 42,
          count: 0,
        },
      }),
    });

    const result = await getToolResult({
      session: '12345',
      sinceSequence: undefined,
      mockGetExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj).toMatchObject({
      message: 'Current event sequence checkpoint.',
      instructions: 'Use this sequence number in subsequent calls to check for user changes.',
      currentSequence: 42,
    });
  });

  it('should detect no user changes when count is 0', async () => {
    const mockGetExecutor = vi.fn().mockResolvedValue({
      getEvents: vi.fn().mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: {
          events: [],
          latest_sequence: 50,
          count: 0,
        },
      }),
    });

    const result = await getToolResult({
      session: '12345',
      sinceSequence: 50,
      mockGetExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj).toMatchObject({
      message: 'No user changes detected since sequence 50.',
      currentSequence: 50,
    });
  });

  it('reports a nonzero change count even when event details are not returned', async () => {
    const mockGetExecutor = vi.fn().mockResolvedValue({
      getEvents: vi.fn().mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: {
          events: [],
          latest_sequence: 55,
          count: 2,
        },
      }),
    });

    const result = await getToolResult({
      session: '12345',
      sinceSequence: 50,
      mockGetExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('User changes detected');
    expect(resultObj.message).toContain('2 events occurred since sequence 50');
    expect(resultObj.instructions).toContain('event details were not returned');
    expect(resultObj.currentSequence).toBe(55);
  });

  it('reports changes when count is zero but event details are returned', async () => {
    const mockGetExecutor = vi.fn().mockResolvedValue({
      getEvents: vi.fn().mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: {
          events: [
            {
              sequence: 51,
              timestamp: '2026-05-26T10:00:00Z',
              type: 'doc:field-added-event',
            },
          ],
          latest_sequence: 51,
          count: 0,
        },
      }),
    });

    const result = await getToolResult({
      session: '12345',
      sinceSequence: 50,
      mockGetExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('User changes detected');
    expect(resultObj.message).toContain('inconsistent-response');
    expect(resultObj.events).toEqual(['[51] 2026-05-26T10:00:00Z: doc:field-added-event']);
    expect(resultObj.instructions).toContain('Treat the workbook as changed');
    expect(resultObj.currentSequence).toBe(51);
  });

  it('should detect user changes with single event', async () => {
    const mockEventsResponse: GetEventsResponse = {
      events: [
        {
          sequence: 2,
          timestamp: '2026-05-06T16:56:35Z',
          type: 'doc:update-field-relatability-event',
        },
      ],
      latest_sequence: 2,
      count: 1,
    };

    const mockGetExecutor = vi.fn().mockResolvedValue({
      getEvents: vi.fn().mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: mockEventsResponse,
      }),
    });

    const result = await getToolResult({
      session: '12345',
      sinceSequence: 1,
      mockGetExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj).toMatchObject({
      message:
        '⚠️ User changes detected! 1 event occurred since sequence 1. The user may have modified the workbook.',
      events: ['[2] 2026-05-06T16:56:35Z: doc:update-field-relatability-event'],
      instructions: 'Consider refreshing the workbook state before making further changes.',
      currentSequence: 2,
    });
  });

  it('should detect user changes with multiple events', async () => {
    const mockGetExecutor = vi.fn().mockResolvedValue({
      getEvents: vi.fn().mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: {
          events: [
            {
              sequence: 43,
              timestamp: '2026-05-26T10:00:00Z',
              type: 'doc:editor-commit-ended-event',
            },
            {
              sequence: 44,
              timestamp: '2026-05-26T10:00:01Z',
              type: 'doc:update-field-relatability-event',
            },
            {
              sequence: 45,
              timestamp: '2026-05-26T10:00:02Z',
              type: 'doc:field-added-event',
            },
          ],
          latest_sequence: 45,
          count: 3,
        },
      }),
    });

    const result = await getToolResult({
      session: '12345',
      sinceSequence: 42,
      mockGetExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj).toMatchObject({
      message:
        '⚠️ User changes detected! 3 events occurred since sequence 42. The user may have modified the workbook.',
      events: [
        '[43] 2026-05-26T10:00:00Z: doc:editor-commit-ended-event',
        '[44] 2026-05-26T10:00:01Z: doc:update-field-relatability-event',
        '[45] 2026-05-26T10:00:02Z: doc:field-added-event',
      ],
      instructions: 'Consider refreshing the workbook state before making further changes.',
      currentSequence: 45,
    });
  });

  it('should return error when getEvents fails', async () => {
    const error = new Error('Network error');
    const mockGetExecutor = vi.fn().mockResolvedValue({
      getEvents: vi.fn().mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error,
      }),
    });

    const result = await getToolResult({
      session: '12345',
      sinceSequence: 42,
      mockGetExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new GetEventsFailedError(error).message);
  });

  it('should pass the same abort signal to executor.getEvents', async () => {
    const mockGetEvents = vi.fn().mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: {
        events: [],
        latest_sequence: 42,
        count: 0,
      },
    });

    const mockGetExecutor = vi.fn().mockResolvedValue({
      getEvents: mockGetEvents,
    });

    const customSignal = new AbortController().signal;

    await getToolResult({
      session: '12345',
      sinceSequence: undefined,
      mockGetExecutor,
      customSignal,
    });

    // Verify getEvents was called with the SDK's abort signal
    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: customSignal,
      }),
    );
  });
});

async function getToolResult({
  session,
  sinceSequence,
  mockGetExecutor,
  customSignal,
}: {
  session: string;
  sinceSequence: number | undefined;
  mockGetExecutor: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const checkForUserChangesTool = getCheckForUserChangesTool(new DesktopMcpServer());
  const callback = await Provider.from(checkForUserChangesTool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockGetExecutor,
    signal: customSignal ?? new AbortController().signal,
  };

  return await callback({ session, sinceSequence }, extra);
}
