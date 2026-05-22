import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { FeatureConfigSchema } from '../../src/features/featureGate.js';

describe('features.json validation', () => {
  it('should have valid features.json format', () => {
    const featuresPath = path.join(process.cwd(), 'features.json');
    const fileContent = readFileSync(featuresPath, 'utf-8');
    const rawConfig = JSON.parse(fileContent);

    // This will throw if the config doesn't match the schema
    const config = FeatureConfigSchema.parse(rawConfig);

    // Verify all values are booleans
    Object.entries(config).forEach(([key, value]) => {
      expect(typeof value).toBe('boolean');
    });
  });
});
