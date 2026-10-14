// Test fixture: a plain CommonJS module (not compiled from TS) so it can be
// `require()`d synchronously by loadCustomProvider() in init.ts. Deliberately
// missing `getPresignedUploadUrl` and `download` to exercise the duck-type
// validation failure path in initializeBlobStorageProvider()'s custom loader.
class IncompleteProvider {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS fixture, TS return-type syntax isn't valid here
  async upload() {
    return { url: 'https://example.com/blob' };
  }
}

module.exports.default = IncompleteProvider;
