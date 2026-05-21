import { describe, expect, it } from 'vitest';

import { FeatureGate } from '../../src/features/featureGate.js';

describe('features.json validation', () => {
  it('should load features.json successfully', () => {
    expect(() => new FeatureGate()).not.toThrow();
  });
});
