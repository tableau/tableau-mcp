/* eslint-disable @typescript-eslint/explicit-function-return-type */

const features = require('../../../features.json');

// Forces admin-tools on; every other flag keeps its features.json value.
class AdminToolsFeatureGate {
  async isFeatureEnabled(featureName) {
    return featureName === 'admin-tools' || Boolean(features[featureName]);
  }
}

module.exports = { FeatureGateProvider: AdminToolsFeatureGate };
