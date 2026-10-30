// Test fixture: plain CommonJS so loadCustomProvider() can require() it. Implements every
// BlobStorageProvider method except `delete`.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS fixture */
class NoDeleteProvider {
  async upload() {
    return { url: 'https://example.com/blob' };
  }

  async getPresignedUploadUrl({ contentType }) {
    return {
      uploadUrl: 'https://example.com/upload',
      requiredHeaders: { 'Content-Type': contentType },
    };
  }

  async download() {
    return undefined;
  }
}

module.exports.default = NoDeleteProvider;
