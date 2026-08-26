/* eslint-disable @typescript-eslint/explicit-function-return-type */

class FlowToolsFeatureGate {
  async isFeatureEnabled(featureName) {
    return featureName === 'flow-tools';
  }
}

module.exports = { FeatureGateProvider: FlowToolsFeatureGate };
