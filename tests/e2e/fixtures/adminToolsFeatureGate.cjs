/* eslint-disable @typescript-eslint/explicit-function-return-type */

class AdminToolsFeatureGate {
  async isFeatureEnabled(featureName) {
    return featureName === 'admin-tools';
  }
}

module.exports = { FeatureGateProvider: AdminToolsFeatureGate };
