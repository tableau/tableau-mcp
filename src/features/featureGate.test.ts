import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

import { getFeatureGate, resetFeatureGate } from './featureGate.js';

describe('FeatureGate', () => {
  beforeEach(() => {
    resetFeatureGate();
    vi.clearAllMocks();
  });

  describe('loadFeatures', () => {
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

    it('should reject config with invalid boolean values', () => {
      const config = {
        mcpapps: 'yes',
        pulse: null,
        oauth: 123,
        experimental: [],
      };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      // With strict validation, invalid config causes all features to be disabled
      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
      expect(gate.isFeatureEnabled('pulse')).toBe(false);
      expect(gate.isFeatureEnabled('oauth')).toBe(false);
      expect(gate.isFeatureEnabled('experimental')).toBe(false);
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

  describe('singleton instance', () => {
    it('should return same instance on subsequent calls', () => {
      const config = { mcpapps: true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate1 = getFeatureGate();
      const gate2 = getFeatureGate();

      expect(gate2).toBe(gate1);
      expect(gate2.isFeatureEnabled('mcpapps')).toBe(true);
    });

    it('should initialize lazily on first access', () => {
      const config = { mcpapps: true };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      const gate = getFeatureGate();

      expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
    });
  });
});
