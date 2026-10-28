/* eslint-disable @typescript-eslint/explicit-function-return-type */

class DatasourceAuthoringFeatureGate {
  async isFeatureEnabled(featureName) {
    return featureName === 'datasource-authoring';
  }
}

module.exports = { FeatureGateProvider: DatasourceAuthoringFeatureGate };
