import { readFileSync } from 'fs';
import path from 'path';

import { log } from '../logging/logger.js';
import { getDirname } from '../utils/getDirname.js';
import type { FeatureGateProvider } from './featureGateProvider.js';

const FEATURES_CONFIG_PATH = 'features.json';

/**
 * Server-based feature gate provider that loads features from a local file.
 * Used for on-premise Tableau Server deployments.
 */
export class ServerFeatureGate implements FeatureGateProvider {
  private features: Map<string, boolean>;

  constructor() {
    this.features = this.loadFeatures();
  }

  /**
   * Check if a feature is enabled
   * @param featureName - Name of the feature to check
   * @returns true if enabled, false if disabled or not found
   */
  isFeatureEnabled(featureName: string): boolean {
    return this.features.get(featureName) ?? false;
  }

  private loadFeatures(): Map<string, boolean> {
    const filePath = path.join(getDirname(), FEATURES_CONFIG_PATH);

    try {
      const fileContent = readFileSync(filePath, 'utf-8');
      const rawConfig = JSON.parse(fileContent);

      // Validate that it's an object
      if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig)) {
        throw new Error('Config must be a JSON object');
      }

      // Load valid key-value pairs, skip malformed ones
      const validFeatures = new Map<string, boolean>();
      const invalidEntries: string[] = [];

      for (const [key, value] of Object.entries(rawConfig)) {
        if (typeof value === 'boolean') {
          validFeatures.set(key, value);
        } else {
          invalidEntries.push(`${key} (${typeof value})`);
        }
      }

      // Log warning if any entries were invalid
      if (invalidEntries.length > 0) {
        log({
          level: 'warning',
          message: `Skipped invalid feature flags in ${filePath}: ${invalidEntries.join(', ')}. Valid features loaded.`,
          logger: 'featureGate',
        });
      }

      log({
        level: 'info',
        message: `Loaded ${validFeatures.size} feature flag(s) from ${filePath} successfully.`,
        logger: 'featureGate',
      });

      return validFeatures;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log({
        level: 'error',
        message: `Failed to load feature config from ${filePath}: ${errorMessage}. All features disabled.`,
        logger: 'featureGate',
        data: error,
      });
      return new Map<string, boolean>();
    }
  }
}
