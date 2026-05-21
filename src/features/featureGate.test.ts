import { existsSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FeatureGate } from './featureGate.js';

describe('FeatureGate', () => {
  const testConfigPath = path.join(process.cwd(), 'test-features.json');

  afterEach(() => {
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  describe('loadFeatures', () => {
    it('should load valid feature config file', () => {
      const config = { mcpapps: true, pulse: false };
      writeFileSync(testConfigPath, JSON.stringify(config));

      const gate = new FeatureGate(testConfigPath);

      expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
      expect(gate.isFeatureEnabled('pulse')).toBe(false);
    });
  });

  describe('missing file handling', () => {
    it('should handle missing file gracefully', () => {
      const gate = new FeatureGate('/nonexistent/path/features.json');

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
      expect(gate.isFeatureEnabled('pulse')).toBe(false);
    });

    it('should use default path when not specified', () => {
      const gate = new FeatureGate();

      // All features disabled when default file doesn't exist
      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
    });
  });

  describe('invalid JSON handling', () => {
    it('should handle invalid JSON gracefully', () => {
      writeFileSync(testConfigPath, '{ invalid json }');

      const gate = new FeatureGate(testConfigPath);

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
    });

    it('should treat invalid boolean values as false', () => {
      const config = {
        mcpapps: 'yes',
        pulse: null,
        oauth: 123,
        experimental: []
      };
      writeFileSync(testConfigPath, JSON.stringify(config));

      const gate = new FeatureGate(testConfigPath);

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
      expect(gate.isFeatureEnabled('pulse')).toBe(false);
      expect(gate.isFeatureEnabled('oauth')).toBe(false);
      expect(gate.isFeatureEnabled('experimental')).toBe(false);
    });
  });
});
