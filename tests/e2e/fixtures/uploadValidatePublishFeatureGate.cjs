class UploadValidatePublishFeatureGate {
  async isFeatureEnabled(featureName) {
    return featureName === 'upload-validate-publish';
  }
}

module.exports = { FeatureGateProvider: UploadValidatePublishFeatureGate };
