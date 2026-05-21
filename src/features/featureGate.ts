import { existsSync, readFileSync } from 'fs';
import path from 'path';

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
    const features = new Map<string, boolean>();

    // Determine config file path
    const filePath = configPath ?? path.join(process.cwd(), 'features.json');

    // If file doesn't exist, return empty map (all features disabled)
    if (!existsSync(filePath)) {
      console.warn(`Feature config file not found: ${filePath}. All features disabled.`);
      return features;
    }

    try {
      const fileContent = readFileSync(filePath, 'utf-8');
      const config = JSON.parse(fileContent);

      // Parse each feature
      for (const [name, value] of Object.entries(config)) {
        const trimmedName = name.trim();

        if (typeof value === 'boolean') {
          features.set(trimmedName, value);
        } else {
          console.warn(
            `Invalid boolean value for feature '${trimmedName}': ${value}. Treating as false.`,
          );
          features.set(trimmedName, false);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `Failed to load feature config from ${filePath}: ${errorMessage}. All features disabled.`,
      );
      return new Map<string, boolean>();
    }

    return features;
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
