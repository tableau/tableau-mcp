import { Err, Ok } from 'ts-results-es';

import { AgentApiClient } from '../../sdks/desktop/agentApi/client';
import {
  ExecuteCommandResponse,
  GetCommandStatusResponse,
  GetEventsResponse,
} from '../../sdks/desktop/agentApi/types';
import { LocalExecutor } from './localToolExecutor';

vi.mock('../../sdks/desktop/agentApi/client.js');

describe('LocalExecutor', () => {
  describe('constructor', () => {
    it('should create an instance with default config', () => {
      expect(new LocalExecutor()).toBeInstanceOf(LocalExecutor);

      const MockedAgentApiClient = vi.mocked(AgentApiClient);
      expect(MockedAgentApiClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://127.0.0.1:8765/api/v1',
          authToken: undefined,
          options: expect.objectContaining({
            maxRequestTimeoutMs: 300_000,
          }),
        }),
      );
    });

    it('should create an instance with default config when overrides are empty', () => {
      expect(new LocalExecutor({})).toBeInstanceOf(LocalExecutor);

      const MockedAgentApiClient = vi.mocked(AgentApiClient);
      expect(MockedAgentApiClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://127.0.0.1:8765/api/v1',
          authToken: undefined,
          options: expect.objectContaining({
            maxRequestTimeoutMs: 300_000,
          }),
        }),
      );
    });

    it('should create an instance with custom config', () => {
      expect(
        new LocalExecutor({
          agentApiBase: 'http://127.0.0.1:8765/api/v2',
          authToken: 'test-token',
          commandTimeoutMs: 100_000,
        }),
      ).toBeInstanceOf(LocalExecutor);

      const MockedAgentApiClient = vi.mocked(AgentApiClient);
      expect(MockedAgentApiClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://127.0.0.1:8765/api/v2',
          authToken: 'test-token',
          options: expect.objectContaining({
            maxRequestTimeoutMs: 100_000,
          }),
        }),
      );
    });

    describe('start', () => {
      it('should log startup message', async () => {
        const mockLog = vi.fn();
        const localExecutor = new LocalExecutor({ log: mockLog });
        await localExecutor.start();

        expect(mockLog).toHaveBeenCalledWith({
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
        const mockLog = vi.fn();
        const localExecutor = new LocalExecutor({ log: mockLog });
        localExecutor.stop();

        expect(mockLog).toHaveBeenCalledWith({
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
        result: { text: 'Success' },
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

      it('should handle command execution failure', async () => {
        const error = new Error('Network error');
        const MockedAgentApiClient = vi.mocked(AgentApiClient);
        MockedAgentApiClient.mockImplementation(
          () =>
            ({
              executeCommand: vi.fn().mockResolvedValue(Err(error)),
            }) as unknown as AgentApiClient,
        );

        const mockLog = vi.fn();
        const localExecutor = new LocalExecutor({ log: mockLog });
        const result = await localExecutor.executeCommand({
          namespace: 'tabdoc',
          command: 'undo',
        });

        expect(result.isErr()).toBe(true);
        expect(result.unwrapErr()).toEqual({ type: 'unknown', error });
        expect(mockLog).toHaveBeenCalledWith({
          message: 'Failed to execute command tabdoc:undo. Reason: Network error',
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

        const mockLog = vi.fn();
        const localExecutor = new LocalExecutor({
          commandTimeoutMs: 1, // short timeout/interval to force wait timeout
          pollIntervalMs: 1,
          log: mockLog,
        });

        const result = await localExecutor.executeCommand({
          namespace: 'tabdoc',
          command: 'undo',
        });

        expect(result.isErr()).toBe(true);
        expect(result.unwrapErr()).toEqual({ type: 'command-timed-out' });
        expect(mockLog).toHaveBeenCalledWith({
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

        const mockLog = vi.fn();
        const localExecutor = new LocalExecutor({ log: mockLog });

        const result = await localExecutor.executeCommand({
          namespace: 'tabdoc',
          command: 'undo',
        });

        expect(result.isErr()).toBe(true);
        expect(result.unwrapErr()).toEqual({ type: 'unknown', error });
        expect(mockLog).toHaveBeenCalledWith({
          message: `Failed to get status of command ${commandId}. Reason: Network error`,
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

        const mockLog = vi.fn();
        const localExecutor = new LocalExecutor({ log: mockLog });

        const result = await localExecutor.executeCommand({
          namespace: 'tabdoc',
          command: 'undo',
        });

        expect(result.isErr()).toBe(true);
        expect(result.unwrapErr()).toEqual({
          type: 'command-failed',
          error: mockFailedStatus.error,
        });

        expect(mockLog).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining(
              `Command ${commandId} failed. Reason: An exception occurred while executing the command`,
            ),
            level: 'error',
            logger: 'LocalExecutor',
            data: mockFailedStatus.error,
          }),
        );
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

        const mockLog = vi.fn();
        const localExecutor = new LocalExecutor({ log: mockLog });
        const result = await localExecutor.getEvents();

        expect(result.isErr()).toBe(true);
        expect(result.unwrapErr()).toBe(error);
        expect(mockLog).toHaveBeenCalledWith(
          expect.objectContaining({
            level: 'error',
            message: expect.stringContaining('Failed to get events'),
          }),
        );
      });
    });
  });
});
