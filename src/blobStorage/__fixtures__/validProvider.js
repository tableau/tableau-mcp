// Test fixture: plain CommonJS so loadCustomProvider() can require() it. Implements all three
// BlobStorageProvider methods.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS fixture */
class ValidProvider {
  async upload() {
    return { url: 'https://example.com/blob' };
  }

  async getPresignedUploadUrl() {
    return { uploadUrl: 'https://example.com/upload', requiredHeaders: {} };
  }

  async download() {
    return undefined;
  }
}

module.exports.default = ValidProvider;
