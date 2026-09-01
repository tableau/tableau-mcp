// Test fixture: a plain CommonJS module (not compiled from TS) so it can be
// `require()`d synchronously by loadCustomProvider() in init.ts. Deliberately
// missing `getPresignedUploadUrl` and `download` to exercise the duck-type
// validation failure path in initializeBlobStorageProvider()'s custom loader.
class IncompleteProvider {
  async upload() {
    return { url: 'https://example.com/blob' };
  }
}

module.exports.default = IncompleteProvider;
