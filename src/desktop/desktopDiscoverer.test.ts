import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import * as logger from '../logging/logger.js';
import { DesktopDiscoverer, DesktopInstanceManifest } from './desktopDiscoverer.js';

vi.mock('fs');
vi.mock('os');
vi.mock('../logging/logger.js');

describe('DesktopDiscoverer', () => {
  const mockMacHomedir = '/home/testuser';
  const mockWindowsHomedir = 'C:\\Users\\testuser\\';
  const mockLocalAppData = 'C:\\Users\\testuser\\AppData\\Local';

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(homedir).mockReturnValue(mockMacHomedir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('getManifestPath', () => {
    it('should use Windows path when platform is win32', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      vi.stubEnv('LOCALAPPDATA', mockLocalAppData);
      vi.mocked(existsSync).mockReturnValue(false);

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      const instances = discoverer.getInstances();
      expect(instances.size).toBe(0);

      expect(existsSync).toHaveBeenCalledWith(
        join(mockLocalAppData, 'Tableau', 'Desktop', 'agent-manifest.json'),
      );
    });

    it('should fallback to home directory path when LOCALAPPDATA is not set', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      vi.stubEnv('LOCALAPPDATA', undefined);
      vi.mocked(homedir).mockReturnValue(mockWindowsHomedir);
      vi.mocked(existsSync).mockReturnValue(false);

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      const instances = discoverer.getInstances();
      expect(instances.size).toBe(0);

      expect(existsSync).toHaveBeenCalledWith(
        join(mockWindowsHomedir, 'AppData', 'Local', 'Tableau', 'Desktop', 'agent-manifest.json'),
      );
    });

    it('should use Unix path when platform is not win32', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      vi.mocked(existsSync).mockReturnValue(false);

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      const instances = discoverer.getInstances();
      expect(instances.size).toBe(0);

      expect(existsSync).toHaveBeenCalledWith(
        join(mockMacHomedir, '.tableau', 'agent-manifest.json'),
      );
    });
  });

  describe('getInstances', () => {
    it('should return empty map when manifest file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      const instances = discoverer.getInstances();

      expect(instances.size).toBe(0);
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('should return empty map when manifest has no instances', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          instances: [],
        }),
      );

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      const instances = discoverer.getInstances();

      expect(instances.size).toBe(0);
      expect(readFileSync).toHaveBeenCalled();
    });

    it('should return single instance when one instance is found', () => {
      const mockManifest: DesktopInstanceManifest = {
        instances: [
          {
            pid: 12345,
            port: 8765,
            secret: 'test-secret-123',
            start_time: '2024-01-15T10:30:00Z',
          },
        ],
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockManifest));

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      const instances = discoverer.getInstances();

      expect(instances.size).toBe(1);
      expect(readFileSync).toHaveBeenCalled();

      const instance = discoverer.getInstance(12345);
      expect(instance).toStrictEqual(instances.get(12345));
      expect(instance.pid).toBe(12345);
      expect(instance.port).toBe(8765);
      expect(instance.secret).toBe('test-secret-123');
    });

    it('should return multiple instances when multiple instances are found', () => {
      const mockManifest: DesktopInstanceManifest = {
        instances: [
          {
            pid: 12345,
            port: 8765,
            secret: 'test-secret-1',
            start_time: '2024-01-15T10:30:00Z',
          },
          {
            pid: 67890,
            port: 8766,
            secret: 'test-secret-2',
            start_time: '2024-01-15T11:00:00Z',
          },
          {
            pid: 11111,
            port: 8767,
            secret: 'test-secret-3',
            start_time: '2024-01-15T11:30:00Z',
          },
        ],
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockManifest));

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      const instances = discoverer.getInstances();

      expect(instances.size).toBe(3);

      const instance1 = discoverer.getInstance(12345);
      expect(instance1).toStrictEqual(instances.get(12345));
      expect(instance1.pid).toBe(12345);
      expect(instance1.port).toBe(8765);
      expect(instance1.secret).toBe('test-secret-1');

      const instance2 = discoverer.getInstance(67890);
      expect(instance2).toStrictEqual(instances.get(67890));
      expect(instance2.pid).toBe(67890);
      expect(instance2.port).toBe(8766);
      expect(instance2.secret).toBe('test-secret-2');

      const instance3 = discoverer.getInstance(11111);
      expect(instance3).toStrictEqual(instances.get(11111));
      expect(instance3.pid).toBe(11111);
      expect(instance3.port).toBe(8767);
      expect(instance3.secret).toBe('test-secret-3');
    });

    it('should return empty map and log error when manifest JSON is invalid', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('{ invalid json }');

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      const instances = discoverer.getInstances();

      expect(instances.size).toBe(0);
      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to read manifest',
          level: 'error',
          logger: 'DesktopDiscoverer',
          data: expect.any(Error),
        }),
      );
    });

    it('should return empty map and log error when manifest schema validation fails', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          instances: [
            {
              pid: 'not-a-number',
              port: 8765,
              secret: 'test-secret',
              start_time: '2024-01-15T10:30:00Z',
            },
          ],
        }),
      );

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      const instances = discoverer.getInstances();

      expect(instances.size).toBe(0);
      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to read manifest',
          level: 'error',
          logger: 'DesktopDiscoverer',
        }),
      );
    });

    it('should return empty map and log error when readFileSync throws', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('File read error');
      });

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      const instances = discoverer.getInstances();

      expect(instances.size).toBe(0);
      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to read manifest',
          level: 'error',
          logger: 'DesktopDiscoverer',
          data: expect.objectContaining({
            message: 'File read error',
          }),
        }),
      );
    });
  });

  describe('getInstance', () => {
    it('should throw error when instance does not exist', () => {
      const mockManifest = {
        instances: [
          {
            pid: 12345,
            port: 8765,
            secret: 'test-secret-123',
            start_time: '2024-01-15T10:30:00Z',
          },
        ],
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockManifest));

      const discoverer = new DesktopDiscoverer({ isPidAlive: () => true });
      expect(() => discoverer.getInstance(99999)).toThrow(
        'No Desktop instance found with PID 99999',
      );
    });
  });
});

describe('DesktopDiscoverer — dead-pid pruning (W60)', () => {
  it('drops manifest entries whose pid is dead and keeps live ones', () => {
    vi.mocked(homedir).mockReturnValue('/home/testuser');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        instances: [
          { pid: 111, port: 8765, secret: 's1', start_time: '2026-07-07T00:00:00Z' },
          { pid: 222, port: 8766, secret: 's2', start_time: '2026-07-07T01:00:00Z' },
        ],
      }),
    );
    const discoverer = new DesktopDiscoverer({ isPidAlive: (pid) => pid === 222 });
    const instances = discoverer.getInstances();
    expect([...instances.keys()]).toEqual([222]);
  });
});
