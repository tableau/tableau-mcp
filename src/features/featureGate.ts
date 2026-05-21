import { readFileSync } from 'fs';
import path from 'path';
import { z } from 'zod';

import { log } from '../logging/logger.js';

export const FeatureConfigSchema = z.record(z.string(), z.boolean());

export class FeatureGate {
  private features: Map<string, boolean>;

  constructor(configPath?: string) {
    this.features = this.loadFeatures(configPath);
  }

  /**
   * Check if a feature is enabled
   * @param featureName - Name of the feature to check
   * @returns true if enabled, false if disabled or not found
   */
  isFeatureEnabled(featureName: string): boolean {
    return this.features.get(featureName) ?? false;
  }

  private loadFeatures(configPath?: string): Map<string, boolean> {
    const filePath = configPath || path.join(process.cwd(), 'features.json');

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
 * Initialize the global feature gate with config
 * @param configPath - Path to features.json
 * @throws Error if already initialized
 */
export function initializeFeatureGate(configPath?: string): FeatureGate {
  if (globalFeatureGate !== null) {
    throw new Error('FeatureGate already initialized. Multiple initializations are not allowed.');
  }

  globalFeatureGate = new FeatureGate(configPath);
  return globalFeatureGate;
}

/**
 * Get the global feature gate instance
 * @throws Error if not initialized
 */
export function getFeatureGate(): FeatureGate {
  if (globalFeatureGate === null) {
    throw new Error('FeatureGate not initialized. Call initializeFeatureGate() first.');
  }
  return globalFeatureGate;
}

/**
 * Reset the global feature gate instance (for testing purposes only)
 */
export function resetFeatureGate(): void {
  globalFeatureGate = null;
}
