import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { GetEventsResponse } from '../../../sdks/desktop/agentApi/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCheckForUserChangesTool } from './checkForUserChanges.js';

describe('checkForUserChangesTool', () => {
  const resultSchema = z.object({
    message: z.string(),
    instructions: z.string().optional(),
    events: z.array(z.string()).optional(),
    currentSequence: z.number().optional(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const checkForUserChangesTool = getCheckForUserChangesTool(new DesktopMcpServer());
    expect(checkForUserChangesTool.name).toBe('check-for-user-changes');
    expect(checkForUserChangesTool.description).toContain(
      'Detect if the user has made changes to the workbook',
    );
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
      message: 'Current event sequence checkpoint: 42.',
      instructions: 'Use this sequence number in subsequent calls to check for user changes.',
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
    const mockGetExecutor = vi.fn().mockResolvedValue({
      getEvents: vi.fn().mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: new Error('Network error'),
      }),
    });

    const result = await getToolResult({
      session: '12345',
      sinceSequence: 42,
      mockGetExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Failed to get events: Network error.');
    expect(result.content[0].text).toContain(
      'Ensure Tableau Desktop is running and the session is valid.',
    );
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
