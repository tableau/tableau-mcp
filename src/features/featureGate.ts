import { readFileSync } from 'fs';
import path from 'path';
import { z } from 'zod';

import { log } from '../logging/logger.js';

export const FeatureConfigSchema = z.record(z.string(), z.boolean());

const FEATURES_CONFIG_PATH = 'features.json';

export class FeatureGate {
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
    const filePath = path.join(process.cwd(), FEATURES_CONFIG_PATH);

    try {
      const fileContent = readFileSync(filePath, 'utf-8');
      const rawConfig = JSON.parse(fileContent);
      const config = FeatureConfigSchema.parse(rawConfig);

      return new Map(Object.entries(config));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log({
        level: 'error',
        message: `Failed to load feature config from ${filePath}: ${errorMessage}. All features disabled.`,
        logger: 'featureGate',
      });
      return new Map<string, boolean>();
    }
  }
}

// Singleton instance for global use
let globalFeatureGate: FeatureGate | null = null;

/**
 * Get the global feature gate instance (lazy initialized)
 */
export function getFeatureGate(): FeatureGate {
  if (globalFeatureGate === null) {
    globalFeatureGate = new FeatureGate();
  }
  return globalFeatureGate;
}

/**
 * Reset the global feature gate instance (for testing purposes only)
 */
export function resetFeatureGate(): void {
  globalFeatureGate = null;
}
