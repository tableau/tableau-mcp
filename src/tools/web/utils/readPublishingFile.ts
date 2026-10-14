import { open } from 'fs/promises';

// Publishing retains the file buffer while constructing and sending Tableau requests.
export const MAX_PUBLISH_FILE_BYTES = 100 * 1024 * 1024;

export async function readPublishingFile(
  filePath: string,
  {
    maxBytes = MAX_PUBLISH_FILE_BYTES,
    abortSignal,
  }: { maxBytes?: number; abortSignal?: AbortSignal } = {},
): Promise<Buffer> {
  abortSignal?.throwIfAborted();
  const file = await open(filePath, 'r');
  let stream: ReturnType<typeof file.createReadStream> | undefined;
  try {
    const { size } = await file.stat();
    abortSignal?.throwIfAborted();
    if (size > maxBytes) {
      throw new Error(`Publishing file exceeds the ${maxBytes}-byte limit.`);
    }

    stream = file.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
      ...(abortSignal ? { signal: abortSignal } : {}),
    });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of stream) {
      abortSignal?.throwIfAborted();
      const buffer = chunk as Buffer;
      totalBytes += buffer.byteLength;
      // The file may grow after stat, so enforce the limit while reading too.
      if (totalBytes > maxBytes) {
        throw new Error(`Publishing file exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(buffer);
    }
    abortSignal?.throwIfAborted();
    return Buffer.concat(chunks, totalBytes);
  } finally {
    stream?.destroy();
    await file.close();
  }
}
