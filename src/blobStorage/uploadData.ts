/**
 * Wraps an in-memory payload as `BlobStorageProvider.upload` data plus its exact length. The
 * iterable is re-iterable (each iteration yields the same single piece), so it is safe to retry.
 */
export function toUploadData(payload: Buffer | string): {
  data: AsyncIterable<Uint8Array>;
  contentLength: number;
} {
  const bytes = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload;
  return {
    data: {
      async *[Symbol.asyncIterator]() {
        yield bytes;
      },
    },
    contentLength: bytes.byteLength,
  };
}
