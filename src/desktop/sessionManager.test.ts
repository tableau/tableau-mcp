import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';

import { DesktopDiscoverer, DesktopInstanceManifest } from './desktopDiscoverer.js';
import { DesktopInstance } from './desktopInstance.js';
import { SessionManager, SessionStaleError } from './sessionManager.js';
import { LocalExecutor } from './toolExecutor/localToolExecutor.js';

vi.mock('fs');
vi.mock('os');

describe('SessionManager', () => {
  const mockMacHomedir = '/home/testuser';
  const desktopInstanceManifest: DesktopInstanceManifest = {
    instances: [
      {
        pid: 12345,
        port: 8765,
        secret: 'test-secret-123',
        start_time: '2024-01-15T10:30:00Z',
      },
      {
        pid: 67890,
        port: 8766,
        secret: 'test-secret-2',
        start_time: '2024-01-15T11:00:00Z',
      },
    ],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    // W60 dead-pid pruning: fixture manifest pids are not real processes; force alive.
    vi.spyOn(process, 'kill').mockReturnValue(true as never);
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.mocked(homedir).mockReturnValue(mockMacHomedir);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(desktopInstanceManifest));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('getExecutor', () => {
    it('should create a new session when sessionId does not exist', async () => {
      const sessionId = '12345';

      const sessionManager = new SessionManager();
      const executor = await sessionManager.getExecutor(sessionId);
      expect(executor).toBeInstanceOf(LocalExecutor);
    });

    it('should throw error when sessionId is empty string', async () => {
      const sessionId = '';

      const sessionManager = new SessionManager();
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: . Expected numeric PID.',
      );
    });

    it('should throw error when sessionId is not a valid PID', async () => {
      const sessionId = 'invalid-pid';

      const sessionManager = new SessionManager();
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: invalid-pid. Expected numeric PID.',
      );
    });

    it('should throw error when sessionId contains letters and numbers', async () => {
      const sessionId = '123abc';

      const sessionManager = new SessionManager();
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: 123abc. Expected numeric PID.',
      );
    });

    it('should throw error when sessionId contains special characters', async () => {
      const sessionId = '123-456';

      const sessionManager = new SessionManager();
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: 123-456. Expected numeric PID.',
      );
    });

    it('should throw error when sessionId contains whitespace', async () => {
      const sessionId = '123 456';

      const sessionManager = new SessionManager();
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: 123 456. Expected numeric PID.',
      );
    });

    it('should throw error when sessionId is a floating point number', async () => {
      const sessionId = '123.456';

      const sessionManager = new SessionManager();
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: 123.456. Expected numeric PID.',
      );
    });

    it('should throw error when sessionId is negative number', async () => {
      const sessionId = '-12345';

      const sessionManager = new SessionManager();
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: -12345. Expected numeric PID.',
      );
    });

    it('should throw error when desktop instance is not found', async () => {
      const sessionId = '99999';

      const sessionManager = new SessionManager();
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'No Desktop instance found with PID 99999',
      );
    });

    it('should handle multiple different sessions', async () => {
      const sessionId1 = '12345';
      const sessionId2 = '67890';

      const sessionManager = new SessionManager();
      const executor1 = await sessionManager.getExecutor(sessionId1);
      const executor2 = await sessionManager.getExecutor(sessionId2);

      expect(executor1).not.toBe(executor2);
    });
  });

  // W9 — a cached executor can outlive its Desktop process. getExecutor re-verifies the
  // cached instance against the live manifest before handing it back.
  describe('stale-session freshness gate', () => {
    function instance(over: Partial<DesktopInstance> = {}): DesktopInstance {
      return new DesktopInstance({
        pid: 12345,
        port: 8765,
        secret: 'test-secret-123',
        start_time: '2024-01-15T10:30:00Z',
        ...over,
      });
    }

    /** A discoverer whose manifest can shift between calls (Desktop restart). */
    function mkDiscoverer(seq: Array<Map<number, DesktopInstance>>): DesktopDiscoverer {
      const d = new DesktopDiscoverer();
      let i = 0;
      vi.spyOn(d, 'getInstances').mockImplementation(() => seq[Math.min(i++, seq.length - 1)]);
      return d;
    }

    it('returns the SAME cached executor when the instance is unchanged', async () => {
      const live = new Map([[12345, instance()]]);
      const sm = new SessionManager({ discoverer: mkDiscoverer([live, live, live]) });

      const first = await sm.getExecutor('12345');
      const second = await sm.getExecutor('12345');
      expect(second).toBe(first);
    });

    it('throws SessionStaleError when the cached port shifts (Desktop restarted)', async () => {
      const before = new Map([[12345, instance({ port: 8765 })]]);
      const after = new Map([[12345, instance({ port: 9999, start_time: '2024-06-01T00:00:00Z' })]]);
      const sm = new SessionManager({ discoverer: mkDiscoverer([before, after]) });

      await sm.getExecutor('12345');
      await expect(sm.getExecutor('12345')).rejects.toBeInstanceOf(SessionStaleError);
    });

    it('throws SessionStaleError when the pid vanishes from the manifest', async () => {
      const before = new Map([[12345, instance()]]);
      const gone = new Map<number, DesktopInstance>();
      const sm = new SessionManager({ discoverer: mkDiscoverer([before, gone]) });

      await sm.getExecutor('12345');
      await expect(sm.getExecutor('12345')).rejects.toThrow(/stale/i);
    });

    it('evicts the stale session so a subsequent call rebuilds it fresh', async () => {
      const before = new Map([[12345, instance({ port: 8765 })]]);
      const restarted = new Map([
        [12345, instance({ port: 9001, start_time: '2024-06-01T00:00:00Z' })],
      ]);
      const sm = new SessionManager({ discoverer: mkDiscoverer([before, restarted, restarted]) });

      const original = await sm.getExecutor('12345');
      await expect(sm.getExecutor('12345')).rejects.toBeInstanceOf(SessionStaleError);
      // The eviction cleared the cache; the next call builds a NEW executor for the
      // restarted instance rather than handing back the dead one.
      const rebuilt = await sm.getExecutor('12345');
      expect(rebuilt).not.toBe(original);
    });
  });
});
