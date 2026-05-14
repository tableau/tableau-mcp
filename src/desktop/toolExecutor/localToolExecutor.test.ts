import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as logger from '../../logging/logger.js';
import { AgentApiClient } from '../../sdks/desktop/agentApi/client.js';
import {
  ExecuteCommandResponse,
  GetCommandStatusResponse,
  GetEventsResponse,
} from '../../sdks/desktop/agentApi/types.js';
import { LocalExecutor } from './localToolExecutor.js';

vi.mock('../../sdks/desktop/agentApi/client.js');
vi.mock('../../logging/logger.js');

describe('LocalExecutor', () => {
  describe('start', () => {
    it('should log startup message', async () => {
      const localExecutor = new LocalExecutor();
      await localExecutor.start();

      expect(logger.log).toHaveBeenCalledWith({
        message: 'LocalExecutor starting',
        level: 'info',
        logger: 'LocalExecutor',
        data: {
          agentApiBase: 'http://127.0.0.1:8765/api/v1',
        },
      });
    });
  });

  describe('stop', () => {
    it('should log stop message', () => {
      const localExecutor = new LocalExecutor();
      localExecutor.stop();

      expect(logger.log).toHaveBeenCalledWith({
        message: 'LocalExecutor stopped',
        level: 'info',
        logger: 'LocalExecutor',
      });
    });
  });

  describe('isAvailable', () => {
    it('should return true', () => {
      expect(new LocalExecutor().isAvailable()).toBe(true);
    });
  });

  describe('executeCommand', () => {
    const commandId = 'cmd_2026-01-01T00:00:00Z_1';
    const statusUrl = `/api/v1/commands/${commandId}`;
    const mockExecuteResponse: ExecuteCommandResponse = {
      command_id: commandId,
      status: 'queued',
      submitted_at: '2026-01-01T00:00:00Z',
      status_url: statusUrl,
    };

    const mockCompletedStatus: GetCommandStatusResponse = {
      command_id: 'cmd-123',
      status: 'completed',
      submitted_at: '2026-01-01T00:00:00Z',
      started_at: '2026-01-01T00:00:01Z',
      completed_at: '2026-01-01T00:00:02Z',
      duration_ms: 1000,
      result: { text: JSON.stringify({ name: 'John Doe' }) },
    };

    const mockQueuedStatus: GetCommandStatusResponse = {
      command_id: commandId,
      status: 'queued',
      submitted_at: '2026-01-01T00:00:00Z',
    };

    const mockRunningStatus: GetCommandStatusResponse = {
      command_id: commandId,
      status: 'running',
      submitted_at: '2026-01-01T00:00:00Z',
      started_at: '2026-01-01T00:00:01Z',
    };

    const mockFailedStatus: GetCommandStatusResponse = {
      command_id: commandId,
      status: 'failed',
      submitted_at: '2026-01-01T00:00:00Z',
      error: {
        code: 'TABLEAU_EXCEPTION',
        message: 'An exception occurred while executing the command',
        recoverable: false,
      },
    };

    it('should successfully execute a command', async () => {
      const MockedAgentApiClient = vi.mocked(AgentApiClient);
      MockedAgentApiClient.mockImplementation(
        () =>
          ({
            executeCommand: vi.fn().mockResolvedValue(Ok(mockExecuteResponse)),
            getCommandStatus: vi.fn().mockResolvedValue(Ok(mockCompletedStatus)),
          }) as unknown as AgentApiClient,
      );

      const localExecutor = new LocalExecutor();
      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual(mockCompletedStatus);
    });

    it('should successfully execute a command with a schema', async () => {
      const MockedAgentApiClient = vi.mocked(AgentApiClient);
      MockedAgentApiClient.mockImplementation(
        () =>
          ({
            executeCommand: vi.fn().mockResolvedValue(Ok(mockExecuteResponse)),
            getCommandStatus: vi.fn().mockResolvedValue(Ok(mockCompletedStatus)),
          }) as unknown as AgentApiClient,
      );

      const localExecutor = new LocalExecutor();
      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        schema: z.object({ name: z.string() }),
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().parsedResult).toEqual({ name: 'John Doe' });
    });

    it('should handle command execution failure', async () => {
      const error = new Error('Network error');
      const MockedAgentApiClient = vi.mocked(AgentApiClient);
      MockedAgentApiClient.mockImplementation(
        () =>
          ({
            executeCommand: vi.fn().mockResolvedValue(Err(error)),
          }) as unknown as AgentApiClient,
      );

      const localExecutor = new LocalExecutor();
      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toEqual({ type: 'unknown', error });
      expect(logger.log).toHaveBeenCalledWith({
        message: 'Failed to execute command tabdoc:undo',
        level: 'error',
        logger: 'LocalExecutor',
        data: error,
      });
    });

    it('should handle command status check timeout', async () => {
      const MockedAgentApiClient = vi.mocked(AgentApiClient);
      MockedAgentApiClient.mockImplementation(
        () =>
          ({
            executeCommand: vi.fn().mockResolvedValue(Ok(mockExecuteResponse)),
            getCommandStatus: vi.fn().mockResolvedValue(Ok(mockRunningStatus)),
          }) as unknown as AgentApiClient,
      );

      const localExecutor = new LocalExecutor({
        commandTimeoutMs: 1, // short timeout/interval to force wait timeout
        pollIntervalMs: 1,
      });

      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toEqual({ type: 'command-timed-out' });
      expect(logger.log).toHaveBeenCalledWith({
        message: 'Command cmd_2026-01-01T00:00:00Z_1 timed out',
        level: 'error',
        logger: 'LocalExecutor',
        data: { type: 'command-timed-out' },
      });
    });

    it('should handle command status check failure', async () => {
      const error = new Error('Network error');
      const MockedAgentApiClient = vi.mocked(AgentApiClient);
      MockedAgentApiClient.mockImplementation(
        () =>
          ({
            executeCommand: vi.fn().mockResolvedValue(Ok(mockExecuteResponse)),
            getCommandStatus: vi.fn().mockResolvedValue(Err(error)),
          }) as unknown as AgentApiClient,
      );

      const localExecutor = new LocalExecutor();

      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toEqual({ type: 'unknown', error });
      expect(logger.log).toHaveBeenCalledWith({
        message: `Failed to get status of command ${commandId}`,
        level: 'error',
        logger: 'LocalExecutor',
        data: { type: 'unknown', error },
      });
    });

    it('should handle failed command status', async () => {
      const MockedAgentApiClient = vi.mocked(AgentApiClient);
      MockedAgentApiClient.mockImplementation(
        () =>
          ({
            executeCommand: vi.fn().mockResolvedValue(Ok(mockExecuteResponse)),
            getCommandStatus: vi.fn().mockResolvedValue(Ok(mockFailedStatus)),
          }) as unknown as AgentApiClient,
      );

      const localExecutor = new LocalExecutor();

      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toEqual({
        type: 'command-failed',
        error: mockFailedStatus.error,
      });

      expect(logger.log).toHaveBeenCalledWith({
        message: `Command ${commandId} failed`,
        level: 'error',
        logger: 'LocalExecutor',
        data: mockFailedStatus.error,
      });
    });

    it('should poll until command completes', async () => {
      const mockGetCommandStatus = vi
        .fn()
        .mockResolvedValueOnce(Ok(mockQueuedStatus))
        .mockResolvedValueOnce(Ok(mockRunningStatus))
        .mockResolvedValueOnce(Ok(mockCompletedStatus));

      const MockedAgentApiClient = vi.mocked(AgentApiClient);
      MockedAgentApiClient.mockImplementation(
        () =>
          ({
            executeCommand: vi.fn().mockResolvedValue(Ok(mockExecuteResponse)),
            getCommandStatus: mockGetCommandStatus,
          }) as unknown as AgentApiClient,
      );

      const localExecutor = new LocalExecutor();
      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual(mockCompletedStatus);
      expect(mockGetCommandStatus).toHaveBeenCalledTimes(3);
    });

    describe('getEvents', () => {
      const mockEventsResponse: GetEventsResponse = {
        events: [
          {
            sequence: 1,
            timestamp: '2026-05-06T16:56:35Z',
            type: 'doc:editor-commit-ended-event',
          },
          {
            sequence: 2,
            timestamp: '2026-05-06T16:56:35Z',
            type: 'doc:update-field-relatability-event',
          },
        ],
        latest_sequence: 2,
        count: 2,
      };

      it('should successfully get events', async () => {
        const mockGetEvents = vi.fn().mockResolvedValue(Ok(mockEventsResponse));
        const MockedAgentApiClient = vi.mocked(AgentApiClient);
        MockedAgentApiClient.mockImplementation(
          () =>
            ({
              getEvents: mockGetEvents,
            }) as unknown as AgentApiClient,
        );

        const localExecutor = new LocalExecutor();
        const result = await localExecutor.getEvents();

        expect(result.isOk()).toBe(true);
        expect(result.unwrap()).toEqual(mockEventsResponse);
        expect(mockGetEvents).toHaveBeenCalledWith(undefined);
      });

      it('should successfully get events with sinceSequence', async () => {
        const mockGetEvents = vi.fn().mockResolvedValue(Ok(mockEventsResponse));
        const MockedAgentApiClient = vi.mocked(AgentApiClient);
        MockedAgentApiClient.mockImplementation(
          () =>
            ({
              getEvents: mockGetEvents,
            }) as unknown as AgentApiClient,
        );

        const localExecutor = new LocalExecutor();
        const result = await localExecutor.getEvents({ sinceSequence: 1 });

        expect(result.isOk()).toBe(true);
        expect(result.unwrap()).toEqual(mockEventsResponse);
        expect(mockGetEvents).toHaveBeenCalledWith(1);
      });

      it('should handle get events failure', async () => {
        const error = new Error('Failed to get events');
        const mockGetEvents = vi.fn().mockResolvedValue(Err(error));
        const MockedAgentApiClient = vi.mocked(AgentApiClient);
        MockedAgentApiClient.mockImplementation(
          () =>
            ({
              getEvents: mockGetEvents,
            }) as unknown as AgentApiClient,
        );

        const localExecutor = new LocalExecutor();
        const result = await localExecutor.getEvents();

        expect(result.isErr()).toBe(true);
        expect(result.unwrapErr()).toBe(error);
        expect(logger.log).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Failed to get events',
            level: 'error',
            logger: 'LocalExecutor',
            data: error,
          }),
        );
      });
    });
  });
});
