export type UploadData = { data: AsyncIterable<Uint8Array>; contentLength: number };

/** Wraps an in-memory payload as a single-chunk `upload` stream plus its exact length. */
export function toUploadData(payload: Buffer | string): UploadData {
  const bytes = typeof payload === 'string' ? Buffer.from(payload) : payload;
  return { data: yieldOnce(bytes), contentLength: bytes.byteLength };
}

export async function* yieldOnce(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}
