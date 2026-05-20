import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';

import { DesktopInstanceManifest } from './desktopDiscoverer.js';
import { SessionManager } from './sessionManager.js';
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

      const sessionManager = new SessionManager({ signal: new AbortController().signal });
      const executor = await sessionManager.getExecutor(sessionId);
      expect(executor).toBeInstanceOf(LocalExecutor);
    });

    it('should throw error when sessionId is empty string', async () => {
      const sessionId = '';

      const sessionManager = new SessionManager({ signal: new AbortController().signal });
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: . Expected numeric PID.',
      );
    });

    it('should throw error when sessionId is not a valid PID', async () => {
      const sessionId = 'invalid-pid';

      const sessionManager = new SessionManager({ signal: new AbortController().signal });
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: invalid-pid. Expected numeric PID.',
      );
    });

    it('should throw error when sessionId contains letters and numbers', async () => {
      const sessionId = '123abc';

      const sessionManager = new SessionManager({ signal: new AbortController().signal });
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: 123abc. Expected numeric PID.',
      );
    });

    it('should throw error when sessionId contains special characters', async () => {
      const sessionId = '123-456';

      const sessionManager = new SessionManager({ signal: new AbortController().signal });
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: 123-456. Expected numeric PID.',
      );
    });

    it('should throw error when sessionId contains whitespace', async () => {
      const sessionId = '123 456';

      const sessionManager = new SessionManager({ signal: new AbortController().signal });
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: 123 456. Expected numeric PID.',
      );
    });

    it('should throw error when sessionId is a floating point number', async () => {
      const sessionId = '123.456';

      const sessionManager = new SessionManager({ signal: new AbortController().signal });
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: 123.456. Expected numeric PID.',
      );
    });

    it('should throw error when sessionId is negative number', async () => {
      const sessionId = '-12345';

      const sessionManager = new SessionManager({ signal: new AbortController().signal });
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'Invalid session ID for local mode: -12345. Expected numeric PID.',
      );
    });

    it('should throw error when desktop instance is not found', async () => {
      const sessionId = '99999';

      const sessionManager = new SessionManager({ signal: new AbortController().signal });
      await expect(sessionManager.getExecutor(sessionId)).rejects.toThrow(
        'No Desktop instance found with PID 99999',
      );
    });

    it('should handle multiple different sessions', async () => {
      const sessionId1 = '12345';
      const sessionId2 = '67890';

      const sessionManager = new SessionManager({ signal: new AbortController().signal });
      const executor1 = await sessionManager.getExecutor(sessionId1);
      const executor2 = await sessionManager.getExecutor(sessionId2);

      expect(executor1).not.toBe(executor2);
    });
  });
});
