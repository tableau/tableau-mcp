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
});
