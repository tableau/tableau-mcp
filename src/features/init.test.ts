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

    it('should load valid feature config file', () => {
      const config = { mcpapps: true, pulse: false };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
      expect(gate.isFeatureEnabled('pulse')).toBe(false);
    });
  });

  describe('missing file handling', () => {
    it('should handle missing file gracefully', () => {
      const error: NodeJS.ErrnoException = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      vi.mocked(readFileSync).mockImplementation(() => {
        throw error;
      });

      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
      expect(gate.isFeatureEnabled('pulse')).toBe(false);
    });
  });

  describe('invalid JSON handling', () => {
    it('should handle invalid JSON gracefully', () => {
      vi.mocked(readFileSync).mockReturnValue('{ invalid json }');

      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
    });

    it('should skip invalid values and load valid ones', () => {
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
      expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
      expect(gate.isFeatureEnabled('validFeature')).toBe(false);

      // Invalid features should be skipped (disabled)
      expect(gate.isFeatureEnabled('invalidString')).toBe(false);
      expect(gate.isFeatureEnabled('invalidNull')).toBe(false);
      expect(gate.isFeatureEnabled('invalidNumber')).toBe(false);
      expect(gate.isFeatureEnabled('invalidArray')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty JSON object', () => {
      vi.mocked(readFileSync).mockReturnValue('{}');

      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
      expect(gate.isFeatureEnabled('any-feature')).toBe(false);
    });

    it('should return false for unknown features', () => {
      const config = { mcpapps: true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('unknown-feature')).toBe(false);
      expect(gate.isFeatureEnabled('nonexistent')).toBe(false);
    });
  });

  describe('with test fixtures', () => {
    it('should load all-enabled fixture correctly', () => {
      const config = { mcpapps: true, pulse: true, 'oauth-embedded': true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
      expect(gate.isFeatureEnabled('pulse')).toBe(true);
      expect(gate.isFeatureEnabled('oauth-embedded')).toBe(true);
    });

    it('should load all-disabled fixture correctly', () => {
      const config = { mcpapps: false, pulse: false, 'oauth-embedded': false };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
      expect(gate.isFeatureEnabled('pulse')).toBe(false);
      expect(gate.isFeatureEnabled('oauth-embedded')).toBe(false);
    });

    it('should load mixed fixture correctly', () => {
      const config = { mcpapps: false, pulse: true, 'oauth-embedded': false };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
      expect(gate.isFeatureEnabled('pulse')).toBe(true);
      expect(gate.isFeatureEnabled('oauth-embedded')).toBe(false);
    });
  });

  describe('provider selection', () => {
    beforeEach(() => {
      resetFeatureGate();
      vi.clearAllMocks();
    });

    it('should use server provider by default and load from file', () => {
      const config = { mcpapps: true, pulse: false };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
      vi.mocked(getConfig).mockReturnValue({ featureGate: { provider: 'server' } } as any);

      initializeFeatureGate();
      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
      expect(gate.isFeatureEnabled('pulse')).toBe(false);
      expect(readFileSync).toHaveBeenCalled();
    });

    it('should fall back to server provider when custom provider module fails to load', () => {
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
      expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
      expect(readFileSync).toHaveBeenCalled();
    });

    it('should fall back to server provider on error', () => {
      const config = { mcpapps: true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('Config error');
      });

      initializeFeatureGate();
      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
      expect(readFileSync).toHaveBeenCalled();
    });

    it('should support lazy initialization without initializeFeatureGate call', () => {
      const config = { mcpapps: true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
      vi.mocked(getConfig).mockReturnValue({ featureGate: { provider: 'server' } } as any);

      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
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
