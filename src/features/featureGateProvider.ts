/**
 * Public, dependency-free provider contract for feature gating.
 *
 * This module is exposed as a package subpath (`@tableau/mcp-server/features/featureGateProvider`)
 * so external deployments can implement a custom feature gate provider against a stable type,
 * without importing the server's internal config schemas. Keep it free of runtime dependencies.
 */

/**
 * Feature gate provider interface
 */
export interface FeatureGateProvider {
  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(featureName: string): boolean;
}
