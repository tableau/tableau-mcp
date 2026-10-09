import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({ activityLog: { provider: 'noop' } })),
}));
vi.mock('../logging/logger.js', () => ({ log: vi.fn() }));

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import {
  closeActivityLog,
  initializeActivityLog,
  recordToolCall,
  resetActivityLog,
} from './init.js';
import { ToolCallDetails } from './provider.js';
import { isActivityLogProvider } from './types.js';

const RECORDING_MODULE = './src/activityLog/__fixtures__/recordingActivityLogProvider.cjs';
const INVALID_MODULE = './src/activityLog/__fixtures__/invalidActivityLogProvider.cjs';

declare global {
  var __activityLogCalls: ToolCallDetails[] | undefined;
  var __activityLogClosed: boolean | undefined;
  var __activityLogFailure: 'throw' | 'reject' | undefined;
  var __activityLogProviderConfig: Record<string, unknown> | undefined;
}

const details: ToolCallDetails = {
  toolName: 'get-workbook',
  siteLuid: '11111111-2222-3333-4444-555555555555',
  userLuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  success: true,
  errorCode: '',
  oauthClientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
  clientName: 'Claude',
  userAgent: 'claude-ai/0.1.0',
  mcpRequestId: '42',
  object: { type: 'workbook', luid: '99999999-2222-3333-4444-555555555555' },
};

function useCustomProvider(module: string, extra: Record<string, unknown> = {}): void {
  vi.mocked(getConfig).mockReturnValue({
    activityLog: { provider: 'custom', providerConfig: { module, ...extra } },
  } as any);
}

describe('Activity Log init', () => {
  beforeEach(() => {
    resetActivityLog();
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue({ activityLog: { provider: 'noop' } } as any);
    globalThis.__activityLogCalls = [];
    globalThis.__activityLogFailure = undefined;
    globalThis.__activityLogClosed = undefined;
    globalThis.__activityLogProviderConfig = undefined;
  });

  describe('provider selection', () => {
    it('records nothing, and logs nothing, with the noop provider', () => {
      initializeActivityLog();

      expect(() => recordToolCall(details)).not.toThrow();
      expect(globalThis.__activityLogCalls).toEqual([]);
      expect(log).not.toHaveBeenCalled();
    });

    it('records nothing when initializeActivityLog was never called', () => {
      expect(() => recordToolCall(details)).not.toThrow();
      expect(log).not.toHaveBeenCalled();
    });

    it('loads a custom provider, hands it the whole config, and passes it the call details', () => {
      useCustomProvider(RECORDING_MODULE, { directory: '/home/nodejs/logs' });

      initializeActivityLog();
      recordToolCall(details);

      expect(globalThis.__activityLogProviderConfig).toEqual({
        module: RECORDING_MODULE,
        directory: '/home/nodejs/logs',
      });
      expect(globalThis.__activityLogCalls).toEqual([details]);
    });

    it('falls back to noop and logs an error when the module is missing', () => {
      useCustomProvider('./src/activityLog/__fixtures__/does-not-exist.cjs');

      initializeActivityLog();

      expect(() => recordToolCall(details)).not.toThrow();
      expect(globalThis.__activityLogCalls).toEqual([]);
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          logger: 'activityLog',
          data: expect.objectContaining({ message: expect.stringContaining('Module not found') }),
        }),
      );
    });

    it('falls back to noop and logs an error when the provider lacks recordToolCall', () => {
      useCustomProvider(INVALID_MODULE);

      initializeActivityLog();

      expect(() => recordToolCall(details)).not.toThrow();
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          data: expect.objectContaining({
            message: expect.stringContaining('missing required method: recordToolCall'),
          }),
        }),
      );
    });

    it('falls back to noop when the custom config has no module', () => {
      vi.mocked(getConfig).mockReturnValue({
        activityLog: { provider: 'custom', providerConfig: {} },
      } as any);

      initializeActivityLog();

      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          data: expect.objectContaining({ message: expect.stringContaining('"module"') }),
        }),
      );
    });

    it('falls back to noop when reading the config throws', () => {
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('bad config');
      });

      initializeActivityLog();

      expect(() => recordToolCall(details)).not.toThrow();
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    });
  });

  describe('unrecognized provider name', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('warns when ACTIVITY_LOG_PROVIDER is set to something unknown', () => {
      vi.stubEnv('ACTIVITY_LOG_PROVIDER', 'Custom');

      initializeActivityLog();

      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warning', message: expect.stringContaining('"Custom"') }),
      );
    });

    it('does not warn when it is unset or valid', () => {
      initializeActivityLog();
      vi.stubEnv('ACTIVITY_LOG_PROVIDER', 'noop');
      initializeActivityLog();

      expect(log).not.toHaveBeenCalled();
    });
  });

  describe('closeActivityLog', () => {
    it('closes a provider that implements close, and tolerates one that does not', async () => {
      await expect(closeActivityLog()).resolves.toBeUndefined();

      useCustomProvider(RECORDING_MODULE);
      initializeActivityLog();
      await closeActivityLog();

      expect(globalThis.__activityLogClosed).toBe(true);
    });
  });

  describe('recordToolCall', () => {
    it('swallows a provider that throws, and logs a warning naming the tool', () => {
      useCustomProvider(RECORDING_MODULE);
      initializeActivityLog();
      globalThis.__activityLogFailure = 'throw';

      expect(() => recordToolCall(details)).not.toThrow();

      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          message: 'Activity Log recording failed for get-workbook: sync failure',
        }),
      );
    });

    it('swallows a provider that rejects, and logs a warning naming the tool', async () => {
      useCustomProvider(RECORDING_MODULE);
      initializeActivityLog();
      globalThis.__activityLogFailure = 'reject';

      expect(() => recordToolCall(details)).not.toThrow();
      await vi.waitFor(() =>
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({
            level: 'warning',
            message: 'Activity Log recording failed for get-workbook: async failure',
          }),
        ),
      );
    });
  });

  describe('provider names', () => {
    it.each([
      ['noop', true],
      ['custom', true],
      ['server', false],
      [undefined, false],
    ])('isActivityLogProvider(%j) is %s', (name, expected) => {
      expect(isActivityLogProvider(name)).toBe(expected);
    });
  });
});
