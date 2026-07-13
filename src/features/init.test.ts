import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('../utils/getDirname.js', () => ({
  getDirname: vi.fn(() => '/mock/module/directory'),
}));

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    featureGate: { provider: 'server' },
  })),
}));

import { getConfig } from '../config.js';
import { getDirname } from '../utils/getDirname.js';
import { getFeatureGate, initializeFeatureGate, resetFeatureGate } from './init.js';
import { featureGateProviderSchema, isFeatureGateProvider } from './types.js';

describe('FeatureGate', () => {
  beforeEach(() => {
    resetFeatureGate();
    vi.clearAllMocks();
  });

  describe('loadFeatures', () => {
    it('should resolve features.json relative to module directory not process.cwd()', () => {
      const config = { mcpapps: true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      getFeatureGate();

      expect(getDirname).toHaveBeenCalled();
      expect(readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('/mock/module/directory'),
        'utf-8',
      );
      expect(readFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\/mock\/module\/directory.*features\.json$/),
        'utf-8',
      );
    });

    it('should load valid feature config file', async () => {
      const config = { mcpapps: true, pulse: false };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(true);
      await expect(gate.isFeatureEnabled('pulse')).resolves.toBe(false);
    });
  });

  describe('missing file handling', () => {
    it('should handle missing file gracefully', async () => {
      const error: NodeJS.ErrnoException = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      vi.mocked(readFileSync).mockImplementation(() => {
        throw error;
      });

      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(false);
      await expect(gate.isFeatureEnabled('pulse')).resolves.toBe(false);
    });
  });

  describe('invalid JSON handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      vi.mocked(readFileSync).mockReturnValue('{ invalid json }');

      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(false);
    });

    it('should skip invalid values and load valid ones', async () => {
      const config = {
        mcpapps: true,
        validFeature: false,
        invalidString: 'yes',
        invalidNull: null,
        invalidNumber: 123,
        invalidArray: [],
      };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      // Valid features should be loaded
      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(true);
      await expect(gate.isFeatureEnabled('validFeature')).resolves.toBe(false);

      // Invalid features should be skipped (disabled)
      await expect(gate.isFeatureEnabled('invalidString')).resolves.toBe(false);
      await expect(gate.isFeatureEnabled('invalidNull')).resolves.toBe(false);
      await expect(gate.isFeatureEnabled('invalidNumber')).resolves.toBe(false);
      await expect(gate.isFeatureEnabled('invalidArray')).resolves.toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty JSON object', async () => {
      vi.mocked(readFileSync).mockReturnValue('{}');

      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(false);
      await expect(gate.isFeatureEnabled('any-feature')).resolves.toBe(false);
    });

    it('should return false for unknown features', async () => {
      const config = { mcpapps: true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('unknown-feature')).resolves.toBe(false);
      await expect(gate.isFeatureEnabled('nonexistent')).resolves.toBe(false);
    });
  });

  describe('with test fixtures', () => {
    it('should load all-enabled fixture correctly', async () => {
      const config = { mcpapps: true, pulse: true, 'oauth-embedded': true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(true);
      await expect(gate.isFeatureEnabled('pulse')).resolves.toBe(true);
      await expect(gate.isFeatureEnabled('oauth-embedded')).resolves.toBe(true);
    });

    it('should load all-disabled fixture correctly', async () => {
      const config = { mcpapps: false, pulse: false, 'oauth-embedded': false };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(false);
      await expect(gate.isFeatureEnabled('pulse')).resolves.toBe(false);
      await expect(gate.isFeatureEnabled('oauth-embedded')).resolves.toBe(false);
    });

    it('should load mixed fixture correctly', async () => {
      const config = { mcpapps: false, pulse: true, 'oauth-embedded': false };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(false);
      await expect(gate.isFeatureEnabled('pulse')).resolves.toBe(true);
      await expect(gate.isFeatureEnabled('oauth-embedded')).resolves.toBe(false);
    });
  });

  describe('provider selection', () => {
    beforeEach(() => {
      resetFeatureGate();
      vi.clearAllMocks();
    });

    it('should use server provider by default and load from file', async () => {
      const config = { mcpapps: true, pulse: false };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
      vi.mocked(getConfig).mockReturnValue({ featureGate: { provider: 'server' } } as any);

      initializeFeatureGate();
      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(true);
      await expect(gate.isFeatureEnabled('pulse')).resolves.toBe(false);
      expect(readFileSync).toHaveBeenCalled();
    });

    it('should fall back to server provider when custom provider module fails to load', async () => {
      const config = { mcpapps: true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
      vi.mocked(getConfig).mockReturnValue({
        featureGate: {
          provider: 'custom',
          providerConfig: { module: './nonexistent-provider.js' },
        },
      } as any);

      initializeFeatureGate();
      const gate = getFeatureGate();

      // Should fall back to server provider
      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(true);
      expect(readFileSync).toHaveBeenCalled();
    });

    it('should fall back to server provider on error', async () => {
      const config = { mcpapps: true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('Config error');
      });

      initializeFeatureGate();
      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(true);
      expect(readFileSync).toHaveBeenCalled();
    });

    it('should support lazy initialization without initializeFeatureGate call', async () => {
      const config = { mcpapps: true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
      vi.mocked(getConfig).mockReturnValue({ featureGate: { provider: 'server' } } as any);

      const gate = getFeatureGate();

      await expect(gate.isFeatureEnabled('mcpapps')).resolves.toBe(true);
    });

    it('should expose an async isFeatureEnabled that must be awaited', async () => {
      // Proves the async contract end-to-end: isFeatureEnabled returns a Promise<boolean>
      // (not a bare boolean), so a downstream cloud provider can do a real async lookup
      // per invocation. The server provider resolves its in-memory value.
      const config = { mcpapps: true, pulse: false };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
      vi.mocked(getConfig).mockReturnValue({ featureGate: { provider: 'server' } } as any);

      const gate = getFeatureGate();

      const pending = gate.isFeatureEnabled('mcpapps');
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).resolves.toBe(true);
      await expect(gate.isFeatureEnabled('pulse')).resolves.toBe(false);
    });
  });

  describe('Feature Gate Provider Types', () => {
    describe('featureGateProviderSchema', () => {
      it('should accept "server" as valid provider', () => {
        const result = featureGateProviderSchema.safeParse('server');
        expect(result.success).toBe(true);
      });

      it('should accept "custom" as valid provider', () => {
        const result = featureGateProviderSchema.safeParse('custom');
        expect(result.success).toBe(true);
      });

      it('should reject invalid provider values', () => {
        const result = featureGateProviderSchema.safeParse('invalid');
        expect(result.success).toBe(false);
      });

      it('should reject undefined', () => {
        const result = featureGateProviderSchema.safeParse(undefined);
        expect(result.success).toBe(false);
      });
    });

    describe('isFeatureGateProvider', () => {
      it('should return true for "server"', () => {
        expect(isFeatureGateProvider('server')).toBe(true);
      });

      it('should return true for "custom"', () => {
        expect(isFeatureGateProvider('custom')).toBe(true);
      });

      it('should return false for invalid values', () => {
        expect(isFeatureGateProvider('invalid')).toBe(false);
        expect(isFeatureGateProvider(undefined)).toBe(false);
        expect(isFeatureGateProvider(null)).toBe(false);
        expect(isFeatureGateProvider(123)).toBe(false);
      });
    });
  });
});
