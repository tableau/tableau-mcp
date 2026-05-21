import { existsSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FeatureGate, initializeFeatureGate, getFeatureGate, resetFeatureGate } from './featureGate.js';

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

  describe('edge cases', () => {
    it('should handle empty JSON object', () => {
      writeFileSync(testConfigPath, '{}');

      const gate = new FeatureGate(testConfigPath);

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
      expect(gate.isFeatureEnabled('any-feature')).toBe(false);
    });

    it('should return false for unknown features', () => {
      const config = { mcpapps: true };
      writeFileSync(testConfigPath, JSON.stringify(config));

      const gate = new FeatureGate(testConfigPath);

      expect(gate.isFeatureEnabled('unknown-feature')).toBe(false);
      expect(gate.isFeatureEnabled('nonexistent')).toBe(false);
    });
  });

  describe('with test fixtures', () => {
    it('should load all-enabled fixture correctly', () => {
      const fixturePath = path.join(process.cwd(), 'tests/fixtures/features-all-enabled.json');
      const gate = new FeatureGate(fixturePath);

      expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
      expect(gate.isFeatureEnabled('pulse')).toBe(true);
      expect(gate.isFeatureEnabled('oauth-embedded')).toBe(true);
    });

    it('should load all-disabled fixture correctly', () => {
      const fixturePath = path.join(process.cwd(), 'tests/fixtures/features-all-disabled.json');
      const gate = new FeatureGate(fixturePath);

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
      expect(gate.isFeatureEnabled('pulse')).toBe(false);
      expect(gate.isFeatureEnabled('oauth-embedded')).toBe(false);
    });

    it('should load mixed fixture correctly', () => {
      const fixturePath = path.join(process.cwd(), 'tests/fixtures/features-mixed.json');
      const gate = new FeatureGate(fixturePath);

      expect(gate.isFeatureEnabled('mcpapps')).toBe(false);
      expect(gate.isFeatureEnabled('pulse')).toBe(true);
      expect(gate.isFeatureEnabled('oauth-embedded')).toBe(false);
    });
  });

  describe('singleton instance', () => {
    beforeEach(() => {
      // Reset singleton state before each test
      resetFeatureGate();
    });

    afterEach(() => {
      // Clean up singleton state after each test
      resetFeatureGate();
    });

    it('should initialize and retrieve global feature gate', () => {
      const config = { mcpapps: true };
      writeFileSync(testConfigPath, JSON.stringify(config));

      const gate = initializeFeatureGate(testConfigPath);
      const retrieved = getFeatureGate();

      expect(retrieved).toBe(gate);
      expect(retrieved.isFeatureEnabled('mcpapps')).toBe(true);
    });

    it('should throw error when accessing uninitialized feature gate', () => {
      expect(() => getFeatureGate()).toThrow('FeatureGate not initialized');
    });

    it('should throw error when re-initializing feature gate', () => {
      const config = { mcpapps: true };
      writeFileSync(testConfigPath, JSON.stringify(config));

      initializeFeatureGate(testConfigPath);

      expect(() => initializeFeatureGate(testConfigPath)).toThrow(
        'FeatureGate already initialized',
      );
    });
  });
});
