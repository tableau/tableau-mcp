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
   * Check if a feature is enabled.
   *
   * Returns a Promise so providers can perform a real async lookup per invocation
   * (e.g. a cloud provider querying DynamoDB). Synchronous providers simply resolve
   * an already-in-memory value.
   */
  isFeatureEnabled(featureName: string): Promise<boolean>;
}
