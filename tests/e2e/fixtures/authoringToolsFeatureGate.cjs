/* eslint-disable @typescript-eslint/explicit-function-return-type */

class AuthoringToolsFeatureGate {
  async isFeatureEnabled(featureName) {
    return featureName === 'authoring-tools';
  }
}

module.exports = { FeatureGateProvider: AuthoringToolsFeatureGate };
