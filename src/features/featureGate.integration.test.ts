import { existsSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { initializeFeatureGate, getFeatureGate, resetFeatureGate } from './featureGate.js';

describe('FeatureGate integration', () => {
  const testConfigPath = path.join(process.cwd(), 'test-features-integration.json');

  beforeEach(() => {
    // Reset singleton state before each test
    resetFeatureGate();
  });

  afterEach(() => {
    // Clean up test config file
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }

    // Reset singleton state after each test
    resetFeatureGate();
  });

  it('should initialize from Config and check features', () => {
    // Create test feature config
    const features = { mcpapps: true, pulse: false };
    writeFileSync(testConfigPath, JSON.stringify(features));

    // Simulate server initialization
    const featureGate = initializeFeatureGate(testConfigPath);

    // Verify feature checks work
    expect(featureGate.isFeatureEnabled('mcpapps')).toBe(true);
    expect(featureGate.isFeatureEnabled('pulse')).toBe(false);
    expect(featureGate.isFeatureEnabled('unknown')).toBe(false);
  });

  it('should work when feature config file does not exist', () => {
    // Simulate server initialization with non-existent file
    const featureGate = initializeFeatureGate('/nonexistent/features.json');

    // All features should be disabled
    expect(featureGate.isFeatureEnabled('mcpapps')).toBe(false);
    expect(featureGate.isFeatureEnabled('pulse')).toBe(false);
  });

  it('should allow retrieving initialized gate via getFeatureGate', () => {
    // Create test feature config
    const features = { mcpapps: true, oauth: true };
    writeFileSync(testConfigPath, JSON.stringify(features));

    // Initialize via initializeFeatureGate
    initializeFeatureGate(testConfigPath);

    // Retrieve via getFeatureGate (simulating usage in other parts of server)
    const gate = getFeatureGate();
    expect(gate.isFeatureEnabled('mcpapps')).toBe(true);
    expect(gate.isFeatureEnabled('oauth')).toBe(true);
    expect(gate.isFeatureEnabled('pulse')).toBe(false);
  });

  it('should handle invalid JSON in config file', () => {
    // Create invalid JSON file
    writeFileSync(testConfigPath, '{ invalid json }');

    // Should initialize without throwing, all features disabled
    const featureGate = initializeFeatureGate(testConfigPath);

    expect(featureGate.isFeatureEnabled('mcpapps')).toBe(false);
    expect(featureGate.isFeatureEnabled('pulse')).toBe(false);
  });

  it('should handle non-boolean feature values', () => {
    // Create config with mixed types
    const features = {
      mcpapps: true,
      pulse: 'yes',
      oauth: null,
      experimental: 123
    };
    writeFileSync(testConfigPath, JSON.stringify(features));

    const featureGate = initializeFeatureGate(testConfigPath);

    // Only valid booleans should be true
    expect(featureGate.isFeatureEnabled('mcpapps')).toBe(true);
    // Non-boolean values should be treated as false
    expect(featureGate.isFeatureEnabled('pulse')).toBe(false);
    expect(featureGate.isFeatureEnabled('oauth')).toBe(false);
    expect(featureGate.isFeatureEnabled('experimental')).toBe(false);
  });

  it('should integrate with multiple feature checks during server lifecycle', () => {
    // Simulate typical server startup with features config
    const features = { mcpapps: true, pulse: true, oauth: false, experimental: false };
    writeFileSync(testConfigPath, JSON.stringify(features));

    // Initialize during server startup
    const featureGate = initializeFeatureGate(testConfigPath);

    // Simulate checking features at different parts of the server
    if (featureGate.isFeatureEnabled('mcpapps')) {
      // Would load mcpapps module
    }

    if (featureGate.isFeatureEnabled('pulse')) {
      // Would load pulse module
    }

    // Verify feature states
    expect(featureGate.isFeatureEnabled('mcpapps')).toBe(true);
    expect(featureGate.isFeatureEnabled('pulse')).toBe(true);
    expect(featureGate.isFeatureEnabled('oauth')).toBe(false);
    expect(featureGate.isFeatureEnabled('experimental')).toBe(false);
  });
});
