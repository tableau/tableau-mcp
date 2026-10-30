// Test fixture: plain CommonJS so loadCustomProvider() can require() it. Implements all
// BlobStorageProvider methods.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS fixture */
class ValidProvider {
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

  async delete() {}
}

module.exports.default = ValidProvider;
