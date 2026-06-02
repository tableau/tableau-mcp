import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getAgentApiClientModule from '../../desktop/getAgentApiClient.js';
import * as logger from '../../logging/logger.js';
import { AgentApiClient } from '../../sdks/desktop/agentApi/client.js';
import {
  ExecuteCommandResponse,
  GetCommandStatusResponse,
  GetEventsResponse,
} from '../../sdks/desktop/agentApi/types.js';
import { LocalExecutor } from './localToolExecutor.js';

vi.mock('../../desktop/getAgentApiClient.js');
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
      const mockExecuteCommand = vi.fn().mockResolvedValue(Ok(mockExecuteResponse));
      const mockGetCommandStatus = vi.fn().mockResolvedValue(Ok(mockCompletedStatus));
      const mockGetAgentApiClient = vi
        .spyOn(getAgentApiClientModule, 'getAgentApiClient')
        .mockResolvedValue({
          executeCommand: mockExecuteCommand,
          getCommandStatus: mockGetCommandStatus,
        } as unknown as AgentApiClient);

      const signal = new AbortController().signal;
      const localExecutor = new LocalExecutor();
      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual(mockCompletedStatus);

      expect(mockGetAgentApiClient).toHaveBeenCalled();
      for (const [call] of mockGetAgentApiClient.mock.calls) {
        expect(call.signal).toBe(signal);
      }
    });

    it('should successfully execute a command with a schema', async () => {
      const mockExecuteCommand = vi.fn().mockResolvedValue(Ok(mockExecuteResponse));
      const mockGetCommandStatus = vi.fn().mockResolvedValue(Ok(mockCompletedStatus));

      vi.spyOn(getAgentApiClientModule, 'getAgentApiClient').mockResolvedValue({
        executeCommand: mockExecuteCommand,
        getCommandStatus: mockGetCommandStatus,
      } as unknown as AgentApiClient);

      const localExecutor = new LocalExecutor();
      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        schema: z.object({ text: z.string() }),
        signal: new AbortController().signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().parsedResult).toEqual({ text: JSON.stringify({ name: 'John Doe' }) });
    });

    it('should handle command execution failure', async () => {
      const error = new Error('Network error');
      const mockExecuteCommand = vi.fn().mockResolvedValue(Err(error));
      vi.spyOn(getAgentApiClientModule, 'getAgentApiClient').mockResolvedValue({
        executeCommand: mockExecuteCommand,
      } as unknown as AgentApiClient);

      const localExecutor = new LocalExecutor();
      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal: new AbortController().signal,
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
      const mockExecuteCommand = vi.fn().mockResolvedValue(Ok(mockExecuteResponse));
      const mockGetCommandStatus = vi.fn().mockResolvedValue(Ok(mockRunningStatus));
      vi.spyOn(getAgentApiClientModule, 'getAgentApiClient').mockResolvedValue({
        executeCommand: mockExecuteCommand,
        getCommandStatus: mockGetCommandStatus,
      } as unknown as AgentApiClient);

      const localExecutor = new LocalExecutor({
        commandTimeoutMs: 1, // short timeout/interval to force wait timeout
        pollIntervalMs: 1,
      });

      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal: new AbortController().signal,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toEqual({
        type: 'command-timed-out',
        error: 'Command cmd_2026-01-01T00:00:00Z_1 timed out',
      });
      expect(logger.log).toHaveBeenCalledWith({
        message: 'Command cmd_2026-01-01T00:00:00Z_1 timed out',
        level: 'error',
        logger: 'LocalExecutor',
        data: { type: 'command-timed-out', error: 'Command cmd_2026-01-01T00:00:00Z_1 timed out' },
      });
    });

    it('should handle command status check failure', async () => {
      const error = new Error('Network error');
      const mockExecuteCommand = vi.fn().mockResolvedValue(Ok(mockExecuteResponse));
      const mockGetCommandStatus = vi.fn().mockResolvedValue(Err(error));
      vi.spyOn(getAgentApiClientModule, 'getAgentApiClient').mockResolvedValue({
        executeCommand: mockExecuteCommand,
        getCommandStatus: mockGetCommandStatus,
      } as unknown as AgentApiClient);

      const localExecutor = new LocalExecutor();

      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal: new AbortController().signal,
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
      const mockExecuteCommand = vi.fn().mockResolvedValue(Ok(mockExecuteResponse));
      const mockGetCommandStatus = vi.fn().mockResolvedValue(Ok(mockFailedStatus));
      vi.spyOn(getAgentApiClientModule, 'getAgentApiClient').mockResolvedValue({
        executeCommand: mockExecuteCommand,
        getCommandStatus: mockGetCommandStatus,
      } as unknown as AgentApiClient);

      const localExecutor = new LocalExecutor();

      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal: new AbortController().signal,
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

      const mockExecuteCommand = vi.fn().mockResolvedValue(Ok(mockExecuteResponse));
      vi.spyOn(getAgentApiClientModule, 'getAgentApiClient').mockResolvedValue({
        executeCommand: mockExecuteCommand,
        getCommandStatus: mockGetCommandStatus,
      } as unknown as AgentApiClient);

      const localExecutor = new LocalExecutor();
      const result = await localExecutor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal: new AbortController().signal,
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
        vi.spyOn(getAgentApiClientModule, 'getAgentApiClient').mockResolvedValue({
          getEvents: mockGetEvents,
        } as unknown as AgentApiClient);

        const localExecutor = new LocalExecutor();
        const result = await localExecutor.getEvents({ signal: new AbortController().signal });

        expect(result.isOk()).toBe(true);
        expect(result.unwrap()).toEqual(mockEventsResponse);
        expect(mockGetEvents).toHaveBeenCalledWith(undefined);
      });

      it('should successfully get events with sinceSequence', async () => {
        const mockGetEvents = vi.fn().mockResolvedValue(Ok(mockEventsResponse));
        vi.spyOn(getAgentApiClientModule, 'getAgentApiClient').mockResolvedValue({
          getEvents: mockGetEvents,
        } as unknown as AgentApiClient);

        const localExecutor = new LocalExecutor();
        const result = await localExecutor.getEvents({
          signal: new AbortController().signal,
          sinceSequence: 1,
        });

        expect(result.isOk()).toBe(true);
        expect(result.unwrap()).toEqual(mockEventsResponse);
        expect(mockGetEvents).toHaveBeenCalledWith(1);
      });

      it('should handle get events failure', async () => {
        const error = new Error('Failed to get events');
        const mockGetEvents = vi.fn().mockResolvedValue(Err(error));
        vi.spyOn(getAgentApiClientModule, 'getAgentApiClient').mockResolvedValue({
          getEvents: mockGetEvents,
        } as unknown as AgentApiClient);

        const localExecutor = new LocalExecutor();
        const result = await localExecutor.getEvents({
          signal: new AbortController().signal,
        });

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
